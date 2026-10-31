/*
 * The Discovery board's colours. Cards follow the studio's theme while you work (dark cards on
 * the dark canvas), and exports, copied images and the home's thumbnail are always light, so they
 * paste cleanly into docs and slides. Values mirror the theme tokens in src/ui/globals.css, where the
 * setup's canvas reads them in HTML (ost-palette.test.ts fails if the shared ones drift); cards sit
 * a step above the canvas in each theme.
 */

export interface OstPalette {
  /** Card body, its hairline and its shadow; a lit top edge (clear where the theme has none). */
  card: string;
  border: string;
  shadow: string;
  edge: string;
  /** The footer's shade, over the card. */
  footer: string;
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
  /** Each kind's own colour (src/discovery/look.ts): its tag on the card's top edge, its mark, a goal's progress. */
  kindGoal: string;
  kindProblem: string;
  kindSolution: string;
  kindTest: string;
}

export const OST_PALETTE: { dark: OstPalette; light: OstPalette } = {
  dark: {
    card: "#2A2926",
    border: "#FFFFFF1C",
    shadow: "#00000073",
    edge: "#FFFFFF0F",
    footer: "#0000001F",
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
    kindGoal: "#B3A3FF",
    kindProblem: "#E6C04E",
    kindSolution: "#52CCA8",
    kindTest: "#6CC6EC",
  },
  light: {
    card: "#FFFFFF",
    border: "#0000001A",
    shadow: "#00000024",
    edge: "#FFFFFF00",
    footer: "#7A6A5508",
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
    kindGoal: "#6647D1",
    kindProblem: "#826300",
    kindSolution: "#077A5C",
    kindTest: "#0A6C90",
  },
};

/** Theme tokens the palette repeats (palette key → CSS variable), for the drift test (ost-palette.test.ts). */
export const PALETTE_TOKENS: Partial<Record<keyof OstPalette, string>> = {
  card: "--color-card",
  border: "--color-card-line",
  shadow: "--color-card-shadow",
  edge: "--color-card-edge",
  footer: "--color-card-footer",
  line: "--color-wire",
  ink: "--color-fg",
  muted: "--color-fg-muted",
  subtle: "--color-fg-subtle",
  selection: "--color-selection",
  success: "--color-success",
  warning: "--color-warning",
  danger: "--color-danger",
  ai: "--color-ai",
  kindGoal: "--color-kind-goal",
  kindProblem: "--color-kind-problem",
  kindSolution: "--color-kind-solution",
  kindTest: "--color-kind-test",
};
