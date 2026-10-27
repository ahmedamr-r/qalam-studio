/*
 * Canvas chrome palette: selection, handles, labels, guides, measure pills, rulers. The values
 * come from the theme's CSS custom properties (src/ui/globals.css), read once per theme switch and
 * normalised to #RRGGBBAA, so the renderer never parses CSS while drawing. Content is never
 * coloured from here: exports must look the same in either theme.
 */

export type ChromeKey =
  | "canvas"
  | "selection"
  | "selectionStrong"
  | "selectionLabel"
  | "selectionFill"
  | "hover"
  | "canvasLabel"
  | "component"
  | "guide"
  | "measure"
  | "pillInk"
  | "handleFill"
  | "lintWarning"
  | "danger"
  | "rulerBg"
  | "rulerLine"
  | "rulerTick"
  | "rulerInk"
  | "rulerBand"
  | "outline"
  | "pixelGrid";

export type ChromeTheme = Record<ChromeKey, string> & { dark: boolean };

/** The dark theme (the studio default): the first frame never waits for CSS. */
export const DEFAULT_CHROME: ChromeTheme = {
  dark: true,
  canvas: "#1E1D1BFF",
  selection: "#3789FDFF",
  selectionStrong: "#2A6FE0FF",
  selectionLabel: "#6EA6FFFF",
  selectionFill: "#3789FD1A",
  hover: "#3789FDFF",
  canvasLabel: "#8A8681FF",
  component: "#B6A4FFFF",
  guide: "#F2464FFF",
  measure: "#D93036FF",
  pillInk: "#FFFFFFFF",
  handleFill: "#FFFFFFFF",
  lintWarning: "#FF8A3DFF",
  danger: "#F4514FFF",
  rulerBg: "#0F0E0DFF",
  rulerLine: "#FFFFFF16",
  rulerTick: "#FFFFFF26",
  rulerInk: "#8A8681FF",
  rulerBand: "#3789FD26",
  outline: "#B0ADAAFF",
  pixelGrid: "#8080803D",
};

/** The pixel grid on a light canvas when the theme doesn't set --color-pixel-grid. */
const LIGHT_PIXEL_GRID = "#00000017";

/** Where each chrome colour comes from. Keys without a variable are derived in `readChromeTheme`. */
const VARS: Partial<Record<ChromeKey, string>> = {
  canvas: "--color-canvas",
  selection: "--color-selection",
  selectionStrong: "--color-selection-strong",
  selectionLabel: "--color-selection-label",
  hover: "--color-hover-outline",
  canvasLabel: "--color-canvas-label",
  component: "--color-component",
  guide: "--color-guide",
  measure: "--color-measure",
  handleFill: "--color-handle-fill",
  lintWarning: "--color-lint-warning",
  danger: "--color-danger",
  rulerBg: "--color-panel",
  rulerLine: "--color-line",
  rulerTick: "--color-line-strong",
  rulerInk: "--color-fg-subtle",
  outline: "--color-fg-muted",
  pixelGrid: "--color-pixel-grid",
};

const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0").toUpperCase();

/**
 * A CSS colour as #RRGGBBAA, or null when it isn't one of the forms tokens use: #rgb, #rgba,
 * #rrggbb, #rrggbbaa, rgb()/rgba() with commas or spaces and an optional `/ alpha` (number or %).
 */
export function parseCssColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) return parseCssColor(`#${[...hex].map((c) => c + c).join("")}`);
    if (hex.length === 6) return `#${hex.toUpperCase()}FF`;
    if (hex.length === 8) return `#${hex.toUpperCase()}`;
    return null;
  }
  const fn = /^rgba?\((.*)\)$/.exec(v)?.[1];
  if (!fn) return null;
  const parts = fn.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const channel = (s: string) => (s.endsWith("%") ? (parseFloat(s) / 100) * 255 : parseFloat(s));
  const rgb = parts.slice(0, 3).map(channel);
  const a = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  if ([...rgb, a].some((n) => !Number.isFinite(n))) return null;
  return `#${rgb.map(hex2).join("")}${hex2(a * 255)}`;
}

/** Same colour, another alpha (0–1). */
export function withAlpha(hex: string, alpha: number): string {
  return `${hex.slice(0, 7).toUpperCase()}${hex2(alpha * 255)}`;
}

/** Perceived lightness (0–1) of a #RRGGBB(AA) colour, to tell a dark canvas from a light one. */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Anything else the browser understands (oklch, color-mix…): let a 1 × 1 canvas resolve it. */
function resolveInBrowser(value: string): string | null {
  try {
    const ctx = new OffscreenCanvas(1, 1).getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000";
    ctx.fillStyle = value;
    const direct = parseCssColor(String(ctx.fillStyle));
    if (direct) return direct;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b, a].map(hex2).join("")}`;
  } catch {
    return null;
  }
}

/** The current theme's chrome colours, from the CSS variables on <html>. */
export function readChromeTheme(el: Element | null = typeof document !== "undefined" ? document.documentElement : null): ChromeTheme {
  if (!el || typeof getComputedStyle === "undefined") return DEFAULT_CHROME;
  const css = getComputedStyle(el);
  const out = { ...DEFAULT_CHROME };
  const read = new Set<ChromeKey>();
  for (const [key, name] of Object.entries(VARS) as [ChromeKey, string][]) {
    const raw = css.getPropertyValue(name).trim();
    if (!raw) continue;
    const hex = parseCssColor(raw) ?? resolveInBrowser(raw);
    if (hex) {
      out[key] = hex;
      read.add(key);
    }
  }
  out.dark = luminance(out.canvas) < 0.5;
  // Without a token of its own, the pixel grid is a faint line of the canvas's opposite.
  if (!read.has("pixelGrid")) out.pixelGrid = out.dark ? DEFAULT_CHROME.pixelGrid : LIGHT_PIXEL_GRID;
  out.selectionFill = withAlpha(out.selection, 0.1);
  out.rulerBand = withAlpha(out.selection, out.dark ? 0.15 : 0.12);
  return out;
}

/** Whether the canvas is dark right now: new strokes on it take a light ink (see `defaultInk`). */
export const canvasIsDark = (): boolean => readChromeTheme().dark;

/**
 * A screen coordinate moved onto the device-pixel grid, so a line `width` CSS px wide covers
 * whole device pixels: odd device widths centre on a pixel, even ones on a pixel edge.
 */
export function crisp(v: number, dpr: number, width = 1): number {
  const w = Math.max(1, Math.round(width * dpr));
  const d = v * dpr;
  return (w % 2 ? Math.floor(d) + 0.5 : Math.round(d)) / dpr;
}

/** A number as chrome shows it: whole when it is, else up to two decimals ("12", "12.5"). */
export function formatChromeNumber(v: number): string {
  const r = Math.round(v * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
}
