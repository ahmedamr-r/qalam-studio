import { hueOf } from "../ramp";
import { normalizeHex } from "../resolve";
import { arabicPairing, displayFor, rankFonts } from "./fonts";
import { AXES, AXIS_POLES, hueName, knobHash, stepKnob, type AxisId, type Direction, type Domain, type KnobId, type Knobs, type ReadBack } from "./knobs";

/**
 * From personality to knobs: a fixed, inspectable table. The product's domain sets the starting
 * point (finance for businesses starts compact and hairline, finance for people soft and roomy);
 * each strong axis reading then moves knobs one step. The mapping follows the evidence on
 * perception (rounded = friendly, angular = authoritative; saturation = energy; serif = classic
 * and formal; density = expertise), not claims about conversion.
 */

type Prior = Omit<Knobs, "brandHex" | "font" | "displayFont" | "arabicFont">;

const BASE: Prior = {
  hue: 250,
  chroma: "balanced",
  neutralTint: "cool",
  contrast: "standard",
  radius: "medium",
  density: "regular",
  bodySize: "16",
  typeRatio: "1.2",
  elevation: "soft",
  fill: "solid",
  motion: "standard",
};

export const DOMAIN_PRIORS: Record<Domain, Partial<Prior> & { hue: number }> = {
  "b2b-finance": { hue: 255, neutralTint: "cool", contrast: "high", radius: "small", density: "snug", bodySize: "14", elevation: "hairline", fill: "solid" },
  "consumer-finance": { hue: 165, neutralTint: "brand", radius: "large", elevation: "soft", fill: "tonal" },
  mobility: { hue: 150, chroma: "vivid", radius: "large", fill: "tonal" },
  commerce: { hue: 30, chroma: "vivid", radius: "medium", elevation: "soft" },
  saas: { hue: 275, neutralTint: "cool", density: "snug", bodySize: "14", elevation: "hairline", fill: "tonal" },
  other: { hue: 230 },
};

/** A strong reading (≤ .3 or ≥ .7) moves an ordinal knob one step: `dir` +1 = toward later options at the high pole. */
export const AXIS_RULES: { axis: AxisId; knob: KnobId; dir: 1 | -1 }[] = [
  { axis: "authority", knob: "radius", dir: -1 },
  { axis: "serious", knob: "radius", dir: -1 },
  { axis: "compact", knob: "density", dir: -1 },
  { axis: "energetic", knob: "chroma", dir: 1 },
  { axis: "serious", knob: "chroma", dir: -1 },
  { axis: "energetic", knob: "typeRatio", dir: 1 },
  { axis: "serious", knob: "typeRatio", dir: -1 },
  { axis: "energetic", knob: "motion", dir: 1 },
  { axis: "serious", knob: "motion", dir: -1 },
];

const strong = (v: number) => (v >= 0.7 ? 1 : v <= 0.3 ? -1 : 0);

export const axisValues = (r: ReadBack): Record<AxisId, number> => Object.fromEntries(AXES.map((a) => [a, r.axes[a]?.value ?? 0.5])) as Record<AxisId, number>;

