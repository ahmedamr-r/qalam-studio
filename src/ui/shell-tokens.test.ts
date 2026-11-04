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
});
