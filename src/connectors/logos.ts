import { clampChroma, converter, formatHex, parse, wcagContrast, wcagLuminance } from "culori";
import { ENGINE_MAKER, type EngineKind } from "@/ai/engine-kinds";
import { CATALOG, connectorDef } from "./catalog";
import data from "./logos.json";

/*
 * Connector logos (pure, browser-safe): each connector's mark, and each engine maker's, from
 * logos.json (written by scripts/brand-logos.mts, bundled, never fetched), drawn on a tile that
 * stays light in both themes. A brand colour a shade too pale for the tile draws that shade deeper
 * (Claude's); one far too pale draws in ink. Call recordings have no one brand, so they draw an
 * audio glyph; a connector without a mark shows its first letter.
 */

/** The tile: --color-stage in globals.css, the same in both themes. */
export const TILE = "#f4f3f1";

/** Under this against the tile (WCAG 1.4.11, graphics), a glyph draws in ink. */
const MIN_CONTRAST = 3;

/** How much deeper (OKLCH lightness) a brand colour may draw and still be the brand's: Claude's #D97757 needs 0.02, Intercom's #6AFDEF 0.3. */
const SHADE = 0.05;

export type Logo =
  | { kind: "mark"; title: string; path: string; hex: string; tone: "brand" | "ink"; /** What it draws in on the tile (a brand tone). */ color?: string }
  | { kind: "audio"; title: string }
  | { kind: "letter"; title: string; letter: string };

const MARKS: Record<string, { path: string; hex: string; title: string }> = data.logos;

const toOklch = converter("oklch");

/** The colour a brand's glyph draws in on the tile: its own where it reads, the same hue a shade deeper where that's all it takes, else null (ink). */
export function tileColor(hex: string): string | null {
  const brand = `#${hex.replace(/^#/, "")}`;
  const color = parse(brand);
  if (!color) return null;
  if (wcagContrast(color, TILE) >= MIN_CONTRAST) return brand;
  const deeper = brandOn(hex, TILE);
  return deeper && (toOklch(brand)?.l ?? 0) - (toOklch(deeper)?.l ?? 0) <= SHADE ? deeper : null;
}

/** Whether a brand colour reads on the tile (perhaps a shade deeper), or its glyph draws in ink (Intercom's #6AFDEF). */
export function glyphTone(hex: string): "brand" | "ink" {
  return tileColor(hex) ? "brand" : "ink";
}

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

/** A connector's logo by its id (`drive` is Google Drive's mark), or an engine maker's (`claude`, `openai`…). */
export function logoFor(id: string): Logo {
  const title = connectorDef(id)?.label ?? id;
  const mark = MARKS[id];
  if (mark) {
    const color = tileColor(mark.hex);
    const drawn = { kind: "mark" as const, title: mark.title, path: mark.path, hex: mark.hex };
    return color ? { ...drawn, tone: "brand", color } : { ...drawn, tone: "ink" };
  }
  if (id === "calls") return { kind: "audio", title };
  return { kind: "letter", title, letter: title.trim().charAt(0).toUpperCase() || "?" };
}

/** The logo an engine wears: its maker's (Claude Code and a Claude key wear Claude's; Codex and an OpenAI key, OpenAI's). */
export const engineLogo = (kind: EngineKind): Logo => logoFor(ENGINE_MAKER[kind]);

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
