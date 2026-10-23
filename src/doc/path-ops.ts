import type { Seg } from "@/design-system/svg-path";

/*
 * Area geometry (booleans, stroke outlines) is provided by the engine once CanvasKit is ready
 * (Skia's PathOps), the way text measurement is: doc/ stays engine-free, and tests can hand it a
 * real CanvasKit loaded in node or a fake. Geometry in and out is absolute moves, lines and
 * cubics, with its fill rule (Skia's results are even-odd).
 */

export type BoolOp = "union" | "subtract" | "intersect" | "exclude";

/** A filled region: its outline and fill rule (non-zero unless `evenOdd`). */
export interface Area {
  segs: Seg[];
  evenOdd?: boolean;
}

export interface StrokeStyle {
  width: number;
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
  /** Miter limit, as a multiple of half the width. Default 4 (the renderer's). */
  miter?: number;
}

export interface PathOps {
  /** a ∪ b, a − b, a ∩ b or a ⊕ b, without overlaps; no segments when nothing is left. Null if the op fails. */
  combine(a: Area, b: Area, op: BoolOp): Area | null;
  /** The region a stroke along `segs` paints, overlaps resolved. */
  stroke(segs: Seg[], style: StrokeStyle): Area | null;
}

let ops: PathOps | null = null;

export const setPathOps = (o: PathOps | null) => {
  ops = o;
};

/** Null until the engine has loaded (commands say "The canvas isn't ready yet"). */
export const pathOps = (): PathOps | null => ops;
