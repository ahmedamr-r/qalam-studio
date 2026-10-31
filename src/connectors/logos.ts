import { clampChroma, converter, formatHex, parse, wcagContrast, wcagLuminance } from "culori";
import { CATALOG, connectorDef } from "./catalog";
import data from "./logos.json";

/*
 * Connector logos (pure, browser-safe): each connector's mark from logos.json (written by
 * scripts/brand-logos.mts, bundled, never fetched), drawn on a tile that stays light in both themes.
 * A brand colour too pale for the tile draws in ink instead. Call recordings have no one brand, so
 * they draw an audio glyph; a connector without a mark shows its first letter.
 */

/** The tile: --color-stage in globals.css, the same in both themes. */
export const TILE = "#f4f3f1";

/** Under this against the tile (WCAG 1.4.11, graphics), a glyph draws in ink. */
const MIN_CONTRAST = 3;

export type Logo =
  | { kind: "mark"; title: string; path: string; hex: string; tone: "brand" | "ink" }
  | { kind: "audio"; title: string }
  | { kind: "letter"; title: string; letter: string };

const MARKS: Record<string, { path: string; hex: string; title: string }> = data.logos;

/** Whether a brand colour reads on the tile, or its glyph draws in ink (Intercom's #6AFDEF). */
export function glyphTone(hex: string): "brand" | "ink" {
  const color = parse(`#${hex.replace(/^#/, "")}`);
  return color && wcagContrast(color, TILE) >= MIN_CONTRAST ? "brand" : "ink";
}

const toOklch = converter("oklch");

/**
 * A brand colour that reads on another ground (a board's dark tile): as it is when it does, else
 * the same hue made lighter (or darker, on a light ground) until it does. Null when it's near grey
 * (Notion's black): its glyph draws in ink.
 */
export function brandOn(hex: string, on: string): string | null {
  const brand = `#${hex.replace(/^#/, "")}`;
  const color = toOklch(brand);
  const ground = parse(on);
  if (!color || !ground) return null;
  if (wcagContrast(brand, ground) >= MIN_CONTRAST) return brand;
  if ((color.c ?? 0) < 0.04) return null;
  const step = wcagLuminance(ground) < 0.2 ? 0.02 : -0.02;
  for (let l = color.l + step; l > 0 && l < 1; l += step) {
    const next = formatHex(clampChroma({ ...color, l }, "oklch"));
    if (wcagContrast(next, ground) >= MIN_CONTRAST) return next;
  }
  return null;
}

/** A connector's logo by its id (`drive` is Google Drive's mark). */
export function logoFor(id: string): Logo {
  const title = connectorDef(id)?.label ?? id;
  const mark = MARKS[id];
  if (mark) return { kind: "mark", title: mark.title, path: mark.path, hex: mark.hex, tone: glyphTone(mark.hex) };
  if (id === "calls") return { kind: "audio", title };
  return { kind: "letter", title, letter: title.trim().charAt(0).toUpperCase() || "?" };
}

/** Hosts by the connector their pages come from. Atlassian's sites are read by path below. */
const HOSTS: readonly [RegExp, string][] = [
  [/(^|\.)notion\.(so|site|com)$/, "notion"],
  [/^(drive|docs)\.google\.com$/, "drive"],
  [/(^|\.)slack\.com$/, "slack"],
  [/(^|\.)intercom\.(com|io)$/, "intercom"],
  [/(^|\.)zendesk\.com$/, "zendesk"],
  [/(^|\.)(granola\.(ai|so)|gong\.io|fireflies\.ai|fathom\.video)$/, "calls"],
  [/(^|\.)linear\.app$/, "linear"],
  [/(^|\.)github\.com$/, "github"],
  [/(^|\.)figma\.com$/, "figma"],
  [/(^|\.)posthog\.com$/, "posthog"],
  [/(^|\.)amplitude\.com$/, "amplitude"],
  [/(^|\.)mixpanel\.com$/, "mixpanel"],
];

/**
 * The connector a source came from, by its `origin`: the item's address (a Notion page, an Intercom
 * conversation, a Confluence page), `<connector>:<item>` when the tool gave none, or the label of
 * the tool a board brought it in with (as Claude Code names it). Null for anything else, a web page
 * a search tool found among them.
 */
export function connectorOfOrigin(origin: string | undefined): string | null {
  const o = origin?.trim();
  if (!o) return null;
  if (/^https?:\/\//i.test(o)) {
    let u: URL;
    try {
      u = new URL(o);
    } catch {
      return null;
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (/\.atlassian\.net$/.test(host)) return /^\/wiki(\/|$)/.test(u.pathname) ? "confluence" : /^\/(browse|jira)(\/|$)/.test(u.pathname) ? "jira" : null;
    return HOSTS.find(([re]) => re.test(host))?.[1] ?? null;
  }
  const prefix = /^([a-z]+):/.exec(o)?.[1];
  if (prefix && connectorDef(prefix)) return prefix;
  return CATALOG.find((c) => c.claudeCode?.test(o) || c.label === o)?.id ?? null;
}
