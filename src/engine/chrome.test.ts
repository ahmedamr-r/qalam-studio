import { describe, expect, it } from "vitest";
import { DEFAULT_CHROME, crisp, formatChromeNumber, luminance, parseCssColor, readChromeTheme, withAlpha } from "./chrome";

describe("parseCssColor", () => {
  it("normalises hex in every length to #RRGGBBAA", () => {
    expect(parseCssColor("#3789fd")).toBe("#3789FDFF");
    expect(parseCssColor("#fff")).toBe("#FFFFFFFF");
    expect(parseCssColor("#0008")).toBe("#00000088");
    expect(parseCssColor(" #3789FD1a ")).toBe("#3789FD1A");
  });

  it("reads rgb() and rgba() with commas, spaces, slash alpha and percentages", () => {
    expect(parseCssColor("rgb(55, 137, 253)")).toBe("#3789FDFF");
    expect(parseCssColor("rgb(255 255 255 / 0.085)")).toBe("#FFFFFF16");
    expect(parseCssColor("rgba(0,0,0,0.5)")).toBe("#00000080");
    expect(parseCssColor("rgb(100% 0% 0% / 50%)")).toBe("#FF000080");
  });

  it("returns null for what it can't read (the browser resolves those)", () => {
    expect(parseCssColor("oklch(0.7 0.1 250)")).toBeNull();
    expect(parseCssColor("")).toBeNull();
    expect(parseCssColor("#12345")).toBeNull();
    expect(parseCssColor("rgb(1, 2)")).toBeNull();
  });
});

describe("chrome palette", () => {
  it("falls back to the dark defaults without a DOM", () => {
    expect(readChromeTheme(null)).toBe(DEFAULT_CHROME);
    expect(DEFAULT_CHROME.dark).toBe(true);
  });

  it("reads the theme's variables, and tunes the pixel grid to a light canvas when no token sets it", () => {
    const stub = (vars: Record<string, string>) => {
      const g = globalThis as { getComputedStyle?: unknown };
      const prev = g.getComputedStyle;
      g.getComputedStyle = () => ({ getPropertyValue: (n: string) => vars[n] ?? "" });
      try {
        return readChromeTheme({} as Element);
      } finally {
        g.getComputedStyle = prev;
      }
    };
    const light = stub({ "--color-canvas": "#efedea" });
    expect(light.dark).toBe(false);
    expect(light.canvas).toBe("#EFEDEAFF");
    expect(light.pixelGrid).not.toBe(DEFAULT_CHROME.pixelGrid);
    expect(stub({ "--color-canvas": "#1e1d1b" }).pixelGrid).toBe(DEFAULT_CHROME.pixelGrid);
    expect(stub({ "--color-canvas": "#efedea", "--color-pixel-grid": "#ff000033" }).pixelGrid).toBe("#FF000033");
  });

  it("swaps alpha and tells dark from light", () => {
    expect(withAlpha("#3789FDFF", 0.1)).toBe("#3789FD1A");
    expect(luminance("#1E1D1BFF")).toBeLessThan(0.5);
    expect(luminance("#EFEDEAFF")).toBeGreaterThan(0.5);
  });
});

describe("crisp", () => {
  it("centres odd device widths on a pixel and even ones on an edge", () => {
    // dpr 1, 1 px line: the centre of pixel 10.
    expect(crisp(10.3, 1)).toBe(10.5);
    expect(crisp(10, 1)).toBe(10.5);
    // dpr 2, 1 css px = 2 device px: on a device-pixel edge.
    expect(crisp(10.3, 2)).toBe(10.5);
    expect(crisp(10.1, 2)).toBe(10);
    // dpr 2, a hairline (1 device px): the centre of a device pixel.
    expect(crisp(10.1, 2, 0.5)).toBe(10.25);
    // 1.5 css px at dpr 2 = 3 device px (odd).
    expect(crisp(7, 2, 1.5)).toBe(7.25);
  });
});

describe("formatChromeNumber", () => {
  it("shows whole numbers bare and keeps at most two decimals", () => {
    expect(formatChromeNumber(390)).toBe("390");
    expect(formatChromeNumber(12.5)).toBe("12.5");
    expect(formatChromeNumber(1 / 3)).toBe("0.33");
    expect(formatChromeNumber(-0.001)).toBe("0");
  });
});
