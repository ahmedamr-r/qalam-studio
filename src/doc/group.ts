import type { Doc, FrameNode } from "./schema";
import { studio } from "./store";
import { makeFrame } from "./factory";
import { reparentIn, topLevelOf } from "./ops";
import { hasAutoLayout } from "./autolayout";
import { childBox, isGroup, paintOrder, setBox } from "./group-fit";

export { childBox, fitGroups, isGroup, paintOrder } from "./group-fit";

/** Group, ungroup and resize to fit (⌘G, ⇧⌘G, ⌥⇧⌘R). Groups themselves: see group-fit.ts. */

const listOf = (d: Doc, parentId: string | null) => (parentId ? d.nodes[parentId].children : d.roots);

// ---------------------------------------------------------------------------
// commands

const groupCount = (doc: Doc) => Object.values(doc.nodes).filter((n) => isGroup(n)).length;

/**
 * ⌘G: put the selection in a new group, in the parent of the first selected layer, where the
 * top-most selected layer was. Children keep their stacking order and their place on the canvas.
 */
export function groupSelection(ids: string[]): string | null {
  const doc = studio().doc;
  const tops = topLevelOf(doc, ids);
  if (!tops.length) return null;
  const parentId = doc.nodes[tops[0]].parentId;
  const order = paintOrder(doc);
  const sorted = [...tops].sort((a, b) => order.get(a)! - order.get(b)!);
  const list = listOf(doc, parentId);
  const picked = new Set(tops);
  const topIndex = Math.max(...tops.filter((id) => doc.nodes[id].parentId === parentId).map((id) => list.indexOf(id)));
  const index = list.slice(0, topIndex).filter((id) => !picked.has(id)).length;
  const group = makeFrame({
    name: `Group ${groupCount(doc) + 1}`,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    fill: null,
    radius: null,
    clip: false,
    dir: parentId && doc.nodes[parentId].type === "frame" ? (doc.nodes[parentId] as FrameNode).dir : "ltr",
    meta: { source: "user", group: true },
    // In auto layout the group takes the flow slot (or stays out of it, like its layers were).
    ...(tops.every((id) => doc.nodes[id].absolute) ? { absolute: true } : {}),
  });
  group.parentId = parentId;
  studio().mutate((d) => {
    // The group starts at its parent's origin; fitGroups wraps its box around the layers after.
    d.nodes[group.id] = group;
    reparentIn(d, sorted, group.id);
    const to = listOf(d, parentId);
    to.splice(Math.min(index, to.length), 0, group.id);
  });
  studio().select([group.id]);
  return group.id;
}

/**
 * ⇧⌘G / ⌘⌫: release the children of the selected groups (and frames) into their parent, where the
 * group was, keeping their place on the canvas. Selects the released layers.
 */
export function ungroupSelection(ids: string[]): string[] {
  const doc = studio().doc;
  const targets = topLevelOf(doc, ids).filter((id) => doc.nodes[id]?.type === "frame" && doc.nodes[id].children.length && !doc.nodes[id].locked);
  if (!targets.length) return [];
  const released: string[] = [];
  studio().mutate((d) => {
    for (const id of targets) {
      const g = d.nodes[id];
      const kids = [...g.children];
      const list = listOf(d, g.parentId);
      reparentIn(d, kids, g.parentId, list.indexOf(id));
      for (const k of kids) {
        // Out of a group that sat outside the flow, they stay outside it.
        if (g.absolute) d.nodes[k].absolute = true;
        // Fill only means something inside auto layout.
        if (d.nodes[k].sizeH === "fill") d.nodes[k].sizeH = "fixed";
        if (d.nodes[k].sizeV === "fill") d.nodes[k].sizeV = "fixed";
      }
      list.splice(list.indexOf(id), 1);
      delete d.nodes[id];
      released.push(...kids);
    }
  });
  studio().select(released.filter((id) => studio().doc.nodes[id]));
  return released;
}

/**
 * ⌥⇧⌘R: frames shrink or grow to their content without moving it; auto-layout frames hug it.
 * Returns how many frames changed.
 */
export function resizeToFit(ids: string[]): number {
  const doc = studio().doc;
  const targets = ids.filter((id) => {
    const n = doc.nodes[id];
    return n?.type === "frame" && !isGroup(n) && !n.locked && n.children.length > 0;
  });
  if (!targets.length) return 0;
  let count = 0;
  studio().mutate((d) => {
    for (const id of targets) {
      const n = d.nodes[id];
      if (hasAutoLayout(n)) {
        if (n.sizeH !== "hug" || n.sizeV !== "hug") count++;
        n.sizeH = "hug";
        n.sizeV = "hug";
        continue;
      }
      const b = childBox(d.nodes, id);
      if (b && setBox(d.nodes, (k) => d.nodes[k], id, b)) count++;
    }
  });
  return count;
}
