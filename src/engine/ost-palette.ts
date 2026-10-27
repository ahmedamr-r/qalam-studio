/*
 * The Discovery board's colours. Cards follow the studio's theme while you work (dark cards on
 * the dark canvas), and exports, copied images and the home's thumbnail are always light, so they
 * paste cleanly into docs and slides. Values mirror the theme tokens in src/ui/globals.css (the
 * palette test fails if the shared ones drift); cards sit a step above the canvas in each theme.
 */

export interface OstPalette {
  /** Card body, its hairline and its shadow. */
  card: string;
  border: string;
  shadow: string;
  /** Title. */
  ink: string;
  /** Kind label, metric line. */
  muted: string;
  /** Placeholder titles, quiet chips. */
  subtle: string;
  /** Connectors, and the path to the selected card. */
  line: string;
  lineStrong: string;
  /** Neutral chips. */
  chip: string;
  chipInk: string;
  /** The target chip: inverted (pearl on dark, ink on light), never a hue. */
  inverse: string;
  inverseInk: string;
  selection: string;
  success: string;
  successSubtle: string;
  warning: string;
  warningSubtle: string;
  danger: string;
  dangerSubtle: string;
  ai: string;
  aiSubtle: string;
}

export const OST_PALETTE: { dark: OstPalette; light: OstPalette } = {
  dark: {
    card: "#2A2926",
    border: "#FFFFFF1C",
    shadow: "#00000073",
    ink: "#F2F0ED",
    muted: "#B0ADAA",
    subtle: "#8A8681",
    line: "#5F5C58",
    lineStrong: "#B0ADAA",
    chip: "#FFFFFF12",
    chipInk: "#B0ADAA",
    inverse: "#F2F0ED",
    inverseInk: "#141412",
    selection: "#3789FD",
    success: "#3FC168",
    successSubtle: "#3FC16821",
    warning: "#FF8A3D",
    warningSubtle: "#FF8A3D21",
    danger: "#F4514F",
    dangerSubtle: "#F4514F21",
    ai: "#F2A8CB",
    aiSubtle: "#F2A8CB1F",
  },
  light: {
    card: "#FFFFFF",
    border: "#0000001A",
    shadow: "#00000024",
    ink: "#1C1A18",
    muted: "#55524E",
    subtle: "#6C6863",
    line: "#BCB8B3",
    lineStrong: "#55524E",
    chip: "#0000000D",
    chipInk: "#55524E",
    inverse: "#1C1A18",
    inverseInk: "#F7F6F4",
    selection: "#296AEA",
    success: "#0A7E3A",
    successSubtle: "#0A7E3A1A",
    warning: "#B5480A",
    warningSubtle: "#E5780F1F",
    danger: "#D42325",
    dangerSubtle: "#D4232517",
    ai: "#C02D7A",
    aiSubtle: "#C02D7A14",
  },
};

/** Theme tokens the palette repeats (palette key → CSS variable), for the drift test. */
export const PALETTE_TOKENS: Partial<Record<keyof OstPalette, string>> = {
  ink: "--color-fg",
  muted: "--color-fg-muted",
  subtle: "--color-fg-subtle",
  selection: "--color-selection",
  success: "--color-success",
  warning: "--color-warning",
  danger: "--color-danger",
  ai: "--color-ai",
};
