import type { PlanQuestion } from "@/ai/plan";
import { valuesIn } from "@/hub/topics";
import type { ScanTarget } from "./session";

/*
 * Questions while a scan reads (pure; server/org/scan.ts hears the answers). The wait is when someone
 * can still turn it, and nothing waits on them: the scan goes on unanswered, and a late answer only
 * reaches what hasn't been read yet. What they say says where to look first, never what to find.
 */

export interface ScanSaid {
  question: string;
  answer: string;
}

export interface ScanSteer {
  /** What they said, in their words. */
  said: ScanSaid[];
  /** What it found that they took off, as it was listed: not what they meant. */
  off: string[];
}

export const STEER_LIMITS = { said: 8, question: 300, answer: 1000, off: 12, name: 200, who: 4, label: 60, understood: 200 } as const;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const one = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (v: unknown, max: number) => (typeof v === "string" ? one(v).slice(0, max) : "");
const low = (s: string) => one(s).toLowerCase();

/** What's sent from the window, kept to what it should be. */
export function steerOf(raw: unknown): ScanSteer {
  const r = rec(raw);
  const said = list(r.said)
    .map((x) => ({ question: clip(rec(x).question, STEER_LIMITS.question), answer: clip(rec(x).answer, STEER_LIMITS.answer) }))
    .filter((x) => x.question && x.answer)
    .slice(0, STEER_LIMITS.said);
  const off = list(r.off)
    .map((x) => clip(x, STEER_LIMITS.name))
    .filter(Boolean)
    .slice(0, STEER_LIMITS.off);
  return { said, off };
}

/** More of it: the same question answered again takes the newer answer. */
export function withSteer(s: ScanSteer | undefined, more: ScanSteer): ScanSteer {
  const said = [...(s?.said ?? []).filter((x) => !more.said.some((m) => low(m.question) === low(x.question))), ...more.said].slice(-STEER_LIMITS.said);
  const off = [...new Set([...(s?.off ?? []), ...more.off])].slice(0, STEER_LIMITS.off);
  return { said, off };
}

export const isOff = (s: ScanSteer | undefined, name: string) => !!s?.off.some((o) => low(o) === low(name));

/** What they said, for a task or a reader. */
export const toldLines = (s: ScanSteer | undefined) => (s?.said ?? []).map((x) => `- ${x.question} ${x.answer}`).join("\n");

/**
 * What the reader and the filing hear: where to look first, without narrowing what counts. "Pick out
 * only what bears on that" holds for what's being looked into, so what they said can't be part of it:
 * someone they haven't thought of, or a quote against them, is what they most need to see.
 */
export function focusWith(focus: string, s: ScanSteer | undefined): string {
  const told = toldLines(s);
  return told ? `${focus}\n\nWhat they've said so far:\n${told}\nThat says where to look first, never what to find. Keep what points elsewhere and what speaks against it just the same: someone they haven't thought of is worth more to them than one more quote that agrees.` : focus;
}

const whatItIs = (t: ScanTarget) => (t.kind === "idea" ? one(t.said) : one(t.name));

/** The question that says back how it read them. */
function meantQuestion(t: ScanTarget, understood: string): PlanQuestion {
  const said = understood || (t.kind === "idea" ? `You want to build: ${whatItIs(t)}.` : `You want to know what people say about ${whatItIs(t) || "this product"}.`);
  return { id: "meant", title: `${said} Right?`, why: "So I look in the right place.", multi: false, options: [{ value: "yes", label: "Yes, that's it", description: "" }], recommended: ["yes"], allowOther: true };
}

const whoQuestion = (options: readonly string[]): PlanQuestion => ({ id: "who", title: "Who do you picture using this first?", why: "I'll look at them first, and keep what others say too.", multi: false, options: options.map((label, i) => ({ value: `who${i + 1}`, label, description: "" })), recommended: [], allowOther: options.length > 0 });

const seenQuestion: PlanQuestion = { id: "seen", title: "Anything you've seen yourself that I should look for?", why: "What you've seen shows me where to look.", multi: false, options: [], recommended: [], allowOther: false };

/** Code's own, asked at once when Qalam AI's can't be had. Open, and every one can be skipped. */
export const steerRound = (t: ScanTarget): PlanQuestion[] => [meantQuestion(t, ""), ...(t.kind === "idea" ? [whoQuestion([])] : []), seenQuestion];

const WORD = /[\p{L}\p{N}]{4,}/gu;

/**
 * What code keeps of what Qalam AI worked out from their words alone, with nothing read yet: how it
 * took them, only with a word of theirs in it and no number they didn't say; and kinds of people to
 * pick from, which a person decides, so never a number or a claim about them.
 */
export function sanitizeSteer(raw: unknown, t: ScanTarget): PlanQuestion[] {
  const r = rec(raw);
  const said = whatItIs(t);
  const words = new Set((low(said).match(WORD) ?? []).map((w) => w.slice(0, 4)));
  // Its first sentence, whole: a sentence cut off mid-word can't be said yes to.
  const first = typeof r.understood === "string" ? (one(r.understood).match(/^.+?[.!?](?=\s|$)/)?.[0] ?? one(r.understood)) : "";
  let understood = first.length <= STEER_LIMITS.understood ? first : "";
  const shares = (low(understood).match(WORD) ?? []).some((w) => words.has(w.slice(0, 4)));
  if (!shares || valuesIn(understood).some((v) => !valuesIn(said).includes(v))) understood = "";
  if (understood && !/[.!?]$/.test(understood)) understood += ".";
  const who = [...new Set(list(r.who).map((x) => clip(x, STEER_LIMITS.label)))].filter((x) => x && !/\p{Nd}/u.test(x)).slice(0, STEER_LIMITS.who);
  return [meantQuestion(t, understood), ...(t.kind === "idea" ? [whoQuestion(who)] : []), seenQuestion];
}

/** Their answers as what the scan hears. "Yes, that's it" is worth saying: how it took them is then what they mean. */
export function steerAnswers(questions: readonly PlanQuestion[], answers: Readonly<Record<string, string>>): ScanSaid[] {
  return questions.flatMap((q) => {
    const answer = (answers[q.id] ?? "").trim();
    if (!answer) return [];
    if (q.id !== "meant") return [{ question: q.title, answer }];
    const meant = q.title.replace(/ Right\?$/, "");
    return answer === "Yes, that's it" ? [{ question: "What they mean:", answer: meant }] : [{ question: "What they mean, in their words:", answer }];
  });
}

/** The questions left to ask once it's read: what they've answered isn't asked again. */
export function notAsked(questions: readonly PlanQuestion[], said: readonly ScanSaid[]): PlanQuestion[] {
  const asked = new Set(said.map((x) => low(x.question)));
  return questions.filter((q) => !asked.has(low(q.title)));
}
