/** Screen-space placement of DOM overlays (critique card, pill) next to world-space boxes. */
import type { Box } from "@/doc/geometry";

interface Cam {
  x: number;
  y: number;
  zoom: number;
}
interface Size {
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/** World box → screen box for the current camera. */
export function toScreenBox(b: Box, cam: Cam): Box {
  return { x: (b.x - cam.x) * cam.zoom, y: (b.y - cam.y) * cam.zoom, w: b.w * cam.zoom, h: b.h * cam.zoom };
}

/**
 * The camera that brings back a box the viewport's right side cuts off (a panel opened beside the
 * canvas), moving no further than its left edge; null when it's in, or can't come in any further.
 */
export function cameraKeeping(b: Box, cam: Cam, width: number, margin = 24): Cam | null {
  const s = toScreenBox(b, cam);
  const over = s.x + s.w + margin - width;
  if (over <= 0) return null;
  const by = Math.min(over, s.x - margin);
  return by > 0 ? { ...cam, x: cam.x + by / cam.zoom } : null;
}

/**
 * Put a fixed-size card beside `box`: right of it if it fits, else left, top-aligned with it,
 * and always clamped inside the viewport so it stays reachable when the screens are off-screen.
 */
export function placeCard(box: Box, cam: Cam, viewport: Size, card: Size, gap = 16, margin = 8): { left: number; top: number; side: "right" | "left" } {
  const s = toScreenBox(box, cam);
  let side: "right" | "left" = "right";
  let left = s.x + s.w + gap;
  if (left + card.w > viewport.w - margin && s.x - gap - card.w >= margin) {
    left = s.x - gap - card.w;
    side = "left";
  }
  return { left: clamp(left, margin, viewport.w - card.w - margin), top: clamp(s.y, margin, viewport.h - card.h - margin), side };
}
