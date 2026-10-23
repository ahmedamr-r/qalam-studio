import { studio } from "@/doc/store";
import { insertNodes } from "@/doc/ops";
import { worldBounds, type Box } from "@/doc/geometry";
import { reserve, reservedBoxes, type ReservedBox } from "@/doc/reservations";
import type { Doc, FrameNode, SceneNode } from "@/doc/schema";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import { ensureFonts } from "@/engine/fonts";
import { buildInstance, buildScreen, SCREEN_W, type BuildCtx, type Inst, type ScreenSpec } from "./builders";
import { dsIdForNode, systemFor, tokenSetFor, useSystems, type DesignSystem } from "./registry";
import { TokenSet } from "./resolve";
import { PLATFORMS, type Platform } from "./platform";
import { lintNodes } from "@/lint/rules";
import { stampInstances } from "./instances";
import { ensureIconSet } from "./icons";
import { componentLookup } from "./custom";

/** What takes room on the canvas besides its frames (a route's container around its parts and cards), from what paints it. */
const extents = new Set<(doc: Doc) => Box[]>();
export function registerCanvasExtents(fn: (doc: Doc) => Box[]): () => void {
  extents.add(fn);
  return () => void extents.delete(fn);
}

/** First free x to the right of existing top-level content and of space reserved for AI work. */
export function nextSlot(): { x: number; y: number } {
  const { doc } = studio();
  const boxes = [...doc.roots.map((id) => worldBounds(doc, id)), ...reservedBoxes(), ...[...extents].flatMap((fn) => fn(doc))];
  if (!boxes.length) return { x: 0, y: 0 };
  let right = -Infinity;
  let top = Infinity;
  for (const b of boxes) {
    right = Math.max(right, b.x + b.w);
    top = Math.min(top, b.y);
  }
  return { x: Math.round(right + 160), y: Math.round(top) };
}

export const SCREEN_GAP = 80;

/**
 * Hold canvas space for frames an AI request will create (left to right, like insertScreens
 * places them), so they shimmer where they will land. Release it before inserting at `at`.
 */
export function reserveScreens(label: string, sizes: Omit<ReservedBox, "x" | "y">[]): { id: string; at: { x: number; y: number }; bounds: Box } {
  const at = nextSlot();
  let x = at.x;
  const boxes = sizes.map((size) => {
    const b = { ...size, x, y: at.y };
    x += size.w + SCREEN_GAP;
    return b;
  });
  const bounds = { x: at.x, y: at.y, w: x - SCREEN_GAP - at.x, h: Math.max(...sizes.map((s) => s.h)) };
  return { id: reserve(label, boxes), at, bounds };
}

/** Space to hold for a new screen on a platform. */
export const frameSize = (platform: Platform) => ({ w: PLATFORMS[platform].w, h: PLATFORMS[platform].h, sketch: platform });

/** Load what a design system renders with (its typefaces and icon set) before anything is built or measured. */
export function ensureSystemFonts(dsId: string) {
  const ds = systemFor(dsId);
  const ts = tokenSetFor(ds.id);
  // A missing icon set doesn't stop the build: its icons are resolved when they're drawn.
  return Promise.all([ensureFonts([...ts.families(), ...ds.fonts.map((f) => f.googleFont ?? f.family)]), ensureIconSet(ts.iconSet).catch(() => {})]);
}

/**
 * Structure of a screen as built: a rebuild would discard anything that changes it, so a
 * mismatch means the screen was edited by hand since it was built.
 */
export function fingerprint(doc: Doc, rootId: string): string {
  const parts: string[] = [];
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!n) return;
    const text = n.type === "text" ? n.text.content : n.type === "path" ? n.d : n.type === "image" ? n.src : "";
    parts.push([n.type, n.meta.component ?? "", Math.round(n.x), Math.round(n.y), Math.round(n.w), Math.round(n.h), text, n.fill?.token ?? n.fill?.color ?? "", n.children.length].join("|"));
    n.children.forEach(walk);
  };
  walk(rootId);
  let h = 5381;
  for (const c of parts.join("\n")) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

const docOf = (nodes: SceneNode[]): Doc => ({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), roots: [nodes[0].id] });

/**
 * Build one screen with a design system: root first, bound to the system, keeping its spec.
 * `draft` builds with a system that isn't in the registry yet (an extraction under review).
 */
