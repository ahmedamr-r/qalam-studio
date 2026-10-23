import type { Doc, SceneNode } from "./schema";

/**
 * Keyboard selection moves (Figma): pure functions from a selection to the next one, so the
 * commands stay one-liners and the rules are testable without a canvas.
 */

const listOf = (doc: Doc, parentId: string | null) => (parentId ? (doc.nodes[parentId]?.children ?? []) : doc.roots);
const unique = (ids: string[]) => [...new Set(ids)];

/** ⇧↵ / \: the parents of every selected layer. Top-level layers have none, so they stay. */
export function parentsOf(doc: Doc, selection: string[]): string[] {
  const out = selection.filter((id) => doc.nodes[id]).map((id) => doc.nodes[id].parentId ?? id);
  return unique(out);
}

/** ↵: the children of every selected layer (layers without children stay selected). */
export function childrenOf(doc: Doc, selection: string[]): string[] {
  const out = selection
    .filter((id) => doc.nodes[id])
    .flatMap((id) => {
      const kids = doc.nodes[id].children.filter((c) => doc.nodes[c] && !doc.nodes[c].locked);
      return kids.length ? kids : [id];
    });
  return unique(out);
}

/**
 * ⇥ / ⇧⇥: each selected layer's next (or previous) visible sibling, wrapping around.
 * In layer-panel order: the top row first, like Figma (the top row is the last child).
 * With nothing selected, Tab picks the top-most top-level layer.
 */
export function siblingStep(doc: Doc, selection: string[], dir: 1 | -1): string[] {
  const live = selection.filter((id) => doc.nodes[id]);
  if (!live.length) {
    const roots = doc.roots.filter((id) => doc.nodes[id]?.visible);
    if (!roots.length) return [];
    return [dir === 1 ? roots[roots.length - 1] : roots[0]];
  }
  const out = live.map((id) => {
    const list = listOf(doc, doc.nodes[id].parentId).filter((s) => s === id || (doc.nodes[s]?.visible && !doc.nodes[s].locked));
    const i = list.indexOf(id);
    // Panel order runs from the last child down, so "next" goes to a lower index.
    const j = (i - dir + list.length) % list.length;
    return list[j];
  });
  return unique(out);
}

/** ⌘A: every unlocked layer next to the first selected one, or every top-level layer. */
export function selectAllAtLevel(doc: Doc, selection: string[]): string[] {
  const first = selection[0] ? doc.nodes[selection[0]] : undefined;
  const list = first ? listOf(doc, first.parentId) : doc.roots;
  return list.filter((id) => doc.nodes[id] && !doc.nodes[id].locked);
}

/** ⇧⌘A: the unselected, unlocked, visible layers next to the selected ones. */
export function inverseOf(doc: Doc, selection: string[]): string[] {
  const picked = new Set(selection);
  const parents = unique(selection.filter((id) => doc.nodes[id]).map((id) => doc.nodes[id].parentId ?? ""));
  return parents.flatMap((p) => listOf(doc, p || null).filter((id) => !picked.has(id) && doc.nodes[id]?.visible && !doc.nodes[id].locked));
}

/**
 * N / ⇧N: the next (or previous) top-level frame in reading order: rows top to bottom (frames
 * whose tops are within half a frame of each other share a row), then left to right. Starts from
 * the selection's screen; wraps around.
 */
export function frameStep(doc: Doc, selection: string[], dir: 1 | -1): string | null {
  const frames = doc.roots.filter((id) => doc.nodes[id]?.type === "frame" && doc.nodes[id].visible);
  if (!frames.length) return null;
  const order = readingOrder(doc, frames);
  let top = selection[0] && doc.nodes[selection[0]] ? selection[0] : null;
  while (top && doc.nodes[top].parentId) top = doc.nodes[top].parentId;
  const i = top ? order.indexOf(top) : -1;
  if (i < 0) return dir === 1 ? order[0] : order[order.length - 1];
  return order[(i + dir + order.length) % order.length];
}

export function readingOrder(doc: Doc, ids: string[]): string[] {
  const sorted = [...ids].sort((a, b) => doc.nodes[a].y - doc.nodes[b].y);
  const rows: string[][] = [];
  for (const id of sorted) {
    const n = doc.nodes[id];
    const row = rows[rows.length - 1];
    const head = row && doc.nodes[row[0]];
    if (head && n.y - head.y < Math.min(head.h, n.h) / 2) row.push(id);
    else rows.push([id]);
  }
  return rows.flatMap((r) => r.sort((a, b) => doc.nodes[a].x - doc.nodes[b].x));
}

/**
 * What makes two layers "the same" for ⌥⌘A: the component they were built from, or else their
 * type and look (paints, corners, shadows, type style, icon). Size, position and text don't count.
 */
export function matchKey(n: SceneNode): string {
  if (n.meta.component) return `component:${n.meta.component}`;
  const paint = (p: { token?: string; color: string; gradient?: unknown } | null) => (p ? (p.token ?? (p.gradient ? JSON.stringify(p.gradient) : p.color)) : "-");
  const corners = n.radius ? (n.radius.token ?? [n.radius.tl, n.radius.tr, n.radius.br, n.radius.bl].map((c) => `${c.rx}/${c.ry}`).join(",")) : "-";
  const kind = n.type === "frame" && n.meta.group ? "group" : n.type;
  return [
    kind,
    paint(n.fill),
    n.stroke ? `${paint(n.stroke)}@${n.stroke.widthToken ?? n.stroke.width}` : "-",
    corners,
    n.shadowToken ?? (n.effects?.length ? JSON.stringify(n.effects) : "-"),
    n.type === "text" ? (n.text.typeToken ?? `${n.text.fontFamily}/${n.text.fontSize}/${n.text.fontWeight}/${n.text.lineHeight}`) : "",
    n.type === "icon" ? n.icon : n.type === "image" ? n.src : "",
  ].join("|");
}

/** ⌥⌘A: every visible, unlocked layer in the document that matches a selected one (the selection included). */
export function matchingOf(doc: Doc, selection: string[]): string[] {
  const keys = new Set(selection.filter((id) => doc.nodes[id]).map((id) => matchKey(doc.nodes[id])));
  if (!keys.size) return [];
  const out: string[] = [];
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!n || !n.visible || n.locked) return;
    if (keys.has(matchKey(n))) out.push(id);
    n.children.forEach(walk);
  };
  doc.roots.forEach(walk);
  return out;
}
