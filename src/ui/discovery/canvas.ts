import type { Controller } from "@/engine/controller";
import { studio } from "@/doc/store";
import { worldBounds } from "@/doc/geometry";
import { cameraKeeping } from "../ai/anchor";
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

/** Bring back a layer the canvas's right side now cuts off, once the canvas has its new size (a panel just opened beside it). */
export function keepInView(id: string) {
  onCanvasReady(() =>
    requestAnimationFrame(() => {
      const c = getController();
      if (!c || !studio().doc.nodes[id]) return;
      const to = cameraKeeping(worldBounds(studio().doc, id), c.cameraGoal, c.viewport.w);
      if (to) c.glideTo(to);
    }),
  );
}