export function buildScreenNodes(spec: ScreenSpec, dsId: string, at: { x: number; y: number }, source: "ai" | "import" | "user", draft?: DesignSystem): SceneNode[] {
  const ts = draft ? new TokenSet(draft.tree) : tokenSetFor(dsId);
  const dir = spec.dir ?? "ltr";
  const lang = spec.lang ?? (dir === "rtl" ? "ar" : "en");
  const nodes = layoutToNodes(buildScreen(spec, ts, (draft ?? systemFor(dsId)).docs.patterns), { dir, lang, ts }, at, source);
  nodes[0].meta.designSystem = dsId;
  nodes[0].meta.spec = structuredClone(spec);
  nodes[0].meta.specFingerprint = fingerprint(docOf(nodes), nodes[0].id);
  nodes[0].meta.systemVersion = (draft ?? systemFor(dsId)).updatedAt;
  stampInstances(nodes);
  return nodes;
}

/**
 * Build, lay out and insert screens side by side, at `at` (e.g. space reserved for them) or the
 * next free slot. Returns created root ids.
 */
export async function insertScreens(specs: ScreenSpec[], source: "ai" | "import" | "user" = "ai", dsId = useSystems.getState().activeId, at?: { x: number; y: number }): Promise<string[]> {
  await Promise.all([ensureYoga(), ensureSystemFonts(dsId)]);
  const slot = at ?? nextSlot();
  const created: string[] = [];
  let x = slot.x;
  studio().beginTx();
  for (const spec of specs) {
    const nodes = buildScreenNodes(spec, dsId, { x, y: slot.y }, source);
    insertNodes(nodes, null, undefined, false);
    created.push(nodes[0].id);
    x += nodes[0].w + SCREEN_GAP;
  }
  studio().commitTx();
  lintNodes(created);
  studio().select(created);
  return created;
}

/**
 * Lay out one catalog component (or a pattern's composition) on its own, `width` wide. The
 * component's root comes first, parentless at 0,0. With `path` it is the instance at that place in
 * a screen's spec; without, it records the instance itself so it can be rebuilt later.
 */
export function componentNodes(inst: Inst, ctx: BuildCtx, width: number, path?: string): SceneNode[] {
  const box = buildInstance(inst, ctx, path);
  const wrapper = { kind: "frame" as const, name: "tmp", width, align: "stretch" as const, children: [box] };
  // Drop the temporary wrapper, keep the component subtree.
  const [, ...nodes] = layoutToNodes(wrapper, ctx, { x: 0, y: 0 }, "user");
  nodes[0].parentId = null;
  if (path === undefined) nodes[0].meta.inst = structuredClone(inst);
  stampInstances(nodes);
  return nodes;
}

/** Insert one catalog component (or a pattern's composition) into the selected frame, or at the viewport centre. */
export async function insertComponent(inst: Inst) {
  const s0 = studio();
  const sel0 = s0.selection.length === 1 ? s0.doc.nodes[s0.selection[0]] : null;
  const dsId = sel0 ? dsIdForNode(s0.doc, sel0.id) : useSystems.getState().activeId;
  await Promise.all([ensureYoga(), ensureSystemFonts(dsId)]);
  const s = studio();
  const sel = s.selection.length === 1 ? s.doc.nodes[s.selection[0]] : null;
  const target = sel ? (sel.type === "frame" ? sel : sel.parentId ? s.doc.nodes[sel.parentId] : null) : null;
  const dir = target?.type === "frame" ? (target as FrameNode).dir : "ltr";
  // Components made for the screen it goes into count too.
  let top0 = target;
  while (top0?.parentId) top0 = s.doc.nodes[top0.parentId];
  const ctx: BuildCtx = { dir, lang: dir === "rtl" ? "ar" : "en", ts: tokenSetFor(dsId), components: componentLookup(systemFor(dsId).docs.patterns, top0?.meta.spec?.components) };
  // Give fill-width components a sensible width outside of a screen.
  const nodes = componentNodes(inst, ctx, target ? Math.max(120, target.w - 32) : SCREEN_W - 32);
  const top = nodes[0];
  if (target) {
    top.x = 16;
    top.y = 16;
  } else {
    const cam = s.camera;
    top.x = Math.round(cam.x + 200 / cam.zoom);
    top.y = Math.round(cam.y + 120 / cam.zoom);
    top.meta.designSystem = dsId;
    top.meta.systemVersion = systemFor(dsId).updatedAt;
  }
  let index: number | undefined;
  if (target && sel && sel.id !== target.id) {
    // Put it just below the selected sibling (right after it in an auto-layout flow).
    top.x = sel.x;
    top.y = sel.y + sel.h + 12;
    if (target.type === "frame" && target.layout) index = target.children.indexOf(sel.id) + 1;
  }
  insertNodes(nodes, target?.id ?? null, index);
  lintNodes([top.id]);
}
