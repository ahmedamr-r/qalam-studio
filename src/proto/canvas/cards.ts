/**
 * State cards (pure): read-only previews of a route's changed parts, drawn beside it on the canvas
 * so a reviewer sees them without playing the prototype — the header once the content scrolls
 * under it, a button until it's ready, a dish's + once it's in the basket. Each card is the
 * component rebuilt in that state (only the part that changes, never a copy of the screen) on the
 * screen's own background, with a wire from the original. They aren't in the document: they
 * follow the route as it changes, and View ▸ Prototype parts hides them with the rest.
 */
import type { Binding, Doc, Expr, RouteProto, SceneNode, SwapDef } from "@/doc/schema";
import { worldBounds, type Box } from "@/doc/geometry";
import { CATALOG_BY_NAME } from "@/design-system/components";
import { buildInstance, type Inst } from "@/design-system/builders";
import { instOf, stampInstances } from "@/design-system/instances";
import { ctxFor } from "@/design-system/refresh";
import { dsIdForNode } from "@/design-system/registry";
import { layoutToNodes } from "@/engine/layout";
import { findLayer, partFrames, refFrame } from "../routes";
import { PART_DROP, PART_GAP } from "../edit";

export interface StateCard {
  key: string;
  screen: string;
  /** The layer it shows another state of. */
  from: string;
  label: string;
  /** The card (world): the component, with room around it. */
  box: Box;
  /** The screen's background behind the component (#RRGGBB), when it has one. */
  bg?: string;
  /** The component's layers (root first), placed inside the card. */
  nodes: SceneNode[];
}

/** Room around a card's component, the narrowest a card gets, and the room between cards (world px). */
export const CARD_PAD = 16;
export const CARD_MIN_W = 160;
export const CARD_GAP = PART_GAP;
/** How wide a component another one turns into may grow (a + into a stepper). */
const SWAP_ROOM = 320;

const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** How a yes/no state reads: by the value it follows when that has a name ("Scrolled under the top bar"), else by the prop. */
function stateLabel(route: RouteProto, b: Binding & { kind: "prop" }, value: boolean): string {
  const e = b.e as Expr;
  const label = e && typeof e === "object" && "v" in e ? route.vars?.[e.v]?.label : undefined;
  if (label) return value ? upper(label) : `Not ${lower(label)}`;
  return value ? upper(b.prop) : `Not ${b.prop}`;
}

/** A swap's component with sample values in its slots ("{n}" → "1"). */
function sampleSwap(sw: SwapDef): Inst {
  const props = Object.fromEntries(Object.entries(sw.inst.props ?? {}).map(([k, v]) => [k, typeof v === "string" ? v.replace(/\{[a-z][A-Za-z0-9]*\}/g, "1") : v]));
  return { component: sw.inst.component, props } as Inst;
}

const built = new Map<string, SceneNode[]>();

/** A component built on its own at the origin (cached by what it's built from): `width` wide when it fills, else its own size. */
function build(doc: Doc, frame: string, inst: Inst, width: number, path: string | undefined, fill: boolean): SceneNode[] | null {
  const dsId = dsIdForNode(doc, frame);
  const key = `${dsId}|${frame}|${path}|${Math.round(width)}|${fill}|${JSON.stringify(inst)}`;
  const hit = built.get(key);
  if (hit) return hit;
  let nodes: SceneNode[];
  try {
    const ctx = ctxFor(doc, frame, dsId, path);
    const wrapper = { kind: "frame" as const, name: "card", width: Math.max(1, width), align: fill ? ("stretch" as const) : ("start" as const), children: [buildInstance(inst, ctx, path)] };
    nodes = layoutToNodes(wrapper, ctx, { x: 0, y: 0 }, "user").slice(1);
  } catch {
    return null;
  }
  if (!nodes.length) return null;
  nodes[0] = { ...nodes[0], parentId: null };
  stampInstances(nodes);
  if (built.size > 200) built.clear();
  built.set(key, nodes);
  return nodes;
}

const memo = new WeakMap<Doc, StateCard[]>();

/** Every route's state cards, in a row under the screen after its parts (memoized per document). */
export function stateCards(doc: Doc): StateCard[] {
  const hit = memo.get(doc);
  if (hit) return hit;
  const out: StateCard[] = [];
  for (const [screen, route] of Object.entries(doc.proto?.routes ?? {})) {
    if (doc.nodes[screen]?.type !== "frame") continue;
    const sb = worldBounds(doc, screen);
    const parts = partFrames(doc, screen).map((p) => worldBounds(doc, p.frame));
    let x = parts.length ? Math.max(sb.x, ...parts.map((b) => b.x + b.w)) + PART_GAP : sb.x;
    const y = sb.y + sb.h + PART_DROP;
    const add = (key: string, from: string, label: string, frame: string, nodes: SceneNode[] | null) => {
      if (!nodes?.length) return;
      const r = nodes[0];
      const w = Math.max(CARD_MIN_W, r.w + 2 * CARD_PAD);
      const h = r.h + 2 * CARD_PAD;
      const at = { x: x + (w - r.w) / 2, y: y + CARD_PAD };
      out.push({ key, screen, from, label, box: { x, y, w, h }, bg: doc.nodes[frame]?.fill?.color, nodes: nodes.map((m, i) => (i === 0 ? { ...m, ...at } : m)) });
      x += w + CARD_GAP;
    };
    // A component whose yes/no prop follows a value, in the state it isn't drawn in (one component: a list's rows each show their own).
    for (const [i, b] of (route.bindings ?? []).entries()) {
      if (b.kind !== "prop" || b.ref.path?.includes("*")) continue;
      const frame = refFrame(doc, screen, { part: b.ref.part });
      const id = frame && b.ref.path ? findLayer(doc, frame, b.ref.path) : null;
      const inst = id ? (instOf(doc, id) as Inst | undefined) : undefined;
      if (!frame || !id || !inst || CATALOG_BY_NAME.get(inst.component)?.props[b.prop]?.type !== "boolean") continue;
      const value = !(inst.props ?? {})[b.prop];
      const n = doc.nodes[id];
      add(`${screen}:b${i}`, id, stateLabel(route, b, value), frame, build(doc, frame, { ...inst, props: { ...inst.props, [b.prop]: value } }, n.w, n.meta.specPath, true));
    }
    // What a component turns into while a value holds (a list's first row, with sample values).
    for (const [i, sw] of (route.swaps ?? []).entries()) {
      const frame = refFrame(doc, screen, { part: sw.ref.part });
      const id = frame && sw.ref.path ? findLayer(doc, frame, sw.ref.path) : null;
      if (!frame || !id) continue;
      const n = doc.nodes[id];
      add(`${screen}:s${i}`, id, sw.label, frame, build(doc, frame, sampleSwap(sw), Math.max(n.w, SWAP_ROOM), n.meta.specPath, false));
    }
  }
  memo.set(doc, out);
  return out;
}

const docs = new WeakMap<Doc, Doc>();

/** The cards' layers as a document of their own, for the renderer (a root per card's component). */
export function cardDoc(doc: Doc): Doc {
  const hit = docs.get(doc);
  if (hit) return hit;
  const d: Doc = { nodes: {}, roots: [] };
  for (const c of stateCards(doc)) {
    const root = c.nodes[0];
    if (d.nodes[root.id]) continue;
    for (const n of c.nodes) d.nodes[n.id] = n;
    d.roots.push(root.id);
  }
  docs.set(doc, d);
  return d;
}
