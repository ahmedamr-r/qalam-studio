import { findQuote } from "@/discovery/quotes";
import { metricLine } from "@/goals/goals-md";
import type { Goal } from "@/goals/types";
import { STEP_KEY, stepRef, type MapFlow, type MapStep } from "./map";

/*
 * What sits at each step of a goal's funnel (pure): the problems a person pins there, what
 * customers said about the step, and a picture of its screen. Qalam AI places quotes at steps;
 * code keeps one only when the words it points to are in the quote, word for word, and name the
 * step's own thing (its title, its screen's file, its events). A picture is always a person's: a
 * screenshot or a design's frame, never drawn by Qalam AI. A card is at a step through the problem
 * it came from. hub/steps.jsonl holds a line per change, never rewritten, so two people's merge in
 * Git; a pin a person took off never comes back from Qalam AI.
 */

export type PinWhat = "need" | "quote" | "picture";

export interface StepPin {
  /** The step, as `stepRef` names it: "<map key>/<step key>". */
  step: string;
  what: PinWhat;
  /** The need page's id, the quote's piece (hub:quote:<id>), or the picture (asset:<hash>). */
  id: string;
  /** A quote's words that put it at the step, as the quote has them. */
  words?: string;
  by: "you" | "qalam";
  at: number;
}

/** A line of hub/steps.jsonl: a pin made, or taken off. */
export type StepPinLog = StepPin & { removed?: boolean };

/** A step holds one picture: the newest. Anything else is pinned once per step. */
export const pinKey = (p: Pick<StepPin, "step" | "what" | "id">) => (p.what === "picture" ? `picture|${p.step}` : `${p.what}|${p.step}|${p.id}`);

/** The pins as they are now, and the ones a person took off (Qalam AI never pins those again). */
export function foldPins(log: StepPinLog[]): { pins: StepPin[]; refused: Set<string> } {
  const pins = new Map<string, StepPin>();
  const refused = new Set<string>();
  for (const e of [...log].sort((a, b) => a.at - b.at)) {
    if (!pinShape(e)) continue;
    const key = pinKey(e);
    const pin: StepPin = { step: e.step, what: e.what, id: e.id, ...(e.words ? { words: e.words } : {}), by: e.by, at: e.at };
    if (e.by === "you") {
      if (e.removed) {
        refused.add(key);
        pins.delete(key);
      } else {
        refused.delete(key);
        pins.set(key, pin);
      }
      continue;
    }
    if (refused.has(key) || pins.get(key)?.by === "you") continue;
    if (e.removed) pins.delete(key);
    else pins.set(key, pin);
  }
  return { pins: [...pins.values()], refused };
}

const ID = /^[A-Za-z0-9_~-]{1,64}$/;
const MAP_KEY = /^[A-Za-z0-9_.-]{1,140}$/;
const PIN_ID: Record<PinWhat, RegExp> = { need: ID, quote: /^hub:quote:[A-Za-z0-9_~-]{1,64}$/, picture: /^asset:[0-9a-f]{24}$/ };

/** A step's ref as a pin may name it. */
export function isStepRef(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const at = v.lastIndexOf("/");
  return at > 0 && MAP_KEY.test(v.slice(0, at)) && !v.startsWith(".") && STEP_KEY.test(v.slice(at + 1));
}

/** A log line as code takes one (from the file, or a person's request), or null. */
export function pinShape(raw: unknown): StepPinLog | null {
  const p = raw as Partial<StepPinLog> | null;
  if (!p || !isStepRef(p.step) || !p.what || !Object.hasOwn(PIN_ID, p.what) || typeof p.id !== "string" || !PIN_ID[p.what].test(p.id)) return null;
  if ((p.by !== "you" && p.by !== "qalam") || typeof p.at !== "number" || !Number.isFinite(p.at)) return null;
  if (p.words !== undefined && (typeof p.words !== "string" || p.words.length > STEP_LIMITS.words)) return null;
  return { step: p.step, what: p.what, id: p.id, ...(p.words ? { words: p.words } : {}), by: p.by, at: p.at, ...(p.removed ? { removed: true } : {}) };
}

/** What a goal's page shows at its funnel's steps. */
export interface StepView {
  pins: StepPin[];
  /** The words of each quote pinned at a step, by its piece. */
  quotes: Record<string, { text: string; who?: string }>;
}

/** The pins at a funnel's steps, by step ref. */
export function pinsOf(pins: StepPin[], map: string, flow: MapFlow): Map<string, StepPin[]> {
  const out = new Map(flow.steps.map((s) => [stepRef(map, s.key), [] as StepPin[]]));
  for (const p of pins) out.get(p.step)?.push(p);
  return out;
}

// ---------------------------------------------------------------------------
// Whether a quote's words are about a step: they name its own thing

/** Words that say nothing about which step: the little ones, and the screen's and the tap's. */
const STOP = new Set(
  "the and for with from into onto that this these those their there they them you your yours our ours its it's not but are was were has have had can could would will just then than when what which who why how all any each every some more most very also only even still again here off out over under about after before back down get gets got going goes see sees saw seen open opens opened tap taps tapped click clicks clicked press pick picks picked choose chooses chose enter enters entered start starts started view views screen screens page pages step steps flow user users customer customers app apps index main layout component container tsx jsx swift dart java kotlin activity fragment".split(
    " ",
  ),
);
const SUFFIXES = ["ations", "ation", "ments", "ment", "tions", "tion", "ings", "ing", "ers", "er", "ed", "s"];

