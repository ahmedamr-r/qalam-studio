/*
 * Rulers (⇧R): tick spacing and labels along one axis. Pure; the renderer draws the strips.
 * Values are world px measured from an origin (the canvas, or the frame around the selection).
 */

export const RULER_SIZE = 20;

/** The smallest "nice" step (1, 2 or 5 × 10ⁿ world px) whose labels sit at least `minPx` apart. */
export function rulerStep(zoom: number, minPx = 56): number {
  const raw = minPx / Math.max(zoom, 1e-6);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw - 1e-9) return Math.max(1, m * p);
  return Math.max(1, 10 * p);
}

/** Minor ticks per labelled step: tenths for 1 and 10, quarters for 2… so ticks stay ≥ 4 px apart. */
export function minorDivisions(step: number, zoom: number): number {
  const lead = Math.round(step / Math.pow(10, Math.floor(Math.log10(step) + 1e-9)));
  for (const n of lead === 2 ? [4, 2] : lead === 5 ? [5] : [10, 5, 2]) if ((step / n) * zoom >= 4) return n;
  return 1;
}

export interface RulerTicks {
  /** Labelled ticks: screen position and the value shown. */
  major: { at: number; value: number }[];
  /** Unlabelled ticks, screen positions. */
  minor: number[];
}

/**
 * Ticks for a ruler `length` screen px long whose start shows world coordinate `start` (the
 * camera's x or y), at `zoom`, numbered from `origin` (world px).
 */
export function rulerTicks(start: number, length: number, zoom: number, origin = 0, minPx?: number): RulerTicks {
  const step = rulerStep(zoom, minPx);
  const div = minorDivisions(step, zoom);
  const end = start + length / zoom;
  const first = Math.floor((start - origin) / step) * step + origin;
  const major: RulerTicks["major"] = [];
  const minor: number[] = [];
  for (let w = first, guard = 0; w <= end + step && guard < 1000; w += step, guard++) {
    const at = (w - start) * zoom;
    if (at >= -step * zoom && at <= length + step * zoom) major.push({ at, value: Math.round((w - origin) * 100) / 100 });
    for (let i = 1; i < div; i++) {
      const m = (w + (step * i) / div - start) * zoom;
      if (m >= 0 && m <= length) minor.push(m);
    }
  }
  return { major: major.filter((t) => t.at >= -40 && t.at <= length + 40), minor };
}
