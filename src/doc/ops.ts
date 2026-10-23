import type { Doc, SceneNode, TextNode } from "./schema";
import { studio } from "./store";
import { newId, cloneNode } from "./factory";
import { apply, descendants, freeSlotRight, invert, isDescendant, mul, parentWorldMatrix, place, placementOf, worldMatrix, worldBounds } from "./geometry";
import { measureText } from "./measure";

export { measureText, setTextMeasurer, type TextMeasurer } from "./measure";

/** Resize a text node to its content according to its autoSize mode (mutates). */
export function fitText(n: TextNode) {
  if (n.text.autoSize === "fixed") return;
  if (n.text.autoSize === "width") {
    const m = measureText(n.text, null);
    n.w = Math.ceil(m.w);
    n.h = Math.ceil(m.h);
  } else {
    const m = measureText(n.text, n.w);
    n.h = Math.ceil(m.h);
  }
}

// ---------------------------------------------------------------------------

function listOf(d: Doc, parentId: string | null): string[] {
  return parentId ? d.nodes[parentId].children : d.roots;
}

/**
 * Insert a subtree. `nodes` may include descendants (with parentId pointing inside the list);
 * nodes whose parent is not in the list are attached to `parentId`.
 */
export function insertNodes(nodes: SceneNode[], parentId: string | null, index?: number, select = true) {
  const ids = new Set(nodes.map((n) => n.id));
  const tops = nodes.filter((n) => !n.parentId || !ids.has(n.parentId));
  studio().mutate((d) => {
    for (const n of nodes) d.nodes[n.id] = n;
    const list = listOf(d, parentId);
    const at = index === undefined ? list.length : index;
    tops.forEach((n, i) => {
      n.parentId = parentId;
      list.splice(at + i, 0, n.id);
    });
  });
  if (select) studio().select(tops.map((n) => n.id));
}

export function updateNode(id: string, fn: (n: SceneNode, d: Doc) => void) {
  studio().mutate((d) => {
    const n = d.nodes[id];
    if (n) fn(n, d);
  });
}

export function updateNodes(ids: string[], fn: (n: SceneNode, d: Doc) => void) {
  studio().mutate((d) => {
    for (const id of ids) {
      const n = d.nodes[id];
      if (n) fn(n, d);
    }
  });
}

export function deleteNodes(ids: string[]) {
  if (!ids.length) return;
  studio().mutate((d) => {
    for (const id of ids) {
      const n = d.nodes[id];
      if (!n) continue;
      for (const c of descendants(d, id)) delete d.nodes[c];
      const list = listOf(d, n.parentId);
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
      delete d.nodes[id];
    }
  });
  studio().select([]);
}

/** Top-most ids only (drop ids whose ancestor is also in the list). */
export function topLevelOf(doc: Doc, ids: string[]): string[] {
  return ids.filter((id) => doc.nodes[id] && !ids.some((o) => o !== id && isDescendant(doc, id, o)));
}

export function duplicate(ids: string[]) {
  const doc = studio().doc;
  const tops = topLevelOf(doc, ids);
  const created: string[] = [];
  studio().mutate((d) => {
    for (const id of tops) {
      const map = new Map<string, string>();
      const copyTree = (srcId: string, parentId: string | null): string => {
        const src = d.nodes[srcId];
        const c = cloneNode(src);
        c.id = newId();
        map.set(srcId, c.id);
        c.parentId = parentId;
        c.children = src.children.map((ch) => copyTree(ch, c.id));
        d.nodes[c.id] = c;
        return c.id;
      };
      const src = d.nodes[id];
      const cid = copyTree(id, src.parentId);
      const copy = d.nodes[cid];
      if (!src.parentId && src.type === "frame") copy.x = freeSlotRight(d, { x: src.x, y: src.y, w: src.w, h: src.h }, 80, cid);
      else {
        copy.x += 16;
        copy.y += 16;
      }
      copy.name = src.name;
      const list = listOf(d, src.parentId);
      list.splice(list.indexOf(id) + 1, 0, cid);
      created.push(cid);
    }
  });
  studio().select(created);
}

/** Move nodes under a new parent while keeping their on-canvas position. */
export function reparent(ids: string[], newParentId: string | null, index?: number) {
  studio().mutate((d) => reparentIn(d, ids, newParentId, index));
}

