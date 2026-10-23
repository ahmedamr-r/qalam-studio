import { create } from "zustand";
import { nanoid } from "nanoid";
import { dsIdForNode, getSystem, systemFor, tokenSetFor, useSystems, type DesignSystem } from "@/design-system/registry";
import type { Tree } from "@/design-system/resolve";
import type { ComponentDef, DesignDocs } from "@/design-system/docs";
import { componentKey, patternFrom } from "@/design-system/custom";
import { isEdited, reskinSubtree } from "@/design-system/apply";
import { ensureSystemFonts, fingerprint } from "@/design-system/place";
import { ensureYoga } from "@/engine/layout";
import { lintNodes } from "@/lint/rules";
import { studio, useStudio } from "@/doc/store";
import { wholeDoc } from "@/doc/pages";

/**
 * Hand edits to a design system from the token editor and the component docs. The built-in
 * system is read-only, so its first edit goes into a copy (like tuning does). Edits have their own
 * undo stack, and screens bound to the edited system follow its tokens the way Figma variables
 * do: token-bound fills, strokes, radii, spacing, shadows and type are re-resolved in place.
 */

interface Snapshot {
  systemId: string;
  tree: Tree;
  docs: DesignDocs;
  label: string;
}

interface EditsState {
  past: Snapshot[];
  future: Snapshot[];
  /** The last time an edit to the built-in system went into a new copy. */
  forked: { from: string; to: string } | null;
}

export const useEdits = create<EditsState>(() => ({ past: [], future: [], forked: null }));

export type EditFn = (tree: Tree, docs: DesignDocs) => { tree?: Tree; docs?: DesignDocs } | { error: string };

function copyName(base: string): string {
  const names = new Set(useSystems.getState().systems.map((s) => s.name));
  let name = `${base} (edited)`;
  for (let i = 2; names.has(name); i++) name = `${base} (edited ${i})`;
  return name;
}

/** Copy a system into a new editable one; it becomes active if the source was. */
export function duplicateSystem(src: DesignSystem, name = copyName(src.name)): DesignSystem {
  const reg = useSystems.getState();
  const now = Date.now();
  const copy: DesignSystem = { ...structuredClone(src), id: `edited-${nanoid(8)}`, name, source: "imported", forkedFrom: src.forkedFrom ?? src.id, createdAt: now, updatedAt: now };
  reg.add(copy, reg.activeId === src.id);
  return copy;
}

/**
 * Apply an edit to a system. Returns the id of the system that changed (a new copy when `dsId`
 * is the built-in one), or why the edit was refused.
 */
export function editSystem(dsId: string, label: string, fn: EditFn): { id: string } | { error: string } {
  const src = getSystem(dsId);
  if (!src) return { error: "That design system has been deleted." };
  const r = fn(src.tree, src.docs);
  if ("error" in r) return r;
  let target = src;
  if (src.source === "builtin") {
    target = duplicateSystem(src);
    useEdits.setState({ forked: { from: src.id, to: target.id } });
  }
  useEdits.setState((s) => ({ past: [...s.past, { systemId: target.id, tree: target.tree, docs: target.docs, label }].slice(-100), future: [] }));
  useSystems.getState().update(target.id, { ...(r.tree ? { tree: r.tree } : {}), ...(r.docs ? { docs: r.docs } : {}) });
  // Tokens change how screens look (and a fork's screens are moved explicitly). A change to the
  // system's own components bumps its version, so systemSync rebuilds their linked instances.
  if (r.tree) scheduleSync(target.id);
  return { id: target.id };
}

/** Add a component (made by Qalam AI for a screen) to a system as one of its own. */
export function addComponentToSystem(dsId: string, def: ComponentDef): { id: string } | { error: string } {
  return editSystem(dsId, `Add ${def.name}`, (_tree, docs) => {
    if (docs.patterns.some((p) => componentKey(p.name) === componentKey(def.name))) return { error: `${systemFor(dsId).name} already has a component called ${def.name}.` };
    return { docs: { ...docs, patterns: [...docs.patterns, patternFrom(def)] } };
  });
}

