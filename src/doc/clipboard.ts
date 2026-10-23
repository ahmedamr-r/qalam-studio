import type { SceneNode } from "./schema";
import { studio } from "./store";
import { cloneNode, newId } from "./factory";
import { descendants } from "./geometry";
import { deleteNodes, insertNodes, topLevelOf } from "./ops";

let clip: { tops: string[]; nodes: SceneNode[] } | null = null;

export const hasClipboard = () => !!clip;

export function copySelection() {
  const { doc, selection } = studio();
  const tops = topLevelOf(doc, selection);
  if (!tops.length) return;
  const ids = tops.flatMap((id) => [id, ...descendants(doc, id)]);
  clip = { tops, nodes: ids.map((id) => cloneNode(doc.nodes[id])) };
}

/** ⌘X: copy, then delete the unlocked layers, in one undo step. Returns how many were cut. */
export function cutSelection(): number {
  const { doc, selection } = studio();
  const ids = topLevelOf(doc, selection).filter((id) => !doc.nodes[id].locked);
  if (!ids.length) return 0;
  copySelection();
  deleteNodes(ids);
  return ids.length;
}

/** Fresh copies of the clipboard with new ids; returns them and the copies of the top layers. */
function cloneClip(): { nodes: SceneNode[]; tops: SceneNode[] } {
  const map = new Map<string, string>();
  for (const n of clip!.nodes) map.set(n.id, newId());
  const nodes = clip!.nodes.map((n) => {
    const c = cloneNode(n);
    c.id = map.get(n.id)!;
    c.parentId = n.parentId && map.has(n.parentId) ? map.get(n.parentId)! : null;
    c.children = n.children.map((ch) => map.get(ch)!).filter(Boolean);
    return c;
  });
  return { nodes, tops: nodes.filter((n) => n.parentId === null) };
}

/** Bounds of the clipboard's top layers in their own parent's space. */
function clipBox(tops: SceneNode[]) {
  const x0 = Math.min(...tops.map((n) => n.x));
  const y0 = Math.min(...tops.map((n) => n.y));
  const x1 = Math.max(...tops.map((n) => n.x + n.w));
  const y1 = Math.max(...tops.map((n) => n.y + n.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * ⌘V pastes into the selected frame, else next to the originals.
 * ⇧⌘V (`over`) pastes on top of the selected layer instead: same parent, just above it, at its position.
 */
export function pasteClipboard(opts: { over?: boolean } = {}) {
  if (!clip) return;
  const { doc, selection } = studio();
  const { nodes, tops } = cloneClip();
  const sel = selection.length ? doc.nodes[selection[0]] : undefined;
  if (opts.over && sel) {
    const list = sel.parentId ? doc.nodes[sel.parentId].children : doc.roots;
    const b = clipBox(tops);
    for (const n of tops) {
      n.x = Math.round(sel.x + n.x - b.x);
      n.y = Math.round(sel.y + n.y - b.y);
    }
    insertNodes(nodes, sel.parentId, list.indexOf(sel.id) + 1);
    return;
  }
  const target = selection.length === 1 && doc.nodes[selection[0]]?.type === "frame" && !clip.tops.includes(selection[0]) ? selection[0] : null;
  const originalParent = clip.nodes.find((n) => n.id === clip!.tops[0])?.parentId ?? null;
  const parent = target ?? (originalParent && doc.nodes[originalParent] ? originalParent : null);
  if (!target) {
    for (const n of tops) {
      if (!parent && n.type === "frame") n.x += n.w + 80;
      else {
        n.x += 16;
        n.y += 16;
      }
    }
  }
  insertNodes(nodes, parent);
}

/** ⇧⌘R: swap every selected layer for a copy of the clipboard, centred where it was. */
export function pasteToReplace(): number {
  if (!clip) return 0;
  const s = studio();
  const doc = s.doc;
  const targets = topLevelOf(doc, s.selection).filter((id) => !doc.nodes[id].locked);
  if (!targets.length) return 0;
  const created: string[] = [];
  s.beginTx();
  for (const id of targets) {
    const t = studio().doc.nodes[id];
    if (!t) continue;
    const list = t.parentId ? studio().doc.nodes[t.parentId].children : studio().doc.roots;
    const { nodes, tops } = cloneClip();
    const b = clipBox(tops);
    for (const n of tops) {
      n.x = Math.round(t.x + t.w / 2 - b.w / 2 + n.x - b.x);
      n.y = Math.round(t.y + t.h / 2 - b.h / 2 + n.y - b.y);
    }
    insertNodes(nodes, t.parentId, list.indexOf(id), false);
    created.push(...tops.map((n) => n.id));
    deleteNodes([id]);
  }
  s.commitTx();
  studio().select(created);
  return targets.length;
}