/** `reparent` inside a recipe (group, ungroup), so several moves make one edit. */
export function reparentIn(d: Doc, ids: string[], newParentId: string | null, index?: number) {
  const pInv = newParentId ? invert(worldMatrix(d, newParentId)) : invert([1, 0, 0, 1, 0, 0]);
  let at = index;
  for (const id of topLevelOf(d, ids)) {
    const n = d.nodes[id];
    if (!n || id === newParentId || (newParentId && isDescendant(d, newParentId, id))) continue;
    // Keep the world matrix: solve local = T(x+cx, y+cy)·R·F·T(-cx,-cy) for x, y, rotation and flip.
    place(n, placementOf(mul(pInv, worldMatrix(d, id)), n.w, n.h));
    const from = listOf(d, n.parentId);
    from.splice(from.indexOf(id), 1);
    n.parentId = newParentId;
    const to = listOf(d, newParentId);
    if (at === undefined) to.push(id);
    else to.splice(at++, 0, id);
  }
}

export function reorder(id: string, where: "forward" | "backward" | "front" | "back") {
  studio().mutate((d) => {
    const n = d.nodes[id];
    if (!n) return;
    const list = listOf(d, n.parentId);
    const i = list.indexOf(id);
    list.splice(i, 1);
    const j =
      where === "front" ? list.length : where === "back" ? 0 : where === "forward" ? Math.min(i + 1, list.length) : Math.max(i - 1, 0);
    list.splice(j, 0, id);
  });
}

/** Wrap nodes (same parent) in a new frame sized to their bounds. */
export function frameSelection(ids: string[], makeFrame: (b: { x: number; y: number; w: number; h: number }) => SceneNode) {
  const d0 = studio().doc;
  const tops = topLevelOf(d0, ids);
  if (!tops.length) return;
  const parentId = d0.nodes[tops[0]].parentId;
  if (tops.some((id) => d0.nodes[id].parentId !== parentId)) return;
  const pts = tops.map((id) => worldBounds(d0, id));
  const x0 = Math.min(...pts.map((b) => b.x));
  const y0 = Math.min(...pts.map((b) => b.y));
  const x1 = Math.max(...pts.map((b) => b.x + b.w));
  const y1 = Math.max(...pts.map((b) => b.y + b.h));
  const pInv = invert(parentWorldMatrix(d0, tops[0]));
  const tl = apply(pInv, { x: x0, y: y0 });
  const frame = makeFrame({ x: tl.x, y: tl.y, w: x1 - x0, h: y1 - y0 });
  const list = parentId ? d0.nodes[parentId].children : d0.roots;
  const index = Math.min(...tops.map((id) => list.indexOf(id)));
  studio().beginTx();
  insertNodes([frame], parentId, index, false);
  reparent(tops, frame.id);
  studio().commitTx();
  studio().select([frame.id]);
}

/**
 * Layer order for a whole selection (⌘] ⌘[ ⌥⌘] ⌥⌘[), per parent, in one undo step. Selected layers
 * keep their order among themselves: forward/backward move each one step unless a selected
 * neighbour blocks it (so they never leapfrog), front/back move them as a block.
 */
export function reorderMany(ids: string[], where: "forward" | "backward" | "front" | "back") {
  const doc = studio().doc;
  const live = ids.filter((id) => doc.nodes[id]);
  if (!live.length) return;
  const parents = new Set(live.map((id) => doc.nodes[id].parentId));
  studio().mutate((d) => {
    for (const p of parents) {
      const list = listOf(d, p);
      const picked = new Set(live.filter((id) => d.nodes[id].parentId === p));
      const next = reorderList(list, picked, where);
      list.splice(0, list.length, ...next);
    }
  });
}

/** The new order of one child list (exported for tests). */
export function reorderList(list: string[], picked: Set<string>, where: "forward" | "backward" | "front" | "back"): string[] {
  const out = [...list];
  if (where === "front") return [...out.filter((id) => !picked.has(id)), ...out.filter((id) => picked.has(id))];
  if (where === "back") return [...out.filter((id) => picked.has(id)), ...out.filter((id) => !picked.has(id))];
  if (where === "forward") {
    for (let i = out.length - 2; i >= 0; i--) {
      if (picked.has(out[i]) && !picked.has(out[i + 1])) [out[i], out[i + 1]] = [out[i + 1], out[i]];
    }
  } else {
    for (let i = 1; i < out.length; i++) {
      if (picked.has(out[i]) && !picked.has(out[i - 1])) [out[i], out[i - 1]] = [out[i - 1], out[i]];
    }
  }
  return out;
}