function step(from: "past" | "future") {
  const s = useEdits.getState();
  const stack = s[from];
  const snap = stack[stack.length - 1];
  if (!snap) return null;
  const cur = getSystem(snap.systemId);
  const rest = stack.slice(0, -1);
  if (!cur) {
    useEdits.setState({ [from]: rest });
    return null;
  }
  const back: Snapshot = { systemId: cur.id, tree: cur.tree, docs: cur.docs, label: snap.label };
  useEdits.setState(from === "past" ? { past: rest, future: [...s.future, back] } : { future: rest, past: [...s.past, back] });
  useSystems.getState().update(cur.id, { tree: snap.tree, docs: snap.docs });
  if (snap.tree !== cur.tree) scheduleSync(cur.id);
  return snap;
}

export const undoEdit = () => step("past");
export const redoEdit = () => step("future");

// ---------------------------------------------------------------------------
// Screens follow their system's tokens

/** Top-level nodes on every page bound to a system (a deleted system counts as the built-in one). */
export function boundRoots(dsId: string): string[] {
  const doc = wholeDoc(studio().doc);
  return doc.roots.filter((id) => doc.nodes[id] && doc.nodes[id].type !== "image" && dsIdForNode(doc, id) === dsId);
}

/** Systems edited in this session: their screens are re-synced after a canvas undo or redo too. */
const edited = new Set<string>();
const queued = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

function scheduleSync(dsId: string) {
  edited.add(dsId);
  queued.add(dsId);
  clearTimeout(timer);
  timer = setTimeout(() => {
    const ids = [...queued];
    queued.clear();
    void (async () => {
      for (const id of ids) await syncScreens(id, boundRoots(id), { history: false });
    })();
  }, 200);
}

/**
 * Re-resolve every token binding in `roots` against `dsId` (and bind them to it). Screens that
 * were untouched since they were built stay rebuildable; hand-edited ones stay flagged as edited.
 */
export async function syncScreens(dsId: string, roots: string[], opts: { history: boolean }) {
  if (!roots.length || !getSystem(dsId)) return;
  await Promise.all([ensureYoga(), ensureSystemFonts(dsId)]);
  const ts = tokenSetFor(dsId);
  const s = studio();
  const live = roots.filter((id) => s.doc.nodes[id]);
  const handEdited = new Set(live.filter((id) => isEdited(s.doc, id)));
  if (opts.history) s.beginTx();
  studio().mutate(
    (d) => {
      for (const id of live) {
        reskinSubtree(d, id, ts);
        d.nodes[id].meta.designSystem = dsId;
      }
    },
    { history: opts.history },
  );
  // Fingerprint the reflowed result (auto layout runs after each recipe).
  studio().mutate(
    (d) => {
      for (const id of live) {
        const r = d.nodes[id];
        if (r?.meta.spec && !handEdited.has(id)) r.meta.specFingerprint = fingerprint(d, id);
      }
    },
    { history: opts.history },
  );
  if (opts.history) studio().commitTx();
  lintNodes(live);
}

/** After a token rename, point canvas bindings of the system's screens at the new name. */
export function renameBindings(dsId: string, from: string, to: string) {
  const roots = boundRoots(dsId);
  if (!roots.length) return;
  const swap = (v: unknown, key: string): unknown => {
    if (typeof v === "string") return /token/i.test(key) && v === from ? to : v;
    if (Array.isArray(v)) return v.map((x) => swap(x, key));
    if (v && typeof v === "object") {
      for (const k of Object.keys(v)) (v as Record<string, unknown>)[k] = swap((v as Record<string, unknown>)[k], /token/i.test(key) ? key : k);
      return v;
    }
    return v;
  };
  studio().mutate(
    (d) => {
      const stack = [...roots];
      while (stack.length) {
        const n = d.nodes[stack.pop()!];
        if (!n) continue;
        swap(n, "");
        stack.push(...n.children);
      }
    },
    { history: false },
  );
}

/** Move every screen bound to `from` onto `to` (one undo step on the canvas). */
export async function moveScreens(from: string, to: string): Promise<number> {
  const roots = boundRoots(from);
  await syncScreens(to, roots, { history: true });
  edited.add(to);
  return roots.length;
}

// A canvas undo brings back a snapshot resolved with older token values: bring it up to date.
if (typeof window !== "undefined") {
  useStudio.subscribe((s, prev) => {
    if (!edited.size || s.doc === prev.doc) return;
    const undo = s.future.length > 0 && s.future[0] === prev.doc;
    const redo = prev.future.length > 0 && s.doc === prev.future[0];
    if (undo || redo) for (const id of edited) scheduleSync(id);
  });
}
