import type { PlanQuestion } from "@/ai/plan";
import type { Fact, Persona } from "./types";

/**
 * Plays a person through a round of questions, without the over-helpfulness that would hide what we're
 * looking for. Code holds the facts. A small matcher sees only their topics and says which a question
 * asks for; only those reach the voice. Nothing matched means "I don't know", in their words. Pressing
 * Enter and leaving a question empty are decided by a seeded coin before any model is asked, so they
 * cost nothing and repeat exactly.
 */

export interface Answered {
  flow: string;
  round: number;
  question: string;
  options: string[];
  /** Facts this question drew out. */
  facts: string[];
  /** Things they don't know that this question asked for. */
  unknowns: string[];
  /** enter: took what was preselected, unread. skip: left it empty. pick: left it, then pressed "Use Qalam AI's picks", which filled it with Qalam AI's recommendation, never their words. */
  how: "enter" | "skip" | "fact" | "dont-know" | "pick";
  answer: string;
  /** They chose it: false for Enter on what was preselected. */
  active: boolean;
  /** The voice wrote a number it wasn't given, so its words were replaced by the fact's. */
  rejected?: string;
}

export interface PlayerDeps {
  structured: <T>(call: any, signal?: AbortSignal) => Promise<{ data: T; model?: string }>;
}

export interface Player {
  fill(questions: PlanQuestion[], at: { flow: string; round: number }, signal?: AbortSignal): Promise<Record<string, string>>;
  /** Plain words, for a side that asks in prose: no options, so no Enter to press. */
  answer(question: string, at: { flow: string; round: number }, signal?: AbortSignal): Promise<string>;
  /** Whether they press "Use Qalam AI's picks" on this round for what they left: a passive person might. Its own coin, so Enter and skip fall as before. */
  pressesPicks(at: { flow: string; round: number }): boolean;
  /** A question they left that the press filled: Qalam AI's pick, recorded as such. */
  tookPick(question: string, at: { flow: string; round: number }, answer: string): void;
  ledger: Answered[];
  released: Set<string>;
  /** Words they had to type. */
  typed(): number;
}

const hashOf = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** mulberry32: the same seed gives the same Enters. */
export function coin(seed: string) {
  let a = hashOf(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MATCH_SYSTEM = `A person is asked a question. Below are topics they could speak about, each with an id. Say which topics the question directly asks about, at most 4: a question that asks several things can match several.

Match on what's being asked, in any language. A topic that merely relates doesn't count, and a broad question ("tell me more", "what else should I know?") matches nothing. When unsure, match nothing.`;

function matchCall(question: string, options: string[], facts: readonly Fact[], unknowns: Persona["unknowns"]) {
  const topics = [...facts.map((f) => `${f.id}: ${f.topic}`), ...unknowns.map((u) => `${u.id}: ${u.topic}`)].join("\n");
  return {
    kind: "connector" as const,
    system: MATCH_SYSTEM,
    schema: { type: "object", additionalProperties: false, properties: { ids: { type: "array", items: { type: "string" }, description: "Topic ids the question directly asks about, at most 4. [] when none" } }, required: ["ids"] },
    effort: "low" as const,
    maxTokens: 1000,
    content: [{ type: "text" as const, text: `The question: ${question}${options.length ? `\nIts choices: ${options.join(" | ")}` : ""}\n\nTopics:\n${topics}` }],
  };
}

const VOICE_SYSTEM = `You play a person answering one question in a chat. Say only what the facts below say, in this person's way of talking. Add nothing: no fact, number, name or reason that isn't given, and no offer to say more. If choices are listed and one fits the facts, pick it by its value and leave the words empty. A figure that falls inside a range fits that range. You do have an answer, so never pick a choice that means "don't know" or "not sure". If no choice fits, leave the pick empty and write the words.`;

/** A choice that says they don't know: they do, since a fact matched. */
const NOT_SURE = /don'?t know|not sure|no idea|unknown|not (defined|measured|tracked)|ما أدري|لا أعرف/i;

function voiceCall(p: Persona, question: string, q: PlanQuestion | null, facts: readonly string[]) {
  const choices = q?.options.length ? `\nThe choices (value: label):\n${q.options.map((o) => `${o.value}: ${o.label}`).join("\n")}` : "";
  return {
    kind: "connector" as const,
    system: VOICE_SYSTEM,
    schema: { type: "object", additionalProperties: false, properties: { pick: { type: "string", description: "A choice's value, or empty" }, words: { type: "string", description: "What they say, or empty" } }, required: ["pick", "words"] },
    effort: "low" as const,
    maxTokens: 1500,
    content: [{ type: "text" as const, text: `How they talk: ${p.behavior.style} ${p.behavior.lang === "ar" ? "They write in Arabic." : "They write in English."} At most ${p.behavior.maxWords} words.\n\nThe question: ${question}${choices}\n\nThe facts:\n${facts.map((f) => `- ${f}`).join("\n")}` }],
  };
}

const digits = (s: string) => (s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]$/, ""));

/** What Enter records on a question about their own work: nothing is picked for them (src/ui/ai/plan.ts, `toQuestion`). */
export const preselected = (_q: PlanQuestion): string => "";

