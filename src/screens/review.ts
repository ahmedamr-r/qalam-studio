import { normalizeForMatch, quoteFinder } from "@/discovery/quotes";
import { withoutIds } from "@/goals/said";
import type { SeenText } from "@/seen/types";
import { boxOf, noteLine, onScreen, personal, textOf } from "@/seen/words";
import { CHANGE_DOES, FINDING_SIDES, REVIEW_LIMITS, type ChangeDoes, type FindingRest, type FindingSide, type ScreenFinding } from "./types";

/*
 * Looking at someone's screenshots for the problem they're working out (pure; the call is
 * src/ai/screens.ts, the core server/org/screens.ts). Qalam AI proposes what on them bears on the
 * problem, from the customer's side and the business's, ranked, one change each; code keeps:
 * - a finding on a screen it was shown, its words and numbers printed on the screens or said by them;
 * - its mark only where the words it points at are printed there;
 * - from the business's side, only resting on how their business works, a goal or what they said;
 * - a change that adds to a screen only naming what it replaces or takes away there (swap, don't add),
 *   and no two changes taking away the same thing.
 * Off a Mac nothing printed can be checked: findings are kept as descriptions, with no marks.
 */

/** A screenshot as the call is shown it. */
export interface ReviewScreen {
  /** As the call names it: s1, s2… */
  id: string;
  /** The asset's bare hash. */
  shot: string;
  name: string;
  /** The screen it's kept as in the map. */
  screen?: string;
  /** What this computer read off it (none off a Mac, or when it couldn't). */
  read: SeenText | null;
}

/** What it's looked at for. */
export interface ReviewFocus {
  /** What they're working out, in their words (how the conversation started). */
  said: string;
  /** The question the screenshots answered, and what they typed with them. */
  asked?: string;
  typed?: string;
  /** What's settled so far, in Qalam AI's words, held to their answers. */
  settled: readonly string[];
}

export interface ReviewInput {
  screens: readonly ReviewScreen[];
  focus: ReviewFocus;
  flow?: string;
  /** How their business works, a line each. */
  business: readonly string[];
  /** The goals in play, a line each. */
  goals: readonly string[];
  /** Their own answers so far. */
  answers: readonly { q: string; a: string }[];
}

const one = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
/** Off a Mac nothing is claimed as printed: a description, its quote marks taken off. */
const unquoted = (s: string) => s.replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();

