/*
 * Canvas cursors for the vector tools: 24 × 24 SVGs drawn twice, a white outline under an ink
 * stroke, so they read on light and dark canvases. Glyphs follow Lucide's pen, pencil and friends.
 */

export type VectorCursor = "pen" | "pen-add" | "pen-close" | "pen-remove" | "pen-continue" | "pencil" | "bend" | "bucket" | "scissors" | "point";

/** Lucide's pen nib, shrunk into the top-left so a badge fits clear of it at the lower right. */
const NIB_PATHS =
  '<path d="M15.7 21.3a1 1 0 0 1-1.4 0l-1.6-1.6a1 1 0 0 1 0-1.4l5.6-5.6a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4z"/><path d="m18 13-1.4-6.9a1 1 0 0 0-.7-.8L3.2 2a1 1 0 0 0-1.2 1.2l3.3 12.7a1 1 0 0 0 .8.7L13 18"/><path d="m2.3 2.3 7.3 7.3"/><circle cx="11" cy="11" r="2"/>';
const NIB_SCALE = 0.74;
const NIB = `<g class="nib" transform="translate(0.6 0.6) scale(${NIB_SCALE})">${NIB_PATHS}</g>`;

/** Badges at the lower right, clear of the nib. */
const BADGE: Record<string, string> = {
  add: '<path d="M19 15.5v7M15.5 19h7"/>',
  close: '<circle cx="19" cy="19" r="3"/>',
  remove: '<path d="M15.5 19h7"/>',
  continue: '<path d="m16 22.5 6-7"/>',
};

/** A filled arrow pointer (bend, point), drawn like the system cursor. */
const ARROW = '<path class="solid" d="M3 2.5v14.5l3.9-3.8 2.6 5.8 2.6-1.1-2.6-5.7h5.4z"/>';

const GLYPHS: Record<VectorCursor, { svg: string; hot: [number, number] }> = {
  pen: { svg: NIB, hot: [2, 2] },
  "pen-add": { svg: NIB + BADGE.add, hot: [2, 2] },
  "pen-close": { svg: NIB + BADGE.close, hot: [2, 2] },
  "pen-remove": { svg: NIB + BADGE.remove, hot: [2, 2] },
  "pen-continue": { svg: NIB + BADGE.continue, hot: [2, 2] },
  pencil: { svg: '<path d="M21.2 6.8a1 1 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8L2 21.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5z"/><path d="m15 5 4 4"/>', hot: [2, 22] },
  bend: { svg: ARROW + '<path d="M13.5 22c1.6-4.2 4.4-5.6 8-5.6"/>', hot: [3, 2] },
  bucket: { svg: '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/>', hot: [20, 21] },
  scissors: { svg: '<circle cx="6" cy="6" r="3"/><path d="M8.1 8.1 12 12"/><path d="M20 4 8.1 15.9"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>', hot: [12, 12] },
  point: { svg: ARROW + '<circle class="solid" cx="18.5" cy="18.5" r="2.4"/>', hot: [3, 2] },
};

const cache = new Map<VectorCursor, string>();

/** The CSS cursor value for a vector cursor (falls back to a crosshair). */
export function cursorCss(name: VectorCursor): string {
  let c = cache.get(name);
  if (!c) {
    const g = GLYPHS[name];
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
      // The shrunk nib's strokes are widened back to the same weight; solid parts fill with the ink.
      `<style>.halo .nib{stroke-width:${3.5 / NIB_SCALE}}.ink .nib{stroke-width:${1.5 / NIB_SCALE}}.ink .solid{fill:#111}.halo .solid{fill:#fff}</style>` +
      `<g class="halo" stroke="#fff" stroke-width="3.5">${g.svg}</g><g class="ink" stroke="#111" stroke-width="1.5">${g.svg}</g></svg>`;
    c = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${g.hot[0]} ${g.hot[1]}, crosshair`;
    cache.set(name, c);
  }
  return c;
}
