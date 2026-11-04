/*
 * The Qalam mark's geometry, on a 24-unit grid: a lowercase q in one even stroke. Its bowl is the
 * shape of a card on the canvas, left open, and its tail leaves it the way a wire does. Qalam AI's
 * glyph is a pair of nuqtas (the calligrapher's dots): the big one an outline while Qalam AI is
 * working, filled when the run is done. Shared by the mark, the glyph and the canvas painter;
 * public/icon.svg and build/icon.svg copy the mark's path, so keep them in step.
 */

/** Stroked with MARK_STROKE, round caps and joins. */
export const MARK_PATH = "M21.4 22.6C19.4 21.2 18.6 19 18.6 15.4V8A5.2 5.2 0 0 0 13.4 2.8H8.4A5.2 5.2 0 0 0 3.2 8V11.8A5.2 5.2 0 0 0 8.4 17H14.6";
export const MARK_STROKE = 2.5;

/** Qalam AI's big nuqta, and the hollow cut out of it while Qalam AI works. */
export const AI_NUQTA_PATH = "M9.4 5.9 17.9 14.4 9.4 22.9 .9 14.4Z";
export const AI_HOLE_PATH = "M9.4 9.6 14.2 14.4 9.4 19.2 4.6 14.4Z";
/** Its small one. */
export const AI_SMALL_NUQTA_PATH = "M18.4 1.2 23 5.8 18.4 10.4 13.8 5.8Z";

/** The two as polygons [x0, y0, x1, y1, …] for painters, filled (too fine to cut out small). */
export const AI_NUQTA_POLYGON = [9.4, 5.9, 17.9, 14.4, 9.4, 22.9, 0.9, 14.4] as const;
export const AI_SMALL_NUQTA_POLYGON = [18.4, 1.2, 23, 5.8, 18.4, 10.4, 13.8, 5.8] as const;

/** Gradient axis for the AI glyph, from the small nuqta to the big one, in grid units. */
export const AI_AXIS = { x1: 22, y1: 2, x2: 2, y2: 22 } as const;
