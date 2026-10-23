/*
 * Selection cursors that follow the layer's angle: resize arrows pick the nearest system cursor,
 * and the rotate cursor (there is no system one) is a curved double arrow drawn like vector
 * cursors (cursors.ts): a white halo under an ink stroke, readable on any canvas.
 */

const RESIZE = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const;

/** The system resize cursor closest to a drag direction (degrees, screen space, y down). */
export function resizeCursor(deg: number): string {
  const k = Math.round((((deg % 180) + 180) % 180) / 45) % 4;
  return RESIZE[k];
}

const cache = new Map<number, string>();

/**
 * The rotate cursor for a corner whose outward direction is `deg` (screen, clockwise from +x),
 * in 15° steps so the cache stays small.
 */
export function rotateCursor(deg: number): string {
  const step = ((Math.round(deg / 15) * 15) % 360 + 360) % 360;
  let c = cache.get(step);
  if (!c) {
    // Drawn for a corner pointing down-right (45°), then turned to the corner's direction.
    const arc = '<path d="M14.74 5.49A12 12 0 0 1 5.49 14.74"/><path d="M12.12 7.33 14.74 5.49 16.38 8.24"/><path d="M8.24 16.38 5.49 14.74 7.33 12.12"/>';
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
      `<g transform="rotate(${step - 45} 12 12)">` +
      `<g stroke="#fff" stroke-width="3.5">${arc}</g><g stroke="#111" stroke-width="1.5">${arc}</g></g></svg>`;
    c = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, alias`;
    cache.set(step, c);
  }
  return c;
}
