import { describe, expect, it } from "vitest";
import { spring } from "motion";
import { evaluate, transpile } from "@/ui/prototype/runtime";
import { motionCode } from "@/codegen/feel";
import { ANDROID, appleSpring, FEEL_MOTION, IOS, materialSpring, pageSettle, rnSpring, settleTime, springAt, type Spring } from "./native-motion";

const ratio = (s: Spring) => s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
/** Where Motion's own spring generator has a spring at `ms`, going 0 → 1. */
const motionAt = (s: Spring, ms: number) => spring({ keyframes: [0, 1], stiffness: s.stiffness, damping: s.damping, mass: s.mass }).next(ms).value as number;

describe("native motion", () => {
  it("plays React Navigation's iOS spring as React Native does: critically damped, not crawling", () => {
    const s = IOS.navigation;
    expect(s).toMatchObject({ stiffness: 1000, mass: 3 });
    expect(ratio(s)).toBeLessThanOrEqual(1);
    expect(ratio(s)).toBeGreaterThan(0.9999);
    // React Native's SpringAnimation (and Reanimated's springUtils) solve any damping ratio ≥ 1 as
    // critically damped: 1 − e^(−ω₀t)(1 + ω₀t), ω₀ = √(k/m). Motion, given the critical damping, draws that curve.
    const w0 = Math.sqrt(1000 / 3);
    for (let ms = 0; ms <= 600; ms += 20) {
      const rn = 1 - Math.exp((-w0 * ms) / 1000) * (1 + (w0 * ms) / 1000);
      expect(Math.abs(motionAt(s, ms) - rn)).toBeLessThan(0.002);
      expect(Math.abs(springAt(s, ms / 1000) - rn)).toBeLessThan(0.002);
    }
    // Most of the way by 300ms, settled by about 410ms; written as React Navigation does (damping 500),
    // Motion would solve it overdamped and still be less than halfway at 300ms.
    expect(motionAt(s, 300)).toBeGreaterThan(0.97);
    expect(settleTime(s)).toBeCloseTo(0.407, 2);
    expect(motionAt({ type: "spring", stiffness: 1000, damping: 500, mass: 3 }, 300)).toBeLessThan(0.5);
    expect(rnSpring(100, 10, 1)).toEqual({ type: "spring", stiffness: 100, damping: 10, mass: 1 });
  });

  it("writes Apple's and Material's springs in physical terms", () => {
    // SwiftUI's Animation.default since iOS 17: spring(response: 0.55, dampingFraction: 1).
    expect(IOS.standard.stiffness).toBeCloseTo(((2 * Math.PI) / 0.55) ** 2, 1);
    expect(ratio(IOS.standard)).toBeCloseTo(1, 3);
    expect(ratio(IOS.standard)).toBeLessThanOrEqual(1);
    // Spring.snappy: bounce 0.15 is a damping ratio of 0.85.
    expect(ratio(appleSpring(0.5, 0.15))).toBeCloseTo(0.85, 3);
    // M3's standard default spatial spring: damping ratio 0.9, stiffness 700.
    expect(ANDROID.spatial.stiffness).toBe(700);
    expect(ratio(materialSpring(0.9, 700))).toBeCloseTo(0.9, 3);
    expect(ratio(ANDROID.effects)).toBeCloseTo(1, 3);
  });

  it("keeps an old screen under a new one until the new one has settled", () => {
    expect(pageSettle("ios")).toBeCloseTo(0.407, 2);
    expect(pageSettle("android")).toBe(0.45);
    expect(pageSettle("web")).toBe(0.5);
    expect(settleTime(ANDROID.page)).toBe(0.45);
    expect(settleTime({ duration: 0.083, delay: 0.05, ease: "linear" })).toBeCloseTo(0.133, 3);
  });

  it("draws Material's emphasized curve exactly: two Béziers meeting at (1/6, 0.4), as Android's path does", () => {
    const im = { react: new Set<string>(), motion: new Set<string>() };
    const code = motionCode("android", im).join("\n");
    expect(im.motion.has("cubicBezier")).toBe(true);
    const { emphasized, decelerate5, outExpo, MOTION } = evaluate(transpile(`import { cubicBezier, type Transition } from "motion/react";\ntype Via = { kind: string; transition?: Transition };\n${code}\nexport { emphasized, decelerate5, outExpo, MOTION };`)) as {
      emphasized: (t: number) => number;
      decelerate5: (t: number) => number;
      outExpo: (t: number) => number;
      MOTION: { page: { duration: number; ease: unknown } };
    };
    expect(emphasized(0)).toBeCloseTo(0, 6);
    expect(emphasized(1 / 6)).toBeCloseTo(0.4, 6);
    expect(emphasized(1)).toBeCloseTo(1, 6);
    // Slow out of the gate, then most of the way fast: 40% of the change in the first sixth of the time.
    expect(emphasized(0.1)).toBeLessThan(0.15);
    expect(emphasized(0.3)).toBeGreaterThan(0.75);
    let last = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      expect(emphasized(t)).toBeGreaterThanOrEqual(last - 1e-9);
      last = emphasized(t);
    }
    expect(decelerate5(0.5)).toBeCloseTo(1 - 0.5 ** 5, 9);
    expect(outExpo(1)).toBeCloseTo(1 - 2 ** -10, 9);
    expect(MOTION.page).toMatchObject({ duration: 0.45, ease: emphasized });
  });

  it("has a table for every feel", () => {
    for (const feel of ["ios", "android", "web"] as const) for (const k of ["page", "morph", "change", "bar"] as const) expect(FEEL_MOTION[feel][k]).toBeTruthy();
  });
});