/** Words cut to fit at a word's end, never leaving a quote open: a quote cut off goes from where it opened. */
export function fit(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  cut = cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : cut.length);
  for (const [open, close] of [["“", "”"], ["‘", "’"]] as const) {
    const at = cut.lastIndexOf(open);
    if (at >= 0 && at > cut.lastIndexOf(close)) cut = cut.slice(0, at);
  }
  if ((cut.match(/"/g) ?? []).length % 2) cut = cut.slice(0, cut.lastIndexOf('"'));
  return `${cut.trimEnd().replace(/[,;:(]$/, "").trimEnd()}…`;
}
const FIGURES = /[\d٠-٩۰-۹][\d٠-٩۰-۹.,]*/g;

/** The material's text parts, what each id stands for, and the words a finding may quote besides the screens. */
export function reviewMaterial(i: ReviewInput): { intro: string; screens: { id: string; head: string; words: string }[]; sent: Map<string, FindingRest>; also: string } {
  const sent = new Map<string, FindingRest>();
  const out: string[] = ["What they're working out (only what bears on this counts):", `“${clip(one(i.focus.said), 1500)}”`];
  if (i.focus.asked) out.push(`The question these screenshots answer: “${clip(one(i.focus.asked), 300)}”`);
  if (one(i.focus.typed)) out.push(`What they said with them: “${clip(one(i.focus.typed), 600)}”`);
  if (i.focus.settled.length) out.push("", "Settled so far:", ...i.focus.settled.slice(0, 12).map((s) => `- ${clip(one(s), 300)}`));
  const listed = (head: string, prefix: string, kind: FindingRest["kind"], lines: readonly string[]) => {
    if (!lines.length) return;
    out.push("", head);
    lines.forEach((l, n) => {
      const id = `${prefix}${n + 1}`;
      sent.set(id, { kind, text: clip(one(l), 300) });
      out.push(`- ${id} · ${clip(one(l), 300)}`);
    });
  };
  listed("How their business works (a business finding rests on one of these, a goal or an answer):", "b", "business", i.business.slice(0, 30));
  listed("Their goals:", "g", "goal", i.goals.slice(0, 12));
  listed("Their answers so far:", "a", "answer", i.answers.slice(0, 20).map((x) => `${one(x.q)} → “${one(x.a)}”`));
  if (!i.business.length) out.push("", "Nothing is written down yet about how their business works: a business finding rests on a goal or what they said.");
  out.push("", i.flow ? `The screens, in the order they showed them (the “${one(i.flow)}” flow):` : "The screens, in the order they showed them:");
  const screens = i.screens.map((s, n) => ({
    id: s.id,
    head: `${s.id} · “${clip(one(s.name), 80)}”, screen ${n + 1} of ${i.screens.length}:`,
    words: s.read ? (s.read.lines.length ? `Printed on ${s.id}, as this computer read it, line by line:\n${s.read.lines.map((l) => l.text).join("\n")}` : `Nothing printed on ${s.id} could be read.`) : `What's printed on ${s.id} couldn't be read here: describe what you see, and quote nothing from it.`,
  }));
  const also = [i.focus.said, i.focus.typed ?? "", ...i.answers.map((x) => x.a), ...i.business, ...i.goals].filter(Boolean).join("\n");
  return { intro: out.join("\n"), screens, sent, also };
}

/** A finding's key: the screenshot it's on and what it says, so the same one is told apart from a new one. */
export const findingKey = (shot: string, title: string) => `${shot}:${normalizeForMatch(title).norm.replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 120)}`;

const DOES_ACTS_ON: Record<ChangeDoes, "replaces" | "acts"> = { add: "replaces", replace: "replaces", remove: "acts", reword: "acts", move: "acts" };

/** What code keeps of Qalam AI's look at the screens, in its order (what costs the problem most first). */
export function sanitizeScreenReview(raw: unknown, c: { screens: readonly ReviewScreen[]; sent: ReadonlyMap<string, FindingRest>; also: string }): { findings: ScreenFinding[]; none: boolean; left: { what: string; why: string }[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const left: { what: string; why: string }[] = [];
  const findings: ScreenFinding[] = [];
  const texts = c.screens.map((s) => s.read ?? undefined);
  const readable = c.screens.some((s) => s.read);
  const taken = new Set<string>();
  const perScreen = new Map<string, number>();
  const keys = new Set<string>();
  // People never see the call's ids: a screen's becomes its name, any other goes.
  const named = (v: unknown) => withoutIds(one(v), (ref) => c.screens.find((x) => x.id === ref)?.name, "sbga");
  /** Its words as code keeps them: with what's printed to check against, quoted words and numbers printed or said; without, a description with its quote marks off. */
  const words = (v: unknown, max: number): string | null => {
    const text = fit(named(v), max);
    if (!text || personal(text)) return null;
    return readable ? noteLine(text, texts, c.also, max + 1) : unquoted(text);
  };
  /**
   * A change's words: printed words it quotes stay in “…”; quoted words that aren't printed are wording it
   * proposes, in ‘…’, as a draft's are. Numbers, proposed or not, only as printed or said.
   */
  const changeWords = (v: unknown, max: number): string | null => {
    const text = fit(named(v), max);
    if (!text || personal(text)) return null;
    if (!readable) return unquoted(text);
    const hay = [...texts.map(textOf), c.also].filter(Boolean).map((h) => quoteFinder(h));
    const printed = (w: string) => hay.some((f) => f(w, Math.min(8, w.length)));
    const proposed = text.replace(/[“"]([^”"]+)[”"]/g, (_m, w: string) => (printed(w.trim()) ? `“${w.trim()}”` : `‘${w.trim()}’`));
    const checked = proposed.replace(/‘([^’]+)’/g, (_, w: string) => ` ${(w.match(FIGURES) ?? []).join(" ")} `);
    return noteLine(checked, texts, c.also, max + 40) ? proposed : null;
  };
  for (const item of Array.isArray(r.findings) ? r.findings : []) {
    const f = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const title0 = one(f.title).slice(0, REVIEW_LIMITS.title);
    const what = title0 || "A finding";
    const s = c.screens.find((x) => x.id === one(f.screen));
    if (!s) {
      left.push({ what, why: "It names a screen it wasn't shown" });
      continue;
    }
    const side = FINDING_SIDES.find((x) => x === f.side);
    if (!side) {
      left.push({ what, why: "It doesn't say whose side it's from" });
      continue;
    }
    const title = words(f.title, REVIEW_LIMITS.title);
    const why = words(f.why, REVIEW_LIMITS.why);
    if (!title || !why) {
      left.push({ what, why: "Its quoted words or numbers aren't printed on the screens or in what they said" });
      continue;
    }
    const rests = (Array.isArray(f.cites) ? f.cites : []).map(one).flatMap((id) => (c.sent.has(id) ? [c.sent.get(id)!] : []));
    if (side === "business" && !rests.length) {
      left.push({ what, why: "A finding from the business's side has to rest on how their business works, a goal or what they said" });
      continue;
    }
    const key = findingKey(s.shot, title);
    if (keys.has(key)) {
      left.push({ what, why: "It says what a finding above it says" });
      continue;
    }
    if ((perScreen.get(s.id) ?? 0) >= REVIEW_LIMITS.perScreen || findings.length >= REVIEW_LIMITS.all) {
      left.push({ what, why: "Past the most one look keeps" });
      continue;
    }
    // Where it is: only where the words it points at are printed on that screen.
    const onWords = s.read && one(f.on) ? onScreen(one(f.on), s.read, REVIEW_LIMITS.on) : null;
    const box = onWords ? boxOf(onWords, s.read ?? undefined) : null;
    const change = changeOf(f.change, s, { onWords, words: changeWords, taken, what, left });
    keys.add(key);
    perScreen.set(s.id, (perScreen.get(s.id) ?? 0) + 1);
    findings.push({ key, shot: s.shot, ...(s.screen ? { screen: s.screen } : {}), name: s.name, side: side as FindingSide, title, why, ...(onWords && box ? { on: { words: onWords, box } } : {}), ...(change ? { change } : {}), ...(rests.length ? { rests } : {}) });
  }
  return { findings, none: !findings.length && r.none === true, left };
}

/**
 * A finding's change as code keeps it, or none. Swap, don't add: one that puts something on a screen names
 * what it replaces or takes away there; one that takes away, rewords or moves acts on something printed
 * there; and what one change takes away, a lower one can't take away again.
 */
function changeOf(raw: unknown, s: ReviewScreen, o: { onWords: string | null; words: (v: unknown, max: number) => string | null; taken: Set<string>; what: string; left: { what: string; why: string }[] }): ScreenFinding["change"] | undefined {
  const x = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const does = CHANGE_DOES.find((d) => d === x.does);
  if (!does) return undefined;
  const what = o.words(x.what, REVIEW_LIMITS.what);
  if (!what) return void o.left.push({ what: `${o.what}: its change`, why: "Its quoted words or numbers aren't printed on the screens or in what they said" });
  const named = one(x.instead_of);
  // What it takes away or acts on, as the screen prints it; off a Mac, as they named it (nothing can be checked).
  const insteadOf = named ? (s.read ? onScreen(named, s.read, REVIEW_LIMITS.on) : named.replace(/[“”"]/g, "").trim()) : null;
  const actsOn = insteadOf ?? (DOES_ACTS_ON[does] === "acts" ? o.onWords : null);
  if (DOES_ACTS_ON[does] === "replaces" && !insteadOf) return void o.left.push({ what: `${o.what}: its change`, why: named ? "What it would replace isn't printed on that screen" : "It adds to the screen without taking anything away" });
  if (DOES_ACTS_ON[does] === "acts" && !actsOn) return void o.left.push({ what: `${o.what}: its change`, why: s.read ? "What it changes isn't printed on that screen" : "It doesn't say what on the screen it changes" });
  const takenKey = `${s.id}:${normalizeForMatch(actsOn!).norm}`;
  if (o.taken.has(takenKey)) return void o.left.push({ what: `${o.what}: its change`, why: "A change above it already changes that" });
  o.taken.add(takenKey);
  return { does, what, ...(insteadOf ? { insteadOf } : {}) };
}
