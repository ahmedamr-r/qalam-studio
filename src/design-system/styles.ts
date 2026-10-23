import type { TokenSet } from "./resolve";

/**
 * Component structure: how a design system draws a component, beyond colours and sizes. A
 * floating pill nav vs a docked bar, labels under every tab or none, a large start-aligned title
 * vs a centred one… Each axis is a string token `component.<group>.style.<axis>` in the system's
 * tree (so it's part of the role contract, filled into older systems, tunable and editable), and
 * its allowed values live only here. Builders read them with `styleOf`; extraction asks for them
 * as enums and measures them where it can (structure.ts).
 *
 * Adding an axis to a component: an entry here, a `{"$type": "string"}` token with the default in
 * tokens.json, and a branch in that component's builder. Defaults are the built-in look.
 */

export interface StyleAxis {
  /** Catalog component drawn with it. */
  component: string;
  /** Recipe group, e.g. "component.nav-bar". */
  group: string;
  axis: string;
  path: string;
  values: readonly string[];
  default: string;
  label: string;
  description: string;
  /** One line per value: what it looks like. */
  valueHelp: Record<string, string>;
}

const axis = (component: string, group: string, name: string, label: string, description: string, valueHelp: Record<string, string>, def: string): StyleAxis => ({
  component,
  group: `component.${group}`,
  axis: name,
  path: `component.${group}.style.${name}`,
  values: Object.keys(valueHelp),
  default: def,
  label,
  description,
  valueHelp,
});

export const STYLE_AXES: StyleAxis[] = [
  axis(
    "BottomNav",
    "nav-bar",
    "placement",
    "Placement",
    "Where the tab bar sits",
    {
      docked: "a full-width bar along the bottom edge",
      floating: "a rounded pill inset from the screen edges, floating above the bottom",
    },
    "docked",
  ),
  axis(
    "BottomNav",
    "nav-bar",
    "labels",
    "Labels",
    "Which tabs show a text label under the icon",
    {
      all: "every tab shows its label",
      active: "only the active tab shows its label",
      none: "icons only (labels stay as accessible names)",
    },
    "all",
  ),
  axis(
    "BottomNav",
    "nav-bar",
    "indicator",
    "Active indicator",
    "How the active tab is marked besides its colour",
    {
      none: "colour only",
      pill: "a filled shape behind the active icon (a circle when there are no labels)",
      dot: "a small dot under the active tab",
      line: "a short bar under the active tab",
    },
    "none",
  ),
  axis(
    "TopBar",
    "top-bar",
    "title",
    "Title",
    "Where the screen title sits in the top bar",
    {
      center: "centred between the bar's buttons",
      start: "on the start edge, next to the leading button",
      large: "a large title below the bar, on the start edge",
    },
    "center",
  ),
  axis(
    "SearchBar",
    "search",
    "icon",
    "Search icon",
    "Where the search field's magnifier sits",
    {
      start: "before the placeholder",
      end: "at the end of the field, after the placeholder",
    },
    "end",
  ),
  axis(
    "Tabs",
    "tabs",
    "indicator",
    "Indicator",
    "How the selected tab is marked",
    {
      underline: "a line under the selected tab",
      pill: "a filled pill behind the selected tab, no underline",
    },
    "underline",
  ),
  axis(
    "ListItem",
    "list-item",
    "leading",
    "Leading icon",
    "How a row's leading icon is drawn",
    {
      contained: "the icon sits in a filled shape",
      bare: "a plain icon, no container",
    },
    "contained",
  ),
  axis(
    "ListItem",
    "list-item",
    "divider",
    "Dividers",
    "Lines between rows, when a row doesn't say",
    {
      none: "only rows that ask for one get a divider",
      full: "a divider under every row, edge to edge",
      inset: "a divider under every row, starting at the text",
    },
    "none",
  ),
  axis(
    "ListItem",
    "list-item",
    "chevron",
    "Chevron",
    "Rows with no trailing element",
    {
      hidden: "nothing at the end",
      shown: "a chevron at the end, as rows open something",
    },
    "hidden",
  ),
  axis(
    "ServiceGrid",
    "tile",
    "layout",
    "Tiles",
    "How each service tile is drawn",
    {
      card: "a filled card with the icon and label inside",
      bare: "no card: the icon and its label on the page",
    },
    "card",
  ),
];

export const STYLE_BY_PATH = new Map(STYLE_AXES.map((a) => [a.path, a]));

export const isStylePath = (path: string) => STYLE_BY_PATH.has(path);

export const stylesFor = (component: string) => STYLE_AXES.filter((a) => a.component === component);

/** Recipe groups that have structure axes, in registry order. */
export const STYLE_GROUPS = [...new Set(STYLE_AXES.map((a) => a.group))];

/** An axis's value in a system: the token if it's one of the allowed values, else the default. */
export function styleOf(ts: TokenSet, path: string): string {
  const a = STYLE_BY_PATH.get(path);
  if (!a) throw new Error(`${path} is not a structure axis`);
  return ts.option(path, a.values, a.default);
}

/** Whether a value is allowed for an axis. */
export const isStyleValue = (path: string, value: unknown): value is string => typeof value === "string" && !!STYLE_BY_PATH.get(path)?.values.includes(value);

/**
 * The structure a system draws, as plain lines (one per component, only axes off their default
 * unless `all`): for prompts and docs, e.g. "BottomNav: a rounded pill inset from the screen
 * edges…; icons only…".
 */
export function structureLines(value: (path: string) => string, all = false): string[] {
  const out: string[] = [];
  for (const component of [...new Set(STYLE_AXES.map((a) => a.component))]) {
    const parts = stylesFor(component)
      .filter((a) => all || value(a.path) !== a.default)
      .map((a) => `${a.label.toLowerCase()}: ${a.valueHelp[value(a.path)] ?? a.valueHelp[a.default]}`);
    if (parts.length) out.push(`${component}: ${parts.join("; ")}`);
  }
  return out;
}
