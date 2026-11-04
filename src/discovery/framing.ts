import type { Box } from "@/doc/geometry";

/*
 * Bringing cards into view (pure): where the camera should go to show them, or nowhere when they
 * can already be seen, so what's on screen doesn't jump for something already in sight.
 */

interface Cam {
  x: number;
  y: number;
  zoom: number;
}
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Below this a card can't be read: the camera comes in this far, however far out it was. */
const READABLE = 0.6;
/** Below this, cards too far apart to read together: the first of them is shown instead. */
const TOO_FAR = 0.35;

function around(boxes: readonly Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

function inView(b: Box, cam: Cam, view: { w: number; h: number }, i: Insets): boolean {
  const left = (b.x - cam.x) * cam.zoom;
  const top = (b.y - cam.y) * cam.zoom;
  return left >= i.left && top >= i.top && left + b.w * cam.zoom <= view.w - i.right && top + b.h * cam.zoom <= view.h - i.bottom;
}

/**
 * The camera that shows these cards, or null to stay put. It keeps the zoom they're working at
 * when the cards fit (never closer than 100%), and zooms out only as far as still reads.
 */
export function cameraShowing(boxes: readonly Box[], cam: Cam, view: { w: number; h: number }, insets: Insets, fit: (box: Box, insets: Insets, maxZoom: number) => Cam): Cam | null {
  if (!boxes.length) return null;
  const all = around(boxes);
  if (cam.zoom >= TOO_FAR && inView(all, cam, view, insets)) return null;
  const maxZoom = Math.min(1, Math.max(cam.zoom, READABLE));
  const whole = fit(all, insets, maxZoom);
  return whole.zoom >= TOO_FAR ? whole : fit(boxes[0], insets, maxZoom);
}
