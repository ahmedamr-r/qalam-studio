import type { Doc, RouteProto, RouteRef } from "@/doc/schema";
import { refLayer } from "@/proto/walk";

/*
 * The live prototype's layers, found by where they are in the design: the preview build marks a
 * screen with its key, a part with its id, and each layer with its spec path, component and name
 * (codegen/compile.ts `preview`), so the session's markers and cursor land on what a step names.
 */

const q = (v: string) => CSS.escape(v);

/** The frame a ref is in, live: the screen's newest visit, or an open part. */
function scopeOf(device: HTMLElement, key: string, ref: RouteRef): HTMLElement | null {
  if (ref.part) return device.querySelector<HTMLElement>(`[data-qpart="${q(ref.part)}"]`);
  const visits = device.querySelectorAll<HTMLElement>(`[data-qscreen="${q(key)}"]`);
  return visits[visits.length - 1] ?? null;
}

/** The element a ref points at in the live prototype, or null while it isn't there. */
export function liveElement(device: HTMLElement, doc: Doc, screen: string, key: string, route: RouteProto, ref: RouteRef): HTMLElement | null {
  const scope = scopeOf(device, key, ref);
  if (!scope || (!ref.path && !ref.sub)) return scope;
  const id = refLayer(doc, screen, route, ref);
  const n = id ? doc.nodes[id] : undefined;
  if (!n) return null;
  const at = (path: string) => (scope.getAttribute("data-qpath") === path ? scope : scope.querySelector<HTMLElement>(`[data-qpath="${q(path)}"]`));
  if (n.meta.specPath !== undefined) return at(n.meta.specPath);
  // A layer inside a component (a chip, a stepper's +): by its name, in the component.
  let up = n.parentId ? doc.nodes[n.parentId] : undefined;
  while (up && up.meta.specPath === undefined) up = up.parentId ? doc.nodes[up.parentId] : undefined;
  const host = up?.meta.specPath !== undefined ? at(up.meta.specPath) : scope;
  return host?.querySelector<HTMLElement>(`[data-qname="${q(n.name)}"]`) ?? null;
}

/** The screen's scroller (what scrolls under the pinned top and bottom), live. */
export const scrollerOf = (device: HTMLElement): HTMLElement | null => {
  const all = device.querySelectorAll<HTMLElement>("[data-qscroller]");
  return all[all.length - 1] ?? null;
};

/** A box relative to `frame` (what overlays on the device are placed in). */
export function boxIn(frame: HTMLElement, el: Element): { x: number; y: number; w: number; h: number } {
  const f = frame.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height };
}

/** Is it on screen: in the device, not scrolled away, not fading out? */
export function showing(device: HTMLElement, el: HTMLElement): boolean {
  const d = device.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1 || r.bottom <= d.top + 1 || r.top >= d.bottom - 1 || r.right <= d.left || r.left >= d.right) return false;
  for (let e: HTMLElement | null = el; e && e !== device; e = e.parentElement) if (Number(getComputedStyle(e).opacity) < 0.05) return false;
  return true;
}
