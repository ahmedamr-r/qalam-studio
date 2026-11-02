import { describe, expect, it } from "vitest";
import { cameraKeeping, placeCard } from "./anchor";

describe("keeping a box in view", () => {
  const box = { x: 900, y: 0, w: 200, h: 100 };

  it("leaves one that's in view", () => {
    expect(cameraKeeping(box, { x: 0, y: 0, zoom: 1 }, 1200)).toBeNull();
  });

  it("moves one the right side cuts off just far enough, at the camera's zoom", () => {
    expect(cameraKeeping(box, { x: 0, y: 0, zoom: 1 }, 1000)).toEqual({ x: 124, y: 0, zoom: 1 });
    expect(cameraKeeping(box, { x: 0, y: 0, zoom: 0.5 }, 500)).toEqual({ x: 148, y: 0, zoom: 0.5 });
  });

  it("keeps the left edge of one wider than the viewport", () => {
    expect(cameraKeeping({ x: 100, y: 0, w: 800, h: 100 }, { x: 0, y: 0, zoom: 1 }, 400)).toEqual({ x: 76, y: 0, zoom: 1 });
    expect(cameraKeeping({ x: 10, y: 0, w: 800, h: 100 }, { x: 0, y: 0, zoom: 1 }, 400)).toBeNull();
  });
});

const vp = { w: 1200, h: 800 };
const card = { w: 340, h: 400 };
const screen = { x: 0, y: 0, w: 390, h: 844 };

describe("critique card placement", () => {
  it("sits to the right of the screens when there is room", () => {
    expect(placeCard(screen, { x: -100, y: -50, zoom: 1 }, vp, card)).toEqual({ left: 506, top: 50, side: "right" });
  });

  it("flips to the left at the right edge", () => {
    const p = placeCard(screen, { x: -700, y: 0, zoom: 1 }, vp, card);
    expect(p.side).toBe("left");
    expect(p.left).toBe(700 - 16 - 340);
  });

  it("stays inside the viewport when the screens are off-screen or taller than it", () => {
    const off = placeCard(screen, { x: 5000, y: 5000, zoom: 1 }, vp, card);
    expect(off.left).toBe(8);
    expect(off.top).toBe(8);
    const far = placeCard(screen, { x: -3000, y: -3000, zoom: 1 }, vp, card);
    expect(far.left).toBe(vp.w - card.w - 8);
    expect(far.top).toBe(vp.h - card.h - 8);
  });

  it("follows the zoom", () => {
    expect(placeCard(screen, { x: 0, y: 0, zoom: 0.5 }, vp, card).left).toBe(195 + 16);
  });
});
