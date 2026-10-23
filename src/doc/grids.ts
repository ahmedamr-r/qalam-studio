import type { Box } from "./geometry";
import type { FrameNode, LayoutGrid } from "./schema";
import { studio } from "./store";

/*
 * Layout grids on frames (Figma's columns, rows and square grid). The geometry is pure and in the
 * frame's own coordinates; the renderer draws it over the frame's content when ⌃G is on. The
 * edits below are one undo step each, for the Design panel and the command palette.
 */

/** Figma's defaults: 10 px squares, or 5 stretched bands 20 px apart, all red at 10 %. */
export function defaultGrid(kind: LayoutGrid["kind"] = "columns"): LayoutGrid {
  if (kind === "grid") return { kind, count: 0, size: 10, gutter: 0, margin: 0, align: "stretch", color: "#FF00001A" };
  return { kind, count: 5, size: 64, gutter: 20, margin: 0, align: "stretch", color: "#FF00001A" };
}

/** Bands along one axis of `length`: [start, size] pairs. */
export function bandSpans(g: Pick<LayoutGrid, "count" | "size" | "gutter" | "margin" | "align">, length: number): [number, number][] {
  const gutter = Math.max(0, g.gutter);
  if (g.align === "stretch") {
    const n = Math.max(1, Math.round(g.count) || 1);
    const margin = Math.max(0, g.margin);
    const band = (length - 2 * margin - gutter * (n - 1)) / n;
    if (!(band > 0)) return [];
    return Array.from({ length: n }, (_, i) => [margin + i * (band + gutter), band]);
  }
  const size = Math.max(0, g.size);
  if (!(size > 0)) return [];
  // Count 0 = as many bands as fit (Figma's "Auto").
  const n = Math.round(g.count) > 0 ? Math.round(g.count) : Math.max(0, Math.floor((length - Math.max(0, g.margin) + gutter) / (size + gutter)));
  if (!n) return [];
  const total = n * size + (n - 1) * gutter;
  const start = g.align === "start" ? g.margin : g.align === "end" ? length - g.margin - total : (length - total) / 2;
  return Array.from({ length: n }, (_, i) => [start + i * (size + gutter), size]);
}

/** Column or row bands of a grid on a w × h frame (empty for the square grid). */
export function gridBands(g: LayoutGrid, w: number, h: number): Box[] {
  if (g.kind === "columns") return bandSpans(g, w).map(([x, bw]) => ({ x, y: 0, w: bw, h }));
  if (g.kind === "rows") return bandSpans(g, h).map(([y, bh]) => ({ x: 0, y, w, h: bh }));
  return [];
}

/** The square grid's inner lines on a w × h frame (none for bands, or when the cell is under 1 px). */
export function gridLines(g: LayoutGrid, w: number, h: number): { xs: number[]; ys: number[] } {
  if (g.kind !== "grid" || !(g.size >= 1)) return { xs: [], ys: [] };
  const along = (len: number) => {
    const out: number[] = [];
    for (let v = g.size; v < len - 1e-6 && out.length < 4000; v += g.size) out.push(v);
    return out;
  };
  return { xs: along(w), ys: along(h) };
}

/** Frames that can carry layout grids (groups can't, like Figma). */
export function gridFrames(ids: string[]): string[] {
  const doc = studio().doc;
  return ids.filter((id) => {
    const n = doc.nodes[id];
    return n?.type === "frame" && !n.meta.group;
  });
}

/** Add a grid to each frame. Returns how many frames got one. */
export function addLayoutGrid(ids: string[], kind: LayoutGrid["kind"] = "columns"): number {
  const frames = gridFrames(ids);
  if (!frames.length) return 0;
  studio().mutate((d) => {
    for (const id of frames) {
      const f = d.nodes[id] as FrameNode;
      f.grids = [...(f.grids ?? []), defaultGrid(kind)];
    }
  });
  return frames.length;
}

/** Remove every grid from the frames. Returns how many frames had some. */
export function removeLayoutGrids(ids: string[]): number {
  const doc = studio().doc;
  const frames = gridFrames(ids).filter((id) => (doc.nodes[id] as FrameNode).grids?.length);
  if (frames.length) studio().mutate((d) => frames.forEach((id) => void delete (d.nodes[id] as FrameNode).grids));
  return frames.length;
}

/** Change one grid of a frame. */
export function setLayoutGrid(id: string, index: number, patch: Partial<LayoutGrid>) {
  const f = studio().doc.nodes[id];
  if (f?.type !== "frame" || !f.grids?.[index]) return;
  studio().mutate((d) => {
    const grids = (d.nodes[id] as FrameNode).grids!;
    grids[index] = { ...grids[index], ...patch };
  });
}

/** Remove one grid of a frame. */
export function removeLayoutGrid(id: string, index: number) {
  const f = studio().doc.nodes[id];
  if (f?.type !== "frame" || !f.grids?.[index]) return;
  studio().mutate((d) => {
    const n = d.nodes[id] as FrameNode;
    n.grids = n.grids!.filter((_, i) => i !== index);
    if (!n.grids.length) delete n.grids;
  });
}
