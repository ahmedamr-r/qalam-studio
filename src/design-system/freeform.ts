import { nanoid } from "nanoid";
import type { Platform } from "./platform";
import type { DesignSystem } from "./registry";
import { interviewDocs, knobSentence, expandKnobs, systemFonts } from "./interview/expand";
import { FONT_BY_NAME, LATIN_FONTS } from "./interview/fonts";
import { hueName, type Knobs } from "./interview/knobs";
import { brandHexFrom, knobsFrom } from "./interview/sanitize";
import { readOf } from "./interview/samples";

/**
 * Screens without a design system. When the designer generates with "No design system", Qalam AI
 * also picks how the screens look: a named look of a dozen knobs (the brand interview's, see
 * interview/knobs.ts). Code expands the knobs into every token, with contrast checked, and the
 * screens are bound to that look as their own system: hidden from the system pickers until the
 * designer saves it as a design system.
 */

/** What a "No design system" request carries as its system (ChatRequest.system.id). */
export const FREEFORM_ID = "freeform";
export const FREEFORM_NAME = "No design system";

export interface Look {
  /** 2–3 words, e.g. "Quiet studio". */
  name: string;
  /** One sentence on why it fits the brief. */
  rationale: string;
  adjectives: string[];
  knobs: Knobs;
}

/** Latin families the model may pick (Arabic faces are a knob of their own). */
export const LOOK_FONTS = LATIN_FONTS.map((f) => f.family);

/** The look a request gets when the model gave none (samples, no AI): plain and neutral. */
export function defaultLook(platform: Platform = "mobile"): Look {
  const desktop = platform !== "mobile";
  return {
    name: "Plain neutral",
    rationale: "A neutral starting point: cool greys, a blue accent and medium corners.",
    adjectives: ["clear", "neutral"],
    knobs: {
      hue: 250,
      brandHex: null,
      chroma: "balanced",
      neutralTint: "cool",
      contrast: "standard",
      radius: "medium",
      density: desktop ? "snug" : "regular",
      bodySize: desktop ? "14" : "16",
      typeRatio: "1.2",
      font: "Inter",
      displayFont: "same",
      arabicFont: "IBM Plex Sans Arabic",
      elevation: desktop ? "hairline" : "soft",
      fill: "solid",
      motion: "standard",
    },
  };
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** Text up to `max` characters, cut after its last whole sentence rather than mid-word. */
function sentences(v: unknown, max: number): string {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  return end > 0 ? head.slice(0, end + 1) : `${head.slice(0, head.lastIndexOf(" ")).replace(/[,;:]$/, "")}…`;
}

/**
 * The model's look, made safe to build from: every knob one of its options, fonts from the
 * catalogue, and a brand colour only when the brief itself gives one (as a hex).
 */
export function sanitizeLook(raw: unknown, ctx: { brief: string; platform?: Platform }): Look {
  const base = defaultLook(ctx.platform);
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const knobs = knobsFrom(r, base.knobs, { brandHex: brandHexFrom(ctx.brief) }, LOOK_FONTS);
  // A display face must be a real Latin family; knobsFrom already falls back to "same".
  if (knobs.displayFont !== "same" && !FONT_BY_NAME.has(knobs.displayFont)) knobs.displayFont = "same";
  const adjectives = (Array.isArray(r.adjectives) ? r.adjectives : []).map((a) => clip(a, 24)).filter(Boolean).slice(0, 4);
  return {
    name: clip(r.name, 40) || `${hueName(knobs.hue)[0].toUpperCase()}${hueName(knobs.hue).slice(1)} look`,
    rationale: sentences(r.rationale, 320),
    adjectives,
    knobs,
  };
}

/** The look as a system the screens are bound to: source "freeform", not listed until saved. */
export function lookSystem(look: Look, o: { platform?: Platform; projectId?: string; id?: string; now?: number } = {}): DesignSystem {
  const { tree, notes } = expandKnobs(look.knobs, { platform: o.platform });
  const now = o.now ?? Date.now();
  const read = readOf("other", {}, {
    summary: look.rationale || "A look Qalam AI picked for these screens.",
    adjectives: look.adjectives,
    platform: o.platform ?? "mobile",
    language: { principles: [], voice: "", dos: [], donts: [] },
  });
  return {
    id: o.id ?? `look-${nanoid(8)}`,
    name: look.name,
    source: "freeform",
    tree,
    docs: interviewDocs(read, look.knobs, look.name),
    fonts: systemFonts(look.knobs),
    notes,
    look: { rationale: look.rationale, knobs: look.knobs },
    ...(o.projectId ? { projectId: o.projectId } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/** The look in a sentence ("Regular, with vivid colour in teal, large corners…"). */
export const lookSentence = (k: Knobs) => knobSentence(k);

/** Systems the pickers list: every system but looks nobody saved. */
export const isListed = (s: Pick<DesignSystem, "source" | "kept">) => s.source !== "freeform" || !!s.kept;
