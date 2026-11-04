import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/design-system/resolve";

/** Each theme's raw vars and colour tokens as globals.css declares them, dark first, light over it. */
function themes() {
  const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
  const block = (start: string) => {
    const from = css.indexOf(start);
    expect(from).toBeGreaterThanOrEqual(0);
    const body = css.slice(from, css.indexOf("\n}", from));
    return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
  };
  const dark = { ...block("@theme static {"), ...block(":root {\n  color-scheme: dark") };
  return { dark, light: { ...dark, ...block(':root[data-theme="light"] {') } };
}

describe("the Desk's colours", () => {
  const { dark, light } = themes();

  it("keeps the top bar's text readable on the shell's brightest part", () => {
    for (const t of [dark, light]) {
      expect(contrastRatio(t["--color-fg"], t["--shell-1"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t["--color-fg-muted"], t["--shell-1"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t["--shell-ink-subtle"], t["--shell-1"])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the mark clear on the shell's brightest part", () => {
    for (const t of [dark, light]) expect(contrastRatio(t["--color-mark"], t["--shell-1"])).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps what's drawn on a canvas readable wherever it lies on the wash", () => {
    for (const t of [dark, light])
      for (const stop of ["--wash-1", "--wash-2", "--wash-3"]) {
        expect(contrastRatio(t["--color-fg-subtle"], t[stop])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t["--color-canvas-label"], t[stop])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t["--color-selection-label"], t[stop])).toBeGreaterThanOrEqual(4.5);
      }
  });

  it("keeps a card a step above the wash", () => {
    for (const stop of ["--wash-1", "--wash-2", "--wash-3"]) {
      expect(contrastRatio(dark["--color-card"], dark[stop])).toBeGreaterThanOrEqual(1.14);
      expect(contrastRatio(light["--color-card"], light[stop])).toBeGreaterThanOrEqual(1.09);
    }
  });

  it("keeps a glass panel's text readable over whatever lies behind it", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    const saturation = Number(/--glass-filter:[^;]*saturate\(([\d.]+)\)/.exec(css)![1]);
    const [darkGlass, lightGlass] = [...css.matchAll(/--glass:\s*rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/g)].map((m) => m.slice(1).map(Number));
    const cases = [
      { t: dark, glass: darkGlass },
      { t: light, glass: lightGlass },
    ];
    for (const { t, glass } of cases)
      for (const behind of ["--shell-1", "--shell-glow", "--shell-2", "--shell-3", "--wash-1", "--color-card"]) {
        const seen = throughGlass(t[behind], glass, saturation);
        for (const ink of ["--color-fg", "--color-fg-muted", "--color-fg-subtle", "--color-fg-accent", "--color-ai", "--color-selection-label", "--color-success", "--color-warning", "--color-danger"])
          expect([behind, ink, contrastRatio(t[ink], seen) >= 4.5]).toEqual([behind, ink, true]);
      }
  });

  it("keeps a card's tag readable: its word on it, and its mark clear on it", () => {
    for (const t of [dark, light])
      for (const surface of ["--color-card-tag", "--color-card"]) {
        expect([surface, contrastRatio(t["--color-fg-muted"], t[surface]) >= 4.5]).toEqual([surface, true]);
        for (const kind of ["goal", "problem", "solution", "test"]) expect([surface, kind, contrastRatio(t[`--color-kind-${kind}`], t[surface]) >= 3]).toEqual([surface, kind, true]);
      }
  });

  it("keeps a question card's text readable on its sheet, a picked option's too", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    const saturation = Number(/--glass-filter:[^;]*saturate\(([\d.]+)\)/.exec(css)![1]);
    const rgba = (name: string) => [...css.matchAll(new RegExp(`${name}:\\s*rgb\\((\\d+) (\\d+) (\\d+) \\/ ([\\d.]+)\\)`, "g"))].map((m) => m.slice(1).map(Number));
    const [glass, sheet, picked] = [rgba("--glass"), rgba("--color-sheet"), rgba("--color-selection-subtle")];
    [dark, light].forEach((t, i) => {
      for (const behind of ["--shell-1", "--shell-glow", "--shell-2", "--shell-3"]) {
        const onSheet = over(sheet[i], throughGlass(t[behind], glass[i], saturation));
        for (const surface of [onSheet, over(picked[i], onSheet)])
          for (const ink of ["--color-fg", "--color-fg-muted", "--shell-ink-subtle"]) expect([behind, ink, contrastRatio(t[ink], surface) >= 4.5]).toEqual([behind, ink, true]);
      }
    });
  });
});

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

/** A translucent colour over a solid one. */
function over([tr, tg, tb, alpha]: number[], hex: string): string {
  return toHex(channels(hex).map((v, i) => [tr, tg, tb][i] * alpha + v * (1 - alpha)));
}

/** What a colour behind a glass panel looks like through it: CSS's saturate(), then the tint over it. */
function throughGlass(hex: string, glass: number[], s: number): string {
  const [r, g, b] = channels(hex);
  return over(
    glass,
    toHex([
      (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
      (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
      (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b,
    ]),
  );
}
