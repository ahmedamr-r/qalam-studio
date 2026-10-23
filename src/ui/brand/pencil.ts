/*
 * The Qalam mark's geometry, on a 24-unit grid: a pencil, eraser top right and point bottom left,
 * with a facet line along its body. Its graphite point is a separate nuqta (the calligrapher's dot),
 * which keeps the AI glyph's grammar: hollow while Qalam AI is working, filled when the run is done.
 * Shared by the studio mark, the Qalam AI glyph, the canvas painter and app/icon.svg (which copies
 * these paths; keep them in step). Drawn by video-edit/teaser/logo/pencil/gen.py.
 */

/** Eraser, body and cone, one even-odd path (the facet line is a cut in the body). */
export const PENCIL_PATH = "M20.22 1.5 22.5 3.78 22.5 5.92 21.56 6.85 17.15 2.44 18.08 1.5Z M16.51 3.07 20.93 7.49 11.89 16.52 7.48 12.11Z M6.84 12.74 11.26 17.16 5.77 19.17 4.83 18.23Z M17.68 5.85 10.25 13.28 10.86 13.88 18.28 6.45Z";

/** The same parts as polygons [x0, y0, x1, y1, …] for painters, without the facet (too fine to paint small). */
export const PENCIL_POLYGONS = [
  [20.22, 1.5, 22.5, 3.78, 22.5, 5.92, 21.56, 6.85, 17.15, 2.44, 18.08, 1.5],
  [16.51, 3.07, 20.93, 7.49, 11.89, 16.52, 7.48, 12.11],
  [6.84, 12.74, 11.26, 17.16, 5.77, 19.17, 4.83, 18.23],
] as const;

/** The nuqta point. */
export const NUQTA_PATH = "M3.37 18.75 5.25 20.63 3.37 22.5 1.5 20.63Z";
export const NUQTA_POLYGON = [3.37, 18.75, 5.25, 20.63, 3.37, 22.5, 1.5, 20.63] as const;
/** The nuqta's hollow: cut out while Qalam AI works, filled when it's done. */
export const NUQTA_HOLE_PATH = "M3.37 19.84 2.59 20.63 3.37 21.41 4.16 20.63Z";

/** Gradient axis for the AI glyph, from the eraser to the point, in grid units. */
export const PENCIL_AXIS = { x1: 22, y1: 2, x2: 2, y2: 22 } as const;
