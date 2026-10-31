import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KIND_TOKEN } from "@/discovery/look";
import { OST_PALETTE, PALETTE_TOKENS } from "./ost-palette";

/** Each theme's tokens as globals.css declares them: dark in `@theme static`, light under `:root[data-theme="light"]`. */
function themes(): { dark: Map<string, string>; light: Map<string, string> } {
  const css = readFileSync(new URL("../ui/globals.css", import.meta.url), "utf8");
  const block = (start: string) => {
    const from = css.indexOf(start);
    expect(from).toBeGreaterThanOrEqual(0);
    const body = css.slice(from, css.indexOf("\n}", from));
    return new Map([...body.matchAll(/(--color-[a-z0-9-]+):\s*(#[0-9a-f]{6,8})\b/gi)].map((m) => [m[1], m[2].toUpperCase()]));
  };
  return { dark: block("@theme static {"), light: block(':root[data-theme="light"] {') };
}

describe("the board's palette", () => {
  it("repeats the theme's tokens exactly, in both themes, so a board and the setup's canvas look the same", () => {
    const css = themes();
    for (const theme of ["dark", "light"] as const)
      for (const [key, token] of Object.entries(PALETTE_TOKENS)) expect([theme, token, OST_PALETTE[theme][key as keyof (typeof OST_PALETTE)["dark"]].toUpperCase()]).toEqual([theme, token, css[theme].get(token!)]);
  });

  it("has every kind's colour, as the token the setup's canvas reads", () => {
    const tokens = new Set(Object.values(PALETTE_TOKENS));
    for (const token of Object.values(KIND_TOKEN)) expect(tokens.has(token)).toBe(true);
  });
});