export function makePlayer(p: Persona, deps: PlayerDeps, o: { rep?: number; flip?: { fact: string; to: string } } = {}): Player {
  const flip = coin(`${p.id}:${o.rep ?? 0}`);
  const pickFlip = coin(`${p.id}:${o.rep ?? 0}:picks`);
  const facts = p.facts.map((f) => (o.flip?.fact === f.id ? { ...f, value: o.flip.to } : f));
  const ledger: Answered[] = [];
  const released = new Set<string>();
  let corrected = false;

  const toldOf = async (question: string, options: string[], signal?: AbortSignal) => {
    // What their documents answer, they don't know offhand: asked, it's recorded like any unknown (measures.ts counts it apart).
    const unknowns = [...p.unknowns, ...(p.documented ?? [])];
    const { data } = await deps.structured<{ ids?: unknown }>(matchCall(question, options, facts, unknowns), signal);
    const ids = (Array.isArray(data.ids) ? data.ids : []).filter((x): x is string => typeof x === "string").slice(0, 4);
    return { asked: facts.filter((f) => ids.includes(f.id)), unknown: unknowns.filter((u) => ids.includes(u.id)) };
  };

  // Words they haven't been given can't get out: a number the voice made up gives way to the fact itself.
  const said = async (question: string, q: PlanQuestion | null, asked: readonly Fact[], round: number, signal?: AbortSignal) => {
    const values = asked.map((f) => f.value);
    const hasFigure = values.some((v) => digits(v).length > 0);
    let answer: string;
    let rejected: string | undefined;
    if (hasFigure && !q?.options.length) {
      // A paraphrase of a figure drops what it's a share of, and that can flip the answer: it goes as it stands.
      answer = values.join(" ");
    } else {
      const { data } = await deps.structured<{ pick?: unknown; words?: unknown }>(voiceCall(p, question, q, values), signal);
      const chosen = q?.options.find((x) => x.value === data.pick);
      const pick = chosen && !NOT_SURE.test(chosen.label) ? chosen : undefined;
      let words = typeof data.words === "string" ? data.words.trim() : "";
      const known = new Set(digits(`${values.join(" ")} ${question}`));
      // Spelled out or made up, a figure that isn't exactly theirs gives way to the fact itself.
      const made = digits(words).find((n) => !known.has(n));
      if (made || (hasFigure && words && !digits(words).length) || (chosen && !pick)) {
        rejected = words || chosen?.label;
        words = values.join(" ");
      }
      answer = pick && !words ? pick.label : pick ? `${pick.label}. ${words}` : words || values.join(" ");
    }
    const c = p.behavior.contradicts;
    if (c && !corrected && round >= c.round && released.has(c.fact)) {
      corrected = true;
      answer = `${answer} ${c.says}`;
    }
    return { answer, ...(rejected ? { rejected } : {}) };
  };

  const one = async (q: PlanQuestion, at: { flow: string; round: number }, signal?: AbortSignal): Promise<Answered> => {
    const options = q.options.map((x) => x.label);
    const base = { flow: at.flow, round: at.round, question: q.title, options };
    if (options.length && flip() < p.behavior.enterRate) return { ...base, facts: [], unknowns: [], how: "enter", answer: preselected(q), active: false };
    if (!options.length && flip() < p.behavior.skipRate) return { ...base, facts: [], unknowns: [], how: "skip", answer: "", active: false };
    const { asked, unknown } = await toldOf(q.title, options, signal);
    if (!asked.length) return { ...base, facts: [], unknowns: unknown.map((u) => u.id), how: "dont-know", answer: p.behavior.dontKnow, active: true };
    const { answer, rejected } = await said(q.title, q, asked, at.round, signal);
    for (const f of asked) released.add(f.id);
    return { ...base, facts: asked.map((f) => f.id), unknowns: unknown.map((u) => u.id), how: "fact", answer, active: true, ...(rejected ? { rejected } : {}) };
  };

  return {
    ledger,
    released,
    typed: () => ledger.filter((l) => l.active && l.how !== "enter").reduce((n, l) => n + l.answer.split(/\s+/).filter(Boolean).length, 0),
    pressesPicks(at) {
      const left = ledger.some((l) => l.flow === at.flow && l.round === at.round && (l.how === "enter" || l.how === "skip"));
      return left && pickFlip() < p.behavior.enterRate;
    },
    tookPick(question, at, answer) {
      const l = ledger.find((x) => x.flow === at.flow && x.round === at.round && x.question === question && (x.how === "enter" || x.how === "skip"));
      if (l) Object.assign(l, { how: "pick", answer, active: false });
    },
    async fill(questions, at, signal) {
      const out: Record<string, string> = {};
      for (const q of questions) {
        const a = await one(q, at, signal);
        ledger.push(a);
        out[q.id] = a.answer;
      }
      return out;
    },
    async answer(question, at, signal) {
      const base = { flow: at.flow, round: at.round, question, options: [] as string[] };
      // In prose there's nothing preselected: the same lack of attention says so instead, and tells as little.
      if (flip() < Math.max(p.behavior.enterRate, p.behavior.skipRate)) {
        ledger.push({ ...base, facts: [], unknowns: [], how: "enter", answer: "whatever you think", active: false });
        return "whatever you think";
      }
      const { asked, unknown } = await toldOf(question, [], signal);
      if (!asked.length) {
        ledger.push({ ...base, facts: [], unknowns: unknown.map((u) => u.id), how: "dont-know", answer: p.behavior.dontKnow, active: true });
        return p.behavior.dontKnow;
      }
      const { answer, rejected } = await said(question, null, asked, at.round, signal);
      for (const f of asked) released.add(f.id);
      ledger.push({ ...base, facts: asked.map((f) => f.id), unknowns: unknown.map((u) => u.id), how: "fact", answer, active: true, ...(rejected ? { rejected } : {}) });
      return answer;
    },
  };
}
