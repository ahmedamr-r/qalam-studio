import { describe, expect, it } from "vitest";
import { placeCard } from "./anchor";

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
