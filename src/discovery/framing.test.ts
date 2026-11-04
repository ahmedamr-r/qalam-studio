import { describe, expect, it } from "vitest";
import { cameraShowing, type Insets } from "./framing";

const view = { w: 1000, h: 800 };
const insets: Insets = { top: 50, right: 20, bottom: 50, left: 20 };
/** As the canvas fits a box: the most that fits, no closer than maxZoom, centred. */
const fit = (b: { x: number; y: number; w: number; h: number }, i: Insets, maxZoom: number) => {
  const W = view.w - i.left - i.right;
  const H = view.h - i.top - i.bottom;
  const zoom = Math.min(maxZoom, W / b.w, H / b.h);
  return { x: b.x + b.w / 2 - (i.left + W / 2) / zoom, y: b.y + b.h / 2 - (i.top + H / 2) / zoom, zoom };
};
const card = (x: number, y: number) => ({ x, y, w: 240, h: 120 });

describe("bringing suggested cards into view", () => {
  it("stays put when they can already be seen", () => {
    expect(cameraShowing([card(100, 100)], { x: 0, y: 0, zoom: 1 }, view, insets, fit)).toBeNull();
  });

  it("goes to a card that's off screen, keeping the zoom they're working at", () => {
    const to = cameraShowing([card(5000, 3000)], { x: 0, y: 0, zoom: 0.8 }, view, insets, fit)!;
    expect(to.zoom).toBe(0.8);
    expect((5000 - to.x) * to.zoom).toBeGreaterThanOrEqual(insets.left);
    expect((5000 + 240 - to.x) * to.zoom).toBeLessThanOrEqual(view.w - insets.right);
  });

  it("treats a card under the bars or cut off by a panel as out of view", () => {
    expect(cameraShowing([card(100, 10)], { x: 0, y: 0, zoom: 1 }, view, insets, fit)).not.toBeNull();
    expect(cameraShowing([card(800, 100)], { x: 0, y: 0, zoom: 1 }, view, { ...insets, right: 400 }, fit)).not.toBeNull();
  });

  it("never comes closer than 100%, and comes in to read when it was far out", () => {
    expect(cameraShowing([card(5000, 0)], { x: 0, y: 0, zoom: 2 }, view, insets, fit)!.zoom).toBe(1);
    expect(cameraShowing([card(5000, 0)], { x: 0, y: 0, zoom: 0.1 }, view, insets, fit)!.zoom).toBe(0.6);
  });

  it("zooms out to show them together while that still reads, else shows the first", () => {
    const near = cameraShowing([card(0, 0), card(1200, 0)], { x: 4000, y: 0, zoom: 1 }, view, insets, fit)!;
    expect(near.zoom).toBeGreaterThanOrEqual(0.35);
    expect(near.zoom).toBeLessThan(1);
    const far = cameraShowing([card(0, 0), card(9000, 0)], { x: 4000, y: 0, zoom: 1 }, view, insets, fit)!;
    expect(far.zoom).toBe(1);
    expect(far.x).toBeLessThan(240);
  });

  it("has nothing to do with no cards", () => {
    expect(cameraShowing([], { x: 0, y: 0, zoom: 1 }, view, insets, fit)).toBeNull();
  });
});
