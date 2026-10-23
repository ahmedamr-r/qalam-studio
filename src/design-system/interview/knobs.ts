import type { Platform } from "../platform";

/**
 * The brand interview's model of a system. Qalam AI reads the brief into personality axes; a
 * fixed table turns axes into a dozen knobs; code expands knobs into every token. Knobs are what
 * the designer changes in Refine, so each has a label and a phrase for the editable sentence.
 */

export type Domain = "b2b-finance" | "consumer-finance" | "mobility" | "commerce" | "saas" | "other";
export const DOMAINS: readonly Domain[] = ["b2b-finance", "consumer-finance", "mobility", "commerce", "saas", "other"];
export const DOMAIN_LABEL: Record<Domain, string> = {
  "b2b-finance": "Finance for businesses",
  "consumer-finance": "Finance for people",
  mobility: "Mobility and delivery",
  commerce: "Shopping and commerce",
  saas: "Software tool",
  other: "Something else",
};

/** The kind of product in a sentence ("the hardest piece of a business finance product"). */
export const DOMAIN_NOUN: Record<Domain, string> = {
  "b2b-finance": "a business finance product",
  "consumer-finance": "a personal finance app",
  mobility: "a mobility app",
  commerce: "a shopping app",
  saas: "a software tool",
  other: "a product like yours",
};

/** 0 is the first pole, 1 the second (GV Brand Sprint sliders, Aaker's dimensions). */
export type AxisId = "authority" | "serious" | "energetic" | "compact" | "innovative";
export const AXES: readonly AxisId[] = ["authority", "serious", "energetic", "compact", "innovative"];
export const AXIS_POLES: Record<AxisId, [string, string]> = {
  authority: ["Friend", "Authority"],
  serious: ["Playful", "Serious"],
  energetic: ["Calm", "Energetic"],
  compact: ["Airy", "Compact"],
  innovative: ["Classic", "Innovative"],
};

export interface AxisRead {
  /** 0–1 between the poles. */
  value: number;
  /** How sure the read is (0–1): low ones are what the directions explore. */
  confidence: number;
  /** The designer's own words behind it. */
  evidence: string[];
}

export interface Slots {
  brand: string;
  currency: string;
  city: string;
  people: string[];
  places: string[];
  ar?: { brand: string; city: string; people: string[] };
}

/** What Qalam AI heard in the brief (designer-editable before anything is generated). */
export interface ReadBack {
  summary: string;
  adjectives: string[];
  domain: Domain;
  audience: string;
  platform: Platform;
  scripts: ("latin" | "arabic")[];
  /** Only from the brand-colour answer: never invented. */
  brandHex: string | null;
  axes: Record<AxisId, AxisRead>;
  admired: string[];
  avoided: string[];
  language: { principles: { title: string; body: string }[]; voice: string; dos: string[]; donts: string[] };
  /** Content for the preview screens, so they read like this product. */
  slots: Slots;
}

export interface Knobs {
  hue: number;
  brandHex: string | null;
  chroma: "muted" | "balanced" | "vivid" | "bold";
  neutralTint: "pure" | "cool" | "warm" | "brand";
  contrast: "standard" | "high";
  radius: "none" | "small" | "medium" | "large" | "full";
  density: "compact" | "snug" | "regular" | "comfortable" | "spacious";
  bodySize: "14" | "16";
  typeRatio: "1.2" | "1.25";
  font: string;
  /** "same" = headings use the body font. */
  displayFont: string;
  arabicFont: string;
  elevation: "flat" | "hairline" | "soft" | "layered";
  fill: "solid" | "tonal" | "outline";
  motion: "standard" | "expressive";
  /**
   * Per-component choices that override the system ones: component name → its option → value
   * (see components.ts). Absent, or an option left out: the component follows the system.
   */
  components?: Record<string, Record<string, string>>;
}

export type KnobId = Exclude<keyof Knobs, "brandHex" | "components">;
export type KnobGroup = "colour" | "type" | "shape";

interface KnobSpec {
  group: KnobGroup;
  label: string;
  /** Ordered options (ordinal knobs can be nudged one step); empty for free-form (hue, fonts). */
  options: readonly string[];
  ordinal: boolean;
  /** The option as it reads in the sentence. */
  phrase: (v: string) => string;
}

