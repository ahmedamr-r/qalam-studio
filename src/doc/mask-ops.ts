import type { Doc } from "./schema";
import { studio } from "./store";
import { makeFrame } from "./factory";
import { reparentIn, topLevelOf } from "./ops";
import { paintOrder } from "./group-fit";
import { isMaskGroup, isMaskLayer } from "./mask";

/** ⌃⌘M: make a mask group from the selection, or turn one back into a plain group (see mask.ts). */

const listOf = (d: Doc, parentId: string | null) => (parentId ? d.nodes[parentId].children : d.roots);

/** The mask group the selection is (or is the mask of), if any. */
function selectedMaskGroup(doc: Doc, ids: string[]): string | null {
  if (ids.length !== 1) return null;
  const n = doc.nodes[ids[0]];
  if (isMaskGroup(n)) return n.id;
  return n?.parentId && isMaskLayer(doc, n.id) ? n.parentId : null;
}

/** True, or why ⌃⌘M can't run on the selection. */
export function canMask(ids: string[]): true | string {
  const doc = studio().doc;
  if (selectedMaskGroup(doc, ids)) return true;
  const tops = topLevelOf(doc, ids).filter((id) => !doc.nodes[id].locked);
  if (tops.length < 2) return ids.length ? "Select the mask and the layers it masks" : "Select 2+ layers";
  return true;
}

/**
 * ⌃⌘M. On a mask group (or its mask): release the mask, keeping a plain group. Otherwise wrap the
 * selection in a new mask group, in the bottom-most layer's parent where the top-most one was;
 * that bottom-most layer becomes the mask. One undo step. Returns what happened.
 */
export function toggleMask(ids: string[]): "masked" | "unmasked" | null {
  const doc = studio().doc;
  const existing = selectedMaskGroup(doc, ids);
  if (existing) {
    studio().mutate((d) => {
      const g = d.nodes[existing];
      g.meta = { ...g.meta };
      delete g.meta.mask;
      if (g.name === "Mask group") g.name = "Group";
    });
    studio().select([existing]);
    return "unmasked";
  }
  if (canMask(ids) !== true) return null;
  const order = paintOrder(doc);
  const sorted = topLevelOf(doc, ids)
    .filter((id) => !doc.nodes[id].locked)
    .sort((a, b) => order.get(a)! - order.get(b)!);
  const parentId = doc.nodes[sorted[0]].parentId;
  const list = listOf(doc, parentId);
  const picked = new Set(sorted);
  const same = sorted.filter((id) => doc.nodes[id].parentId === parentId).map((id) => list.indexOf(id));
  const index = list.slice(0, Math.max(...same)).filter((id) => !picked.has(id)).length;
  const parent = parentId ? doc.nodes[parentId] : null;
  const group = makeFrame({
    name: "Mask group",
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    fill: null,
    radius: null,
    clip: false,
    dir: parent?.type === "frame" ? parent.dir : "ltr",
    meta: { source: "user", group: true, mask: true },
    ...(sorted.every((id) => doc.nodes[id].absolute) ? { absolute: true } : {}),
  });
  group.parentId = parentId;
  studio().mutate((d) => {
    // Like ⌘G: the group starts at its parent's origin and fitGroups wraps it around the mask.
    d.nodes[group.id] = group;
    reparentIn(d, sorted, group.id);
    const to = listOf(d, parentId);
    to.splice(Math.min(index, to.length), 0, group.id);
  });
  studio().select([group.id]);
  return "masked";
}
