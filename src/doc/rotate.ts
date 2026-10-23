import { studio } from "./store";
import { type Mat, invert, mul, parentWorldMatrix, place, placementOf, rotateDeg, selectionBounds, translate, worldMatrix } from "./geometry";
import { topLevelOf } from "./ops";

/**
 * ⌥⌘↑ / ⌥⌘↓ (Figma's Rotate 90° left / right): turn the selection a quarter about the centre of its
 * bounds. One layer turns in place; several also swap places around that centre, like flipNodes.
 * Positive degrees turn clockwise on screen. Returns how many layers turned.
 */
export function rotateNodes(ids: string[], deg: number): number {
  const doc = studio().doc;
  const tops = topLevelOf(doc, ids).filter((id) => !doc.nodes[id].locked);
  const b = selectionBounds(doc, tops);
  if (!b || !deg) return 0;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const turn: Mat = mul(translate(cx, cy), mul(rotateDeg(deg), translate(-cx, -cy)));
  studio().mutate((d) => {
    // Read every world matrix first: turning one layer must not move the next one's parent.
    const worlds = tops.map((id) => [id, mul(turn, worldMatrix(d, id))] as const);
    for (const [id, world] of worlds) {
      const n = d.nodes[id];
      place(n, placementOf(mul(invert(parentWorldMatrix(d, id)), world), n.w, n.h));
    }
  });
  return tops.length;
}
