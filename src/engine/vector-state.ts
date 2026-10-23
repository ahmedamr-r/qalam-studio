import { create } from "zustand";
import { studio, useStudio } from "@/doc/store";
import { busyIds, isBusy } from "@/doc/reservations";
import type { HandleRef, PointRef } from "@/doc/vector";

/*
 * Vector edit mode, as React-visible state of its own (the toolbar and Design panel react to it)
 * so store.ts stays untouched. The pen session and edit tools live in engine/vector-tools.ts.
 */

export type VectorSubTool = "move" | "pen" | "bend" | "paint" | "cut";

export interface VectorEditState {
  /** The path being edited, or null outside edit mode. */
  nodeId: string | null;
  tool: VectorSubTool;
  /** Selected anchors. */
  points: PointRef[];
  /** Selected handle. */
  handle: HandleRef | null;
  /** A pen path is in progress. */
  drawing: boolean;
  enter: (id: string, tool?: VectorSubTool) => boolean;
  exit: () => void;
  setTool: (t: VectorSubTool) => void;
  select: (points: PointRef[], add?: boolean) => void;
  selectHandle: (h: HandleRef | null) => void;
  setDrawing: (on: boolean) => void;
}

const sameRef = (a: PointRef, b: PointRef) => a.path === b.path && a.point === b.point;

/** Whether a node can be edited as a vector now (a path, unlocked, not being worked on by AI). */
export function canEditVector(id: string): boolean {
  const s = studio();
  const n = s.doc.nodes[id];
  return !!n && n.type === "path" && !n.locked && !isBusy(s.doc, id, busyIds());
}

export const useVectorEdit = create<VectorEditState>((set, get) => ({
  nodeId: null,
  tool: "move",
  points: [],
  handle: null,
  drawing: false,
  enter: (id, tool = "move") => {
    if (!canEditVector(id)) return false;
    set({ nodeId: id, tool, points: [], handle: null, drawing: false });
    return true;
  },
  exit: () => {
    if (get().nodeId) set({ nodeId: null, tool: "move", points: [], handle: null, drawing: false });
  },
  setTool: (tool) => set({ tool }),
  select: (points, add) => {
    const cur = get().points;
    if (!add) return set({ points, handle: null });
    const next = [...cur];
    for (const p of points) {
      const i = next.findIndex((q) => sameRef(p, q));
      if (i >= 0) next.splice(i, 1);
      else next.push(p);
    }
    set({ points: next, handle: null });
  },
  selectHandle: (handle) => set({ handle }),
  setDrawing: (drawing) => set({ drawing }),
}));

// Leave edit mode when its node goes away, the selection moves elsewhere or another tool is picked;
// drop selected points that no longer exist.
useStudio.subscribe((s, prev) => {
  const v = useVectorEdit.getState();
  if (!v.nodeId) return;
  if (s.doc !== prev.doc) {
    if (!canEditVector(v.nodeId)) return v.exit();
    const n = s.doc.nodes[v.nodeId];
    const paths = n.type === "path" && n.vector ? n.vector.paths : null;
    const live = (r: PointRef) => !paths || !!paths[r.path]?.points[r.point];
    if (!v.points.every(live)) useVectorEdit.setState({ points: v.points.filter(live) });
    if (v.handle && !live(v.handle)) useVectorEdit.setState({ handle: null });
  }
  if (s.selection !== prev.selection && !(s.selection.length === 1 && s.selection[0] === v.nodeId)) return v.exit();
  // The pen draws into the edited node; select is where Esc from the pen lands (sub-tool Move).
  if (s.tool !== prev.tool && s.tool !== "pen" && s.tool !== "select") return v.exit();
});
