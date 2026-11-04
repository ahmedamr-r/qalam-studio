import { describe, expect, it } from "vitest";
import { placeBubble, tourCardOf, tourStops } from "./tour";

const SCREEN = { w: 1440, h: 900 };
const SIZE = { w: 400, h: 160 };

describe("tourCardOf", () => {
  const cards = [
    { id: "a", faint: false },
    { id: "b", faint: true },
  ];

  it("points at the card they picked, saying whether faint ones are left", () => {
    expect(tourCardOf(cards, "a")).toEqual({ id: "a", as: "picked", faintLeft: true });
    expect(tourCardOf([cards[0]], "a")).toEqual({ id: "a", as: "picked", faintLeft: false });
  });

  it("points at the first real card when nothing is picked, or when what's picked is faint", () => {
    expect(tourCardOf(cards, null)).toEqual({ id: "a", as: "plain", faintLeft: true });
    expect(tourCardOf(cards, "b")).toEqual({ id: "a", as: "plain", faintLeft: true });
    expect(tourCardOf([cards[0]], null)).toEqual({ id: "a", as: "plain", faintLeft: false });
  });

  it("points at a faint one only when they're all there is, and at nothing on an empty canvas", () => {
    expect(tourCardOf([cards[1]], null)).toEqual({ id: "b", as: "faint", faintLeft: true });
    expect(tourCardOf([], null)).toBeNull();
  });
});

describe("tourStops", () => {
  const card = { id: "a", as: "faint", faintLeft: true } as const;

  it("only has stops with something to point at", () => {
    expect(tourStops({ card, lane: true, company: "Company" }).map((s) => s.target)).toEqual(["card", "lane", "chat", "bar", "sections"]);
    expect(tourStops({ card, lane: false, company: "Company" }).map((s) => s.target)).toEqual(["card", "chat", "bar", "sections"]);
    expect(tourStops({ card: null, lane: false, company: "Company" }).map((s) => s.target)).toEqual(["chat", "bar", "sections"]);
  });

  it("only mentions faint cards when there are some", () => {
    const body = (faintLeft: boolean) => tourStops({ card: { id: "a", as: "picked", faintLeft }, lane: false, company: "Company" })[0].body;
    expect(body(true)).toContain("faint");
    expect(body(false)).not.toContain("faint");
  });

  it("names the button as this canvas does", () => {
    expect(tourStops({ card: null, lane: false, company: "Project" }).at(-1)?.body).toContain("Project holds");
  });
});

describe("placeBubble", () => {
  it("goes to the right of something tall when it fits, level with it", () => {
    expect(placeBubble({ x: 0, y: 40, w: 420, h: 860 }, SIZE, SCREEN)).toEqual({ x: 436, y: 390 });
  });

  it("goes left when the right edge has no room", () => {
    const at = placeBubble({ x: 1200, y: 300, w: 220, h: 120 }, SIZE, SCREEN);
    expect(at.x).toBe(1200 - 16 - 400);
  });

  it("goes under or over something wide and short", () => {
    expect(placeBubble({ x: 1000, y: 50, w: 420, h: 28 }, SIZE, SCREEN).y).toBe(94);
    expect(placeBubble({ x: 430, y: 860, w: 500, h: 28 }, SIZE, SCREEN).y).toBe(860 - 16 - 160);
  });

  it("slides along the edge to stay on screen", () => {
    const at = placeBubble({ x: 100, y: 840, w: 200, h: 60 }, SIZE, SCREEN);
    expect(at.y + SIZE.h).toBeLessThanOrEqual(SCREEN.h - 16);
    const wide = placeBubble({ x: 1200, y: 50, w: 230, h: 28 }, SIZE, SCREEN);
    expect(wide.x + SIZE.w).toBeLessThanOrEqual(SCREEN.w - 16);
  });

  it("stays on screen while what's lit is still off it, on its way in", () => {
    for (const lit of [{ x: -2000, y: 300, w: 200, h: 100 }, { x: 3000, y: 300, w: 200, h: 100 }, { x: 300, y: -2000, w: 200, h: 100 }, { x: 300, y: 3000, w: 200, h: 100 }]) {
      const at = placeBubble(lit, SIZE, SCREEN);
      expect(at.x).toBeGreaterThanOrEqual(16);
      expect(at.y).toBeGreaterThanOrEqual(16);
      expect(at.x + SIZE.w).toBeLessThanOrEqual(SCREEN.w - 16);
      expect(at.y + SIZE.h).toBeLessThanOrEqual(SCREEN.h - 16);
    }
  });

  it("sits in the middle with nothing lit, or when nothing fits", () => {
    expect(placeBubble(null, SIZE, SCREEN)).toEqual({ x: 520, y: 370 });
    expect(placeBubble({ x: 0, y: 0, w: 1440, h: 900 }, SIZE, SCREEN)).toEqual({ x: 520, y: 370 });
  });
});