const wordsOf = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));

function stem(w: string): string {
  if (w.endsWith("ies") && w.length > 5) return `${w.slice(0, -3)}y`;
  for (const s of SUFFIXES) if (w.length - s.length >= 3 && w.endsWith(s)) return w.slice(0, -s.length);
  return w;
}

/** A step's own words, stemmed: its title's, its screen file's name's, its events'. */
export function stepTerms(s: Pick<MapStep, "title" | "file" | "events">): string[] {
  const file = s.file.split("/").pop()!.replace(/\.[^.]+$/, "");
  return [...new Set([...wordsOf(s.title), ...wordsOf(file), ...s.events.flatMap(wordsOf)].map(stem))];
}

/** Whether words name a step's own thing: one of its words, or one sharing its first four letters or more. */
export function namesStep(words: string, s: Pick<MapStep, "title" | "file" | "events">): boolean {
  const terms = stepTerms(s);
  return wordsOf(words)
    .map(stem)
    .some((w) => terms.some((t) => t === w || (Math.min(t.length, w.length) >= 4 && (t.startsWith(w) || w.startsWith(t)))));
}

// ---------------------------------------------------------------------------
// What the call is sent, and its answer as code keeps it

export const STEP_LIMITS = { quotes: 60, places: 24, words: 200 } as const;

export interface StepQuote {
  /** Its piece: hub:quote:<id>. */
  ref: string;
  text: string;
  /** Who said it and where, in a few words. */
  who?: string;
}

export interface StepSent {
  text: string;
  /** Steps as the call names them (s1…). */
  steps: Map<string, { ref: string; step: MapStep }>;
  /** Quotes as the call names them (q1…). */
  quotes: Map<string, StepQuote>;
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();

/** The material: the goal and its number, the funnel's steps in order, and what customers said. */
export function stepMaterial(o: { goal: Goal; map: string; flow: MapFlow; quotes: StepQuote[] }): StepSent {
  const steps = new Map<string, { ref: string; step: MapStep }>();
  const quotes = new Map<string, StepQuote>();
  const g = o.goal;
  const out = [`The goal: ${one(g.title)}${g.metric ? ` · ${g.metric.name ? `${g.metric.name}: ` : ""}${metricLine(g.metric)}` : ""}`, "", `The funnel toward it, ${one(o.flow.name)}: its steps in order (id · step · the screen's file · events it sends):`];
  for (const s of o.flow.steps) {
    const id = `s${steps.size + 1}`;
    steps.set(id, { ref: stepRef(o.map, s.key), step: s });
    out.push(`- ${id} · ${one(s.title)} · ${s.file} · ${s.events.join(", ") || "no event"}`);
  }
  out.push("", "What customers said:");
  for (const q of o.quotes.slice(0, STEP_LIMITS.quotes)) {
    const id = `q${quotes.size + 1}`;
    quotes.set(id, q);
    out.push(`<quote id="${id}"${q.who ? ` who="${one(q.who).replace(/"/g, "'")}"` : ""}>${one(q.text)}</quote>`);
  }
  if (!quotes.size) out.push("(no quotes)");
  return { text: out.join("\n"), steps, quotes };
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * What code keeps of the answer: one step per quote, its words found in the quote word for word and
 * naming the step's own thing, never a pin a person took off. `dropped` hears each left out and why.
 */
export function sanitizeSteps(raw: unknown, m: StepSent, o: { now: number; refused: ReadonlySet<string> }, dropped?: (why: string, item: unknown) => void): StepPin[] {
  const out: StepPin[] = [];
  const drop = (why: string, x: unknown) => void dropped?.(why, x);
  for (const x of Array.isArray(rec(raw).places) ? (rec(raw).places as unknown[]) : []) {
    if (out.length >= STEP_LIMITS.places) {
      drop("over the limit", x);
      continue;
    }
    const p = rec(x);
    const s = typeof p.step === "string" ? m.steps.get(p.step.trim()) : undefined;
    const q = typeof p.quote === "string" ? m.quotes.get(p.quote.trim()) : undefined;
    if (!s || !q) {
      drop(!s ? "a step not sent" : "a quote not sent", x);
      continue;
    }
    const pin = { step: s.ref, what: "quote" as const, id: q.ref };
    if (o.refused.has(pinKey(pin)) || out.some((y) => y.id === q.ref)) {
      drop("taken off by a person, or placed twice", x);
      continue;
    }
    const words = typeof p.words === "string" ? findQuote(q.text, p.words.slice(0, 400))?.words : undefined;
    if (!words || words.length < 8) {
      drop("its words aren't in the quote", x);
      continue;
    }
    if (!namesStep(words, s.step)) {
      drop("its words don't name the step", x);
      continue;
    }
    out.push({ ...pin, words: one(words).slice(0, STEP_LIMITS.words), by: "qalam", at: o.now });
  }
  return out;
}
