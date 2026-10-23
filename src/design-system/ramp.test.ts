import { describe, expect, it } from "vitest";
import { harmonize, hueDistance, isLightHue, makeRamp, okHex, oklchOf, onColor, solidStep, TARGETS } from "./ramp";
import { contrastRatio } from "./resolve";

const HUES = [0, 27, 60, 95, 110, 145, 165, 200, 250, 275, 300, 330];

describe("colour ramps", () => {
  for (const contrast of ["standard", "high"] as const) {
    it(`hits every contrast target (${contrast})`, () => {
      for (const hue of HUES) {
        const targets = TARGETS.hue[contrast];
        const r = makeRamp({ hue, chroma: 0.17, background: "#FFFFFF", targets });
        expect(r).toHaveLength(12);
        r.forEach((hex, i) => {
          expect(hex).toMatch(/^#[0-9A-F]{6}$/);
          const t = targets[i];
          if (t == null || i === 0) return;
          const ratio = contrastRatio(hex, r[0]);
          // Never short of the target; never far above it.
          expect(ratio).toBeGreaterThanOrEqual(t);
          expect(ratio).toBeLessThanOrEqual(t * 1.015);
        });
      }
    });
  }

  it("gets darker step by step (the solid steps aside)", () => {
    for (const hue of HUES) {
      const r = makeRamp({ hue, chroma: 0.12, background: "#FFFFFF", targets: TARGETS.hue.standard });
      const L = r.map((h) => oklchOf(h)!.l);
      for (const i of [1, 2, 3, 4, 5, 6, 7, 11]) {
        const prev = i === 11 ? 10 : i - 1;
        expect(L[i]).toBeLessThan(L[prev] + 1e-9);
      }
    }
  });

  it("keeps a neutral ramp's chroma to the tint", () => {
    const r = makeRamp({ hue: 250, chroma: 0.012, background: "#FFFFFF", targets: TARGETS.neutral.standard, curve: Array(12).fill(1) });
    for (const h of r) expect(oklchOf(h)!.c).toBeLessThan(0.02);
  });

  it("places the brand colour at step 9 exactly", () => {
    for (const anchor of ["#0090FF", "#FFE600", "#0A0A3F", "#E4002B", "#8E9CFF"]) {
      const r = makeRamp({ hue: oklchOf(anchor)!.h ?? 0, chroma: 0.15, background: "#FFFFFF", targets: TARGETS.hue.standard, anchor });
      expect(r[8]).toBe(anchor);
    }
  });

  it("only caps chroma, never exceeds it", () => {
    const r = makeRamp({ hue: 300, chroma: 0.07, background: "#FFFFFF", targets: TARGETS.hue.standard });
    for (const h of r) expect(oklchOf(h)!.c).toBeLessThanOrEqual(0.07 + 0.005);
  });
});

describe("solid fills", () => {
  it("carry white text except on yellow-ish hues", () => {
    for (const hue of HUES) {
      const fill = solidStep(hue, 0.2);
      if (isLightHue(hue)) expect(contrastRatio("#000000", fill)).toBeGreaterThanOrEqual(4.5);
      else expect(contrastRatio("#FFFFFF", fill)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("always carry light text when asked (banner accents), against a tinted white too", () => {
    for (const hue of HUES) {
      expect(contrastRatio("#FFFFFF", solidStep(hue, 0.2, { white: true }))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio("#F9FCFF", solidStep(hue, 0.2, { white: true, on: "#F9FCFF" }))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("colour helpers", () => {
  it("harmonizes toward a hue by at most 15°", () => {
    for (const [from, to] of [[150, 250], [27, 250], [80, 300], [350, 10], [10, 350]]) {
      const h = harmonize(from, to);
      expect(hueDistance(h, from)).toBeLessThanOrEqual(15 + 1e-9);
      expect(hueDistance(h, to)).toBeLessThanOrEqual(hueDistance(from, to));
    }
    expect(harmonize(100, 110)).toBeCloseTo(105);
  });

  it("finds legible text for any fill", () => {
    for (const hue of HUES)
      for (const l of [0.2, 0.5, 0.65, 0.8, 0.95]) {
        const fill = okHex(l, 0.12, hue);
        expect(contrastRatio(onColor(fill, ["#777777"]), fill)).toBeGreaterThanOrEqual(4.5);
      }
  });
});
