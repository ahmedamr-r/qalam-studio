import { inferPlatform, isPlatform } from "../platform";
import { hueOf } from "../ramp";
import { normalizeHex } from "../resolve";
import { ARABIC_FONTS, FONT_BY_NAME } from "./fonts";
import { AXES, DOMAINS, KNOB_IDS, KNOB_SPECS, knobDistance, knobHash, type AxisId, type Direction, type Domain, type KnobId, type Knobs, type ReadBack, type Slots } from "./knobs";
import { codeDirections } from "./table";

/**
 * The model's answers, made safe to build from. Code decides what counts: quotes must really be
 * the designer's words, the brand colour only ever comes from their answer, every knob is one of
 * its options, a nudge moves a knob one step at most and never a locked one, and there are always
 * exactly three distinct directions.
 */

export interface BriefAnswer {
  id: string;
  question: string;
  answer: string;
}

export interface FollowUp {
  id: string;
  question: string;
  why: string;
  options: string[];
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const list = (v: unknown, n: number, max: number) =>
  (Array.isArray(v) ? v : [])
    .map((x) => clip(x, max))
    .filter(Boolean)
    .filter((x, i, a) => a.indexOf(x) === i)
    .slice(0, n);
const clamp01 = (v: unknown, fallback = 0.5) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};
const norm = (s: string) => s.toLowerCase().replace(/[“”"'’`]/g, "").replace(/\s+/g, " ").trim();
const ARABIC_CHARS = /[؀-ۿ]/;

/** The designer's brand colour, from their answer only ("#0090ff", "0090FF", "#09f"). */
export function brandHexFrom(answer: string): string | null {
  const m = answer.match(/#?\b([0-9a-f]{6}|[0-9a-f]{3})\b/i);
  return m ? (normalizeHex(`#${m[1]}`)?.slice(0, 7) ?? null) : null;
}

function slotsFrom(v: unknown, brand: string, arabic: boolean): Slots {
  const s = rec(v);
  const ar = rec(s.ar);
  // An ISO code exactly ("dirhams" is not "DIR").
  const currency = clip(s.currency, 10).toUpperCase();
  return {
    brand: clip(s.brand, 40) || brand || "Lumen",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : arabic ? "AED" : "USD",
    city: clip(s.city, 30) || (arabic ? "Dubai" : "London"),
    people: list(s.people, 3, 30),
    places: list(s.places, 3, 30),
    ...(Object.keys(ar).length ? { ar: { brand: clip(ar.brand, 40), city: clip(ar.city, 30), people: list(ar.people, 3, 30) } } : {}),
  };
}

/** The read-back, with only the designer's real words as evidence. `answers` must include the follow-ups. */
export function sanitizeRead(raw: unknown, answers: BriefAnswer[], round: 0 | 1, ids: { name?: string; color?: string } = { name: "name", color: "color" }): { read: ReadBack; followUps: FollowUp[] } {
  const r = rec(raw);
  const said = norm(answers.map((a) => a.answer).join(" \n "));
  const allText = answers.map((a) => a.answer).join(" ");
  const axesIn = rec(r.axes);
  const axes = Object.fromEntries(
    AXES.map((a) => {
      const x = rec(axesIn[a]);
      const evidence = list(x.evidence, 2, 200).filter((q) => q.length >= 3 && said.includes(norm(q)));
      const confidence = clamp01(x.confidence, 0.3);
      return [a, { value: clamp01(x.value), confidence: evidence.length ? confidence : Math.min(confidence, 0.35), evidence }];
    }),
  ) as Record<AxisId, ReadBack["axes"][AxisId]>;
  const scriptsIn = Array.isArray(r.scripts) ? r.scripts : [];
  const arabic = scriptsIn.includes("arabic") || ARABIC_CHARS.test(allText) || /\barabic\b|عربي/i.test(allText);
  const name = answers.find((a) => a.id === ids.name)?.answer ?? "";
  const lang = rec(r.language);
  const followUps: FollowUp[] =
    round === 1
      ? []
      : (Array.isArray(r.followUps) ? r.followUps : [])
          .map((f, i) => {
            const o = rec(f);
            return { id: clip(o.id, 30).replace(/[^a-z0-9-]/gi, "").toLowerCase() || `follow-${i + 1}`, question: clip(o.question, 140), why: clip(o.why, 160), options: list(o.options, 4, 60) };
          })
          .filter((f) => f.question)
          .slice(0, 3);
  const domain = DOMAINS.includes(r.domain as Domain) ? (r.domain as Domain) : "other";
  const read: ReadBack = {
    summary: clip(r.summary, 600),
    adjectives: list(r.adjectives, 5, 24),
    domain,
    audience: clip(r.audience, 120),
    platform: isPlatform(r.platform) ? r.platform : inferPlatform(allText),
    scripts: arabic ? ["latin", "arabic"] : ["latin"],
    brandHex: brandHexFrom(answers.find((a) => a.id === ids.color)?.answer ?? ""),
    axes,
    admired: list(r.admired, 6, 40),
    avoided: list(r.avoided, 6, 60),
    language: {
      principles: (Array.isArray(lang.principles) ? lang.principles : [])
        .map((p) => ({ title: clip(rec(p).title, 40), body: clip(rec(p).body, 200) }))
        .filter((p) => p.title && p.body)
        .slice(0, 3),
      voice: clip(lang.voice, 200),
      dos: list(lang.dos, 4, 120),
      donts: list(lang.donts, 4, 120),
    },
    slots: slotsFrom(r.slots, clip(name, 40), arabic),
  };
  return { read, followUps };
}

// ---------------------------------------------------------------------------
// Knobs

const ENUM_KNOBS = KNOB_IDS.filter((k) => KNOB_SPECS[k].options.length) as KnobId[];

/** A knob value from the model, or the fallback when it isn't one of the options. */
function knobValue(id: KnobId, v: unknown, fallback: Knobs, candidates: readonly string[]): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (id === "font") return candidates.includes(s) ? s : candidates.includes(fallback.font) ? fallback.font : (candidates[0] ?? fallback.font);
  if (id === "displayFont") return s === "same" || (FONT_BY_NAME.has(s) && !FONT_BY_NAME.get(s)!.arabicFace) ? s : fallback.displayFont;
  if (id === "arabicFont") return (ARABIC_FONTS as readonly string[]).includes(s) ? s : fallback.arabicFont;
  return KNOB_SPECS[id].options.includes(s) ? s : (fallback[id] as string);
}

/** Knobs from the model: each one of its options (fonts from `candidates`), the brand colour only ever the designer's. */
export function knobsFrom(raw: unknown, base: Knobs, read: Pick<ReadBack, "brandHex">, candidates: readonly string[]): Knobs {
  const r = rec(raw);
  const k: Knobs = { ...base };
  for (const id of [...ENUM_KNOBS, "font", "displayFont", "arabicFont"] as KnobId[]) (k as unknown as Record<string, unknown>)[id] = knobValue(id, r[id], base, candidates);
  if (k.displayFont === k.font) k.displayFont = "same";
  const brand = read.brandHex;
  const h = Number(r.hue);
  k.brandHex = brand;
  k.hue = brand ? Math.round(hueOf(brand) ?? base.hue) : Number.isFinite(h) ? Math.round(((h % 360) + 360) % 360) : base.hue;
  return k;
}

/** Exactly three distinct directions; the one closest to the code's baseline is recommended. */
export function sanitizeDirections(raw: unknown, ctx: { read: ReadBack; baseline: Knobs; candidates: readonly string[] }): { directions: Direction[]; recommended: number } {
  const r = rec(raw);
  const out: Direction[] = [];
  const seen = new Set<string>();
  for (const d of Array.isArray(r.directions) ? r.directions : []) {
    const o = rec(d);
    const knobs = knobsFrom(o.knobs, ctx.baseline, ctx.read, ctx.candidates);
    const hash = knobHash(knobs);
    if (seen.has(hash) || out.length === 3) continue;
    seen.add(hash);
    const quote = clip(o.quote, 120);
    out.push({
      name: clip(o.name, 40) || `Direction ${out.length + 1}`,
      rationale: [clip(o.rationale, 220), quote ? `“${quote}”` : ""].filter(Boolean).join(" "),
      knobs,
      source: "ai",
      ...(ctx.read.brandHex ? {} : { hueReason: clip(o.hueReason, 160) }),
    });
  }
  for (const d of codeDirections(ctx.read)) {
    if (out.length === 3) break;
    if (seen.has(knobHash(d.knobs))) continue;
    seen.add(knobHash(d.knobs));
    out.push(d);
  }
  const recommended = out.reduce((best, d, i) => (knobDistance(d.knobs, ctx.baseline) < knobDistance(out[best].knobs, ctx.baseline) ? i : best), 0);
  return { directions: out, recommended };
}

export interface KnobDelta {
  knob: KnobId;
  from: string;
  to: string;
  reason: string;
}

/**
 * A nudge or review's changes, bounded: at most 3, never a locked knob, ordinal knobs one step
 * toward what was asked, fonts only from the candidates, the hue turned at most 30° (never when
 * the designer gave a brand colour).
 */
export function sanitizeDeltas(raw: unknown, ctx: { knobs: Knobs; locks: readonly KnobId[]; candidates: readonly string[] }): { knobs: Knobs; applied: KnobDelta[] } {
  const r = rec(raw);
  let k: Knobs = { ...ctx.knobs };
  const applied: KnobDelta[] = [];
  for (const d of (Array.isArray(r.deltas) ? r.deltas : []).slice(0, 3)) {
    const o = rec(d);
    const id = o.knob as KnobId;
    if (!KNOB_IDS.includes(id) || id === "hue" || ctx.locks.includes(id) || applied.some((a) => a.knob === id)) continue;
    const spec = KNOB_SPECS[id];
    const want = typeof o.to === "string" ? o.to.trim() : "";
    const from = String(k[id]);
    let to = from;
    if (spec.ordinal) {
      const i = spec.options.indexOf(from);
      const j = spec.options.indexOf(want);
      if (j >= 0 && i >= 0 && j !== i) to = spec.options[i + Math.sign(j - i)];
    } else if (spec.options.length) {
      if (spec.options.includes(want)) to = want;
    } else to = knobValue(id, want, k, ctx.candidates);
    if (to === from) continue;
    k = { ...k, [id]: to };
    applied.push({ knob: id, from, to, reason: clip(o.reason, 120) });
  }
  const shift = Number(r.hueShift);
  if (!k.brandHex && !ctx.locks.includes("hue") && Number.isFinite(shift) && Math.abs(shift) >= 1) {
    const turn = Math.round(Math.max(-30, Math.min(30, shift)));
    const from = k.hue;
    k = { ...k, hue: (((from + turn) % 360) + 360) % 360 };
    applied.push({ knob: "hue", from: String(from), to: String(k.hue), reason: turn > 0 ? "warmer hue" : "cooler hue" });
  }
  return { knobs: k, applied };
}

export interface NudgeResult {
  reply: string;
  knobs: Knobs;
  applied: KnobDelta[];
}

export function sanitizeNudge(raw: unknown, ctx: { knobs: Knobs; locks: readonly KnobId[]; candidates: readonly string[] }): NudgeResult {
  const { knobs, applied } = sanitizeDeltas(raw, ctx);
  return { reply: clip(rec(raw).reply, 240) || (applied.length ? "Done." : "Nothing needed to change."), knobs, applied };
}

export type Verdict = "reads" | "partly" | "missing";
export interface ReviewResult extends NudgeResult {
  summary: string;
  checks: { adjective: string; verdict: Verdict; observation: string }[];
}

/** A review: one check per brief adjective (unjudged ones count as "partly"), plus bounded changes. */
export function sanitizeReview(raw: unknown, ctx: { read: ReadBack; knobs: Knobs; locks: readonly KnobId[]; candidates: readonly string[] }): ReviewResult {
  const r = rec(raw);
  const given = (Array.isArray(r.checks) ? r.checks : []).map(rec);
  const checks = ctx.read.adjectives.map((adjective) => {
    const c = given.find((x) => norm(clip(x.adjective, 40)) === norm(adjective));
    const verdict = (["reads", "partly", "missing"] as const).includes(c?.verdict as Verdict) ? (c!.verdict as Verdict) : "partly";
    return { adjective, verdict, observation: clip(c?.observation, 200) };
  });
  const { knobs, applied } = sanitizeDeltas(raw, ctx);
  return { summary: clip(r.summary, 400), checks, reply: clip(r.summary, 240), knobs, applied };
}