/** Knobs straight from the read: the code's own suggestion, and the reference the directions are measured from. */
export function baselineKnobs(r: ReadBack): Knobs {
  const a = axisValues(r);
  const brandHex = r.brandHex ? (normalizeHex(r.brandHex)?.slice(0, 7) ?? null) : null;
  let k: Knobs = { ...BASE, ...DOMAIN_PRIORS[r.domain], brandHex, font: "Inter", displayFont: "same", arabicFont: "IBM Plex Sans Arabic" };
  if (brandHex) k.hue = Math.round(hueOf(brandHex) ?? k.hue);

  // Correlated axes (authority and seriousness) shouldn't double up: each knob moves one step at most.
  const push = new Map<KnobId, number>();
  for (const rule of AXIS_RULES) push.set(rule.knob, (push.get(rule.knob) ?? 0) + strong(a[rule.axis]) * rule.dir);
  for (const [knob, steps] of push) k = stepKnob(k, knob, Math.max(-1, Math.min(1, steps)));

  // Categorical knobs: the clearest reading wins, else the domain's.
  if (a.innovative <= 0.35 && a.energetic <= 0.5) k.neutralTint = "warm";
  else if (a.innovative >= 0.65 && a.serious >= 0.5) k.neutralTint = "cool";
  else if (a.authority <= 0.35 && a.serious <= 0.4) k.neutralTint = "brand";
  if (a.authority >= 0.65) k.fill = "solid";
  else if (a.authority <= 0.35) k.fill = "tonal";
  if (a.innovative <= 0.35 && a.compact >= 0.65) k.fill = "outline";
  if (a.authority >= 0.75 && a.serious >= 0.7) k.contrast = "high";
  if (a.compact >= 0.75 && k.elevation === "soft") k.elevation = "hairline";
  else if (a.authority <= 0.35 && a.compact <= 0.5 && k.elevation !== "layered") k.elevation = "soft";
  if (a.energetic >= 0.75 && a.innovative >= 0.6 && k.elevation !== "hairline") k.elevation = "layered";
  // Desktop tools read at 14; phones stay at 16 unless the brand is very compact.
  k.bodySize = r.platform === "mobile" ? (a.compact >= 0.75 ? "14" : "16") : a.compact >= 0.5 || k.bodySize === "14" ? "14" : "16";

  const font = rankFonts(a)[0]?.family ?? "Inter";
  return { ...k, font, displayFont: displayFor(a, font), arabicFont: arabicPairing(font, a) };
}

/** The axes the read is least sure about: where the directions differ. */
export function lowConfidenceAxes(r: ReadBack, n = 2): AxisId[] {
  return [...AXES].sort((x, y) => (r.axes[x]?.confidence ?? 0) - (r.axes[y]?.confidence ?? 0) || AXES.indexOf(x) - AXES.indexOf(y)).slice(0, n);
}

const withAxis = (r: ReadBack, axis: AxisId, value: number): ReadBack => ({ ...r, axes: { ...r.axes, [axis]: { ...r.axes[axis], value } } });

/**
 * Three directions without AI (and to fill in when the model's aren't distinct): the baseline,
 * then the least certain axis pushed to each pole.
 */
export function codeDirections(r: ReadBack): Direction[] {
  const base = baselineKnobs(r);
  const out: Direction[] = [{ name: "Balanced", rationale: "Straight from your answers.", knobs: base, source: "code" }];
  const seen = new Set([knobHash(base)]);
  // Without a brand colour, each alternative also tries a neighbouring hue: side by side, a
  // direction should look like a real choice.
  const hueFor = (i: number) => (r.brandHex ? base.hue : (base.hue + (i === 1 ? 35 : -35) + 360) % 360);
  const push = (knobs: Knobs, name: string, rationale: string) => {
    if (out.length === 3) return;
    const k = { ...knobs, hue: hueFor(out.length) };
    if (seen.has(knobHash(k))) return;
    seen.add(knobHash(k));
    out.push({ name, rationale: r.brandHex ? rationale : `${rationale} In ${hueName(k.hue)}.`, knobs: k, source: "code" });
  };
  for (const axis of lowConfidenceAxes(r, AXES.length)) {
    for (const [value, pole] of [[0.12, 0], [0.88, 1]] as const) {
      const knobs = baselineKnobs(withAxis(r, axis, value));
      if (knobHash({ ...knobs, hue: base.hue }) === knobHash(base)) continue;
      const name = AXIS_POLES[axis][pole];
      push(knobs, `More ${name.toLowerCase()}`, `Leans ${name.toLowerCase()}, where your answers left room.`);
    }
    if (out.length === 3) break;
  }
  // A read with nothing left to explore: vary the shape and colour by hand.
  for (const [id, steps, name] of [["radius", 2, "Softer"], ["chroma", 1, "Bolder"], ["radius", -2, "Sharper"]] as const) push(stepKnob(base, id, steps), name, "A variation to compare against.");
  return out;
}
