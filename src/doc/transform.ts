import type { Doc, Effect, Radius, SceneNode } from "./schema";
import { studio } from "./store";
import { type Mat, descendants, invert, mul, parentWorldMatrix, place, placementOf, selectionBounds, worldMatrix } from "./geometry";
import { topLevelOf } from "./ops";

/** Flip (⇧H / ⇧V) and the Scale tool (K): transforms that change more than a box. */

/**
 * ⇧H / ⇧V: mirror the selection across the centre line of its bounds, like Figma. One layer flips
 * in place; several also swap places. A flip is stored as flipH plus a rotation (see placementOf).
 * Returns how many layers flipped.
 */
export function flipNodes(ids: string[], axis: "h" | "v"): number {
  const doc = studio().doc;
  const tops = topLevelOf(doc, ids).filter((id) => !doc.nodes[id].locked);
  const b = selectionBounds(doc, tops);
  if (!b) return 0;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const mirror: Mat = axis === "h" ? [-1, 0, 0, 1, 2 * cx, 0] : [1, 0, 0, -1, 0, 2 * cy];
  studio().mutate((d) => {
    // Read every world matrix first: flipping one layer must not move the next one's parent.
    const worlds = tops.map((id) => [id, mul(mirror, worldMatrix(d, id))] as const);
    for (const [id, world] of worlds) {
      const n = d.nodes[id];
      place(n, placementOf(mul(invert(parentWorldMatrix(d, id)), world), n.w, n.h));
    }
  });
  return tops.length;
}

// ---------------------------------------------------------------------------
// Scale tool

const r2 = (v: number) => Math.round(v * 100) / 100;

function scaleRadius(r: Radius, k: number): Radius {
  const c = (x: { rx: number; ry: number }) => ({ rx: r2(x.rx * k), ry: r2(x.ry * k) });
  const { token, ...rest } = r;
  void token;
  return { ...rest, tl: c(r.tl), tr: c(r.tr), br: c(r.br), bl: c(r.bl) };
}

const scaleEffect = (e: Effect, k: number): Effect => ({ ...e, x: r2(e.x * k), y: r2(e.y * k), blur: r2(e.blur * k), spread: r2(e.spread * k) });

/**
 * What the Scale tool scales besides the box: stroke widths, corner radii, shadows, type, auto
 * layout spacing and size limits. `from` is the layer as it was when the drag started; values
 * scaled away from their tokens no longer follow them (k = 1 restores them as they were).
 */
function scaleProps(n: SceneNode, from: SceneNode, k: number) {
  const same = Math.abs(k - 1) < 1e-3;
  if (from.stroke) {
    const { widthToken, ...rest } = from.stroke;
    n.stroke = same ? from.stroke : { ...rest, width: r2(from.stroke.width * k) };
    void widthToken;
  }
  if (from.radius) n.radius = same ? from.radius : scaleRadius(from.radius, k);
  if (from.effects) n.effects = same ? from.effects : from.effects.map((e) => scaleEffect(e, k));
  if (!same && from.shadowToken) delete n.shadowToken;
  else if (from.shadowToken) n.shadowToken = from.shadowToken;
  for (const key of ["minW", "maxW", "minH", "maxH"] as const) if (from[key] !== undefined) n[key] = r2(from[key]! * k);
  if (n.type === "text" && from.type === "text") {
    const t = from.text;
    n.text = same
      ? t
      : { ...t, fontSize: r2(t.fontSize * k), lineHeight: r2(t.lineHeight * k), letterSpacing: r2(t.letterSpacing * k), typeToken: undefined };
  }
  if (n.type === "frame" && from.type === "frame" && from.layout) {
    const l = from.layout;
    n.layout = same
      ? l
      : {
          ...l,
          gap: r2(l.gap * k),
          crossGap: r2(l.crossGap * k),
          padding: { top: r2(l.padding.top * k), end: r2(l.padding.end * k), bottom: r2(l.padding.bottom * k), start: r2(l.padding.start * k) },
          gapToken: undefined,
          crossGapToken: undefined,
          paddingTokens: undefined,
        };
  }
}

/**
 * Scale tool (K): after a resize set the layer's new box, scale everything else about it by `k`
 * from where the drag started (`base`): its own strokes, radii, effects and type, and every layer
 * inside it, box and all. Call inside a recipe; `d` is the draft.
 */
export function scaleTree(d: Doc, base: Doc, id: string, k: number) {
  const from = base.nodes[id];
  const n = d.nodes[id];
  if (!from || !n) return;
  scaleProps(n, from, k);
  for (const cid of descendants(base, id)) {
    const c = d.nodes[cid];
    const o = base.nodes[cid];
    if (!c || !o) continue;
    c.x = r2(o.x * k);
    c.y = r2(o.y * k);
    c.w = r2(o.w * k);
    c.h = r2(o.h * k);
    scaleProps(c, o, k);
  }
}