export const KNOB_SPECS: Record<KnobId, KnobSpec> = {
  hue: { group: "colour", label: "Brand hue", options: [], ordinal: false, phrase: (v) => hueName(Number(v)) },
  chroma: { group: "colour", label: "Colour", options: ["muted", "balanced", "vivid", "bold"], ordinal: true, phrase: (v) => `${v} colour` },
  neutralTint: {
    group: "colour",
    label: "Greys",
    options: ["pure", "cool", "warm", "brand"],
    ordinal: false,
    phrase: (v) => (v === "pure" ? "pure greys" : v === "brand" ? "brand-tinted greys" : `${v} greys`),
  },
  contrast: { group: "colour", label: "Contrast", options: ["standard", "high"], ordinal: true, phrase: (v) => `${v} contrast` },
  radius: {
    group: "shape",
    label: "Corners",
    options: ["none", "small", "medium", "large", "full"],
    ordinal: true,
    phrase: (v) => (v === "none" ? "square corners" : v === "full" ? "pill-shaped controls" : `${v} corners`),
  },
  density: { group: "shape", label: "Density", options: ["compact", "snug", "regular", "comfortable", "spacious"], ordinal: true, phrase: (v) => v },
  bodySize: { group: "type", label: "Body size", options: ["14", "16"], ordinal: true, phrase: (v) => `${v}px body text` },
  typeRatio: { group: "type", label: "Type scale", options: ["1.2", "1.25"], ordinal: true, phrase: (v) => (v === "1.2" ? "a tight type scale" : "a dramatic type scale") },
  font: { group: "type", label: "Font", options: [], ordinal: false, phrase: (v) => v },
  displayFont: { group: "type", label: "Headings", options: [], ordinal: false, phrase: (v) => (v === "same" ? "the same font for headings" : `${v} headings`) },
  arabicFont: { group: "type", label: "Arabic", options: [], ordinal: false, phrase: (v) => `${v} for Arabic` },
  elevation: {
    group: "shape",
    label: "Depth",
    options: ["flat", "hairline", "soft", "layered"],
    ordinal: true,
    phrase: (v) => (v === "flat" ? "flat surfaces" : v === "hairline" ? "hairline borders" : v === "soft" ? "soft shadows" : "layered shadows"),
  },
  fill: { group: "shape", label: "Controls", options: ["solid", "tonal", "outline"], ordinal: false, phrase: (v) => `${v} secondary controls` },
  motion: { group: "shape", label: "Motion", options: ["standard", "expressive"], ordinal: true, phrase: (v) => `${v} motion` },
};

export const KNOB_IDS = Object.keys(KNOB_SPECS) as KnobId[];
export const GROUP_KNOBS: Record<KnobGroup, KnobId[]> = {
  colour: KNOB_IDS.filter((k) => KNOB_SPECS[k].group === "colour"),
  type: KNOB_IDS.filter((k) => KNOB_SPECS[k].group === "type"),
  shape: KNOB_IDS.filter((k) => KNOB_SPECS[k].group === "shape"),
};

/** Named hues (OKLCH degrees), for picking a brand hue without a colour of one's own. */
export const NAMED_HUES: [number, string][] = [
  [15, "red"], [40, "coral"], [65, "orange"], [90, "amber"], [110, "yellow"], [130, "lime"], [155, "green"],
  [180, "emerald"], [200, "teal"], [225, "cyan"], [250, "blue"], [275, "indigo"], [300, "violet"], [330, "purple"], [355, "pink"],
];
/** A plain name for an OKLCH hue. */
export function hueName(h: number): string {
  const x = ((h % 360) + 360) % 360;
  let best = NAMED_HUES[0];
  for (const e of NAMED_HUES) if (Math.abs(((x - e[0] + 540) % 360) - 180) < Math.abs(((x - best[0] + 540) % 360) - 180)) best = e;
  return best[1];
}

/** Changes whenever the generator's output for the same knobs would change. */
export const GENERATOR_VERSION = 1;

/** JSON with object keys sorted at every level, so equal values always read the same. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .filter((key) => (v as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stable((v as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/** A stable key for caches: same knobs (and generator), same hash. */
export function knobHash(k: Knobs): string {
  const { components, ...rest } = k;
  // No component choices and an empty set are the same system.
  const json = stable(components && Object.keys(components).length ? { ...rest, components } : rest) + GENERATOR_VERSION;
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = (Math.imul(h, 33) ^ json.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** How different two systems are (0 = the same): ordinal knobs by steps, others by mismatch, hue by angle. */
export function knobDistance(a: Knobs, b: Knobs): number {
  let d = Math.abs(((a.hue - b.hue + 540) % 360) - 180) / 180;
  for (const id of KNOB_IDS) {
    if (id === "hue") continue;
    const s = KNOB_SPECS[id];
    const x = a[id] as string;
    const y = b[id] as string;
    if (x === y) continue;
    d += s.ordinal ? Math.abs(s.options.indexOf(x) - s.options.indexOf(y)) / (s.options.length - 1) : 1;
  }
  return d + (a.brandHex === b.brandHex ? 0 : 1);
}

/** Move an ordinal knob `steps` along its options (clamped). */
export function stepKnob<K extends KnobId>(k: Knobs, id: K, steps: number): Knobs {
  const s = KNOB_SPECS[id];
  if (!s.ordinal || !steps) return k;
  const i = s.options.indexOf(k[id] as string);
  const j = Math.max(0, Math.min(s.options.length - 1, i + steps));
  return i === j ? k : { ...k, [id]: s.options[j] };
}

export interface Direction {
  name: string;
  /** One line on why, quoting the brief. */
  rationale: string;
  knobs: Knobs;
  /** Qalam AI wrote it, or code made it (no AI, or to fill in). */
  source: "ai" | "code";
  hueReason?: string;
}
