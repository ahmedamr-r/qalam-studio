import type { Doc } from "@/doc/schema";
import { topFrameOf } from "@/doc/geometry";
import type { Inst, ScreenSpec } from "./builders";
import { specAt } from "./instances";

/**
 * Part of a generated screen: the catalog components the designer selected inside it. AI edits
 * scoped to a section replace just those components and leave the rest of the screen as it is.
 */

export interface Section {
  rootId: string;
  /** The screen's name. */
  name: string;
  /** Spec paths of the selected components, e.g. "body.2" or "body.2.children.1". */
  paths: string[];
  /** Their component names, for display. */
  names: string[];
}

export interface SectionEdit {
  path: string;
  /** What replaces the component at `path`: usually one, several to add beside it or split it. */
  items: Inst[];
}

const isUnder = (path: string, parent: string) => path.startsWith(`${parent}.`);

/**
 * The section the selection points at, or null when the selection isn't inside exactly one
 * generated screen (or includes the whole screen: that's a request about the screen).
 */
export function selectedSection(doc: Doc, selection: string[]): Section | null {
  const ids = selection.filter((id) => doc.nodes[id]);
  if (!ids.length) return null;
  const roots = new Set(ids.map((id) => topFrameOf(doc, id)));
  if (roots.size !== 1) return null;
  const [rootId] = roots;
  const root = doc.nodes[rootId];
  const spec = root?.meta.spec as ScreenSpec | undefined;
  if (!spec || ids.includes(rootId)) return null;
  // Each selected layer counts as the catalog component it belongs to; a wrapper the studio adds
  // (a region such as "Content", the backdrop) counts as the components inside it.
  const found: string[] = [];
  const add = (p: string | undefined) => {
    if (p !== undefined && specAt(spec, p) && !found.includes(p)) found.push(p);
  };
  const inside = (id: string) => {
    for (const c of doc.nodes[id]?.children ?? []) {
      const p = doc.nodes[c]?.meta.specPath;
      if (p !== undefined) add(p);
      else inside(c);
    }
  };
  for (const id of ids) {
    let n = doc.nodes[id];
    while (n && n.meta.specPath === undefined && n.parentId && n.parentId !== rootId) n = doc.nodes[n.parentId];
    if (n?.meta.specPath !== undefined) add(n.meta.specPath);
    else inside(id);
  }
  // A component inside another selected one is already part of it.
  const paths = found.filter((p) => !found.some((q) => q !== p && isUnder(p, q)));
  if (!paths.length) return null;
  return { rootId, name: root.name, paths, names: paths.map((p) => specAt(spec, p)!.component) };
}

const keysOf = (path: string) => path.split(".");

/** The list holding the component at `path`, and its index there. */
function slot(spec: ScreenSpec, path: string): { list: Inst[]; index: number } | null {
  const keys = keysOf(path);
  const index = Number(keys[keys.length - 1]);
  if (!Number.isInteger(index)) return null;
  const listPath = keys.slice(0, -1);
  let list: Inst[] | undefined;
  if (listPath.length === 1) list = (spec as unknown as Record<string, Inst[] | undefined>)[listPath[0]];
  else {
    const owner = specAt(spec, listPath.slice(0, -1).join("."));
    list = listPath[listPath.length - 1] === "children" ? owner?.children : undefined;
  }
  return list && index < list.length ? { list, index } : null;
}

/** Paths of the given components (and everything inside them) in a spec. */
function pathsOf(spec: ScreenSpec, wanted: Set<Inst>): string[] {
  const out: string[] = [];
  const walk = (list: Inst[] | undefined, prefix: string, inside: boolean) =>
    (list ?? []).forEach((inst, i) => {
      const p = `${prefix}.${i}`;
      const hit = inside || wanted.has(inst);
      if (hit) out.push(p);
      walk(inst.children, `${p}.children`, hit);
    });
  for (const r of ["header", "sidebar", "hero", "body", "footer"] as const) walk(spec[r], r, false);
  return out;
}

/**
 * The screen with each edited component replaced. Returns the new spec, the paths of what was put
 * in (with everything inside), and whether every edit was one-for-one (the structure around
 * the section is unchanged, so only those components need rebuilding).
 */
export function spliceSection(spec: ScreenSpec, edits: SectionEdit[]): { spec: ScreenSpec; paths: string[]; oneForOne: boolean } {
  const out = structuredClone(spec);
  const inserted = new Set<Inst>();
  let oneForOne = true;
  // Resolve every slot before splicing anything, so indices refer to the original screen.
  const slots = edits
    .map((e) => ({ e, s: slot(out, e.path) }))
    .filter((x): x is { e: SectionEdit; s: { list: Inst[]; index: number } } => !!x.s);
  // Later positions first, so earlier ones still point at the right component.
  slots.sort((a, b) => (a.s.list === b.s.list ? b.s.index - a.s.index : 0));
  for (const { e, s } of slots) {
    const items = e.items.map((i) => structuredClone(i));
    items.forEach((i) => inserted.add(i));
    if (items.length !== 1) oneForOne = false;
    s.list.splice(s.index, 1, ...items);
  }
  return { spec: out, paths: pathsOf(out, inserted), oneForOne };
}
