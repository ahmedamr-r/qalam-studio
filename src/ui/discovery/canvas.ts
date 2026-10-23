import type { Controller } from "@/engine/controller";
import { studio } from "@/doc/store";
import { worldBounds } from "@/doc/geometry";
import { getController } from "../CanvasView";

/**
 * Run once the canvas is up and has its size (a project that just opened): a fit computed against
 * an unmeasured canvas zooms all the way out.
 */
export function onCanvasReady(fn: (c: Controller) => void) {
  const go = () => {
    const c = getController();
    if (c && c.viewport.w > 0 && c.viewport.h > 0) fn(c);
    else requestAnimationFrame(go);
  };
  requestAnimationFrame(go);
}

/** Bring a layer into view at no more than 100% (a link to it: you see it, and what's around it). */
export function glideToLayer(c: Controller, id: string) {
  if (studio().doc.nodes[id]) c.glideTo(c.fitCamera(worldBounds(studio().doc, id), {}, 1));
}
