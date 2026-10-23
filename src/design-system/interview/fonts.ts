import data from "./fonts.json";
import type { AxisId } from "./knobs";

/**
 * Fonts for a personality. Each family carries the crowd-rated "Expressive" scores Google Fonts
 * publishes (how Business, Calm, Playful… it reads, 0–100). The axes become a target on those
 * scores and families are ranked by how well their ratings agree with it, with a nudge for classification
 * (serifs read formal and stable; rounded and geometric read friendly) and for well-used families.
 */

export type ExpressiveTag =
  | "business" | "calm" | "competent" | "sincere" | "sophisticated" | "playful" | "excited" | "active" | "futuristic" | "innovative"
  | "happy" | "cute" | "childlike" | "vintage" | "rugged" | "awkward" | "stiff" | "loud" | "fancy" | "artistic";

export type Classification = "geometric" | "humanist" | "grotesque" | "neo-grotesque" | "rounded" | "superellipse" | "transitional" | "old-style" | "modern" | "slab";

export interface FontFamily {
  family: string;
  category: "sans" | "serif";
  classification: Classification;
  weights: number[];
  /** Has Arabic glyphs itself. */
  arabic: boolean;
  expressive: Record<ExpressiveTag, number>;
  /** One of the Arabic faces Latin fonts are paired with. */
  arabicFace?: true;
  /** Drawn for large sizes: headings only. */
  displayOnly?: true;
}

export const FONTS = (data as { families: FontFamily[] }).families;
export const FONT_BY_NAME = new Map(FONTS.map((f) => [f.family, f]));
/** Interface families, most used first. */
export const LATIN_FONTS = FONTS.filter((f) => !f.arabicFace);
export const ARABIC_FONTS = ["IBM Plex Sans Arabic", "Noto Sans Arabic", "Readex Pro", "Tajawal", "Almarai", "Noto Kufi Arabic"] as const;
export type ArabicFamily = (typeof ARABIC_FONTS)[number];

type Axes = Record<AxisId, number>;

/**
 * What the personality asks of a typeface, on the Expressive scale (0–1; 0.5 = indifferent).
 * Headings may be fancier than body text, which should never read childish unless the brand is.
 */
export function fontTarget(a: Axes, role: "body" | "display" = "body"): Partial<Record<ExpressiveTag, number>> {
  const classic = 1 - a.innovative;
  return {
    business: (a.authority + a.serious) / 2,
    competent: a.authority,
    calm: 1 - a.energetic,
    sincere: 1 - a.authority,
    playful: 1 - a.serious,
    happy: (1 - a.serious + a.energetic) / 2,
    excited: a.energetic,
    active: a.energetic,
    loud: a.energetic,
    futuristic: a.innovative,
    innovative: a.innovative,
    sophisticated: (a.serious + classic) / 2,
    vintage: classic,
    fancy: role === "display" ? ((a.serious + classic) / 2) * (1 - a.energetic / 2) : 0.2,
    childlike: (1 - a.serious) * (1 - a.authority),
    cute: (1 - a.serious) * (1 - a.authority),
  };
}

/** Tags most families are rated on: too few of them and a family's personality is unknown. */
const CORE: ExpressiveTag[] = ["business", "calm", "competent", "sincere", "playful", "sophisticated", "happy", "excited", "futuristic", "innovative", "vintage"];

const SERIF = new Set<Classification>(["transitional", "old-style", "modern", "slab"]);

/** Classification nudge (0–0.12): the shapes that carry each personality. */
function affinity(c: Classification, a: Axes): number {
  const friendly = 1 - (a.authority + a.serious) / 2;
  switch (c) {
    case "rounded":
      return 0.12 * friendly * (1 - a.serious);
    case "geometric":
      return 0.06 * a.innovative + 0.04 * friendly;
    case "humanist":
      return 0.06 * (1 - a.authority) + 0.03 * (1 - a.energetic);
    case "neo-grotesque":
    case "grotesque":
    case "superellipse":
      return 0.06 * a.serious + 0.04 * a.innovative;
    default:
      return SERIF.has(c) ? 0.1 * a.serious * (1 - a.innovative) : 0;
  }
}

/** Ranked families for a role: body text never gets display-only faces, and only reads in a serif when the brand is classic and serious. */
export function rankFonts(a: Axes, role: "body" | "display" = "body"): FontFamily[] {
  const target = fontTarget(a, role);
  const keys = Object.keys(target) as ExpressiveTag[];
  const serifOK = role === "display" || (a.serious >= 0.7 && a.innovative <= 0.25);
  const scored = LATIN_FONTS.filter((f) => (role === "body" ? !f.displayOnly : true) && (serifOK || f.category === "sans")).map((f, i) => {
    // Most families are rated on a few tags only (unrated reads 0), so a tag counts for what it
    // says: wanted traits the family has add, unwanted ones subtract, indifferent ones nothing.
    const fit = keys.reduce((sum, k) => sum + (f.expressive[k] / 100) * (target[k]! - 0.5) * 2, 0) / keys.length;
    const flaws = (0.3 * f.expressive.awkward + 0.2 * f.expressive.stiff + 0.1 * f.expressive.rugged) / 100 / 4;
    const unknown = CORE.filter((k) => f.expressive[k] > 0).length < 3 ? 0.05 : 0;
    const used = 0.08 * (1 - i / LATIN_FONTS.length);
    return { f, score: fit - flaws - unknown + affinity(f.classification, a) + used };
  });
  return scored.sort((x, y) => y.score - x.score || x.f.family.localeCompare(y.f.family)).map((s) => s.f);
}

/** Families Qalam AI may choose from (it never names a font outside this list). */
export function fontCandidates(a: Axes, n = 10): string[] {
  const body = rankFonts(a, "body").slice(0, n).map((f) => f.family);
  const display = rankFonts(a, "display")
    .filter((f) => !body.includes(f.family))
    .slice(0, 3)
    .map((f) => f.family);
  return [...body, ...display];
}

/** Headings in a serif when the brand is classic and serious; otherwise the body font. */
export function displayFor(a: Axes, body: string): string {
  if (a.innovative > 0.35 || a.serious < 0.55) return "same";
  const serif = rankFonts(a, "display").find((f) => f.category === "serif");
  return serif && serif.family !== body ? serif.family : "same";
}

/** The Arabic face that sits best next to a Latin family. */
export function arabicPairing(latin: string, a: Axes): ArabicFamily {
  const f = FONT_BY_NAME.get(latin);
  if (a.innovative >= 0.7 && a.serious >= 0.6) return "Noto Kufi Arabic";
  if (!f) return "IBM Plex Sans Arabic";
  if (f.classification === "rounded" || (a.serious <= 0.3 && a.authority <= 0.4)) return f.classification === "geometric" ? "Tajawal" : "Almarai";
  if (f.classification === "geometric") return "Readex Pro";
  if (f.classification === "humanist" || SERIF.has(f.classification)) return "Noto Sans Arabic";
  return "IBM Plex Sans Arabic";
}

/** Weights the system uses that a family doesn't have (they fall back to the nearest). */
export function weightGaps(family: string, used: readonly number[]): number[] {
  const f = FONT_BY_NAME.get(family);
  return f ? [...new Set(used)].filter((w) => !f.weights.includes(w)).sort((x, y) => x - y) : [];
}
