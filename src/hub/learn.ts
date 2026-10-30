import { isAssumed } from "@/discovery/evidence";
import { cardsOf, type CheckBoard } from "./checks";
import { tally, type Voice } from "./people";
import { cardRef, topicLineRef } from "./pieces";
import { STRENGTH_LABEL, strengthOf } from "./strength";
import { checkWords, type Topic } from "./topics";

/**
 * What to learn next (pure). Code gathers what the organization doesn't know yet and is betting
 * on: needs drafted with nothing behind them, targets resting on thin evidence, risky assumptions
 * no test checks, open questions on the topic pages, kinds of customer no one has heard from
 * lately. Qalam AI turns them into a plan (who to talk to, what to ask them, what to test), each
 * part citing the gaps it closes; code keeps a part only on what it cites, and a "who" only as a
 * segment or customer the material names.
 */

export type LearnKind = "assumed" | "thin-target" | "risky" | "open" | "unheard";

export interface LearnItem {
  id: string;
  kind: LearnKind;
  text: string;
  /** What it's about: a card, a topic page's line, a segment. */
  ref?: string;
  board?: string;
  card?: string;
  topic?: string;
}

export const LEARN_LIMITS = { items: 60, talk: 5, questions: 10, tests: 5 } as const;
/** A segment not heard from in this long is one to talk to. */
export const UNHEARD_DAYS = 180;
const DAY = 86_400_000;
const q = (t: string) => `“${t.replace(/\s+/g, " ").trim()}”`;

/** What the organization doesn't know yet, the most pressing first: targets, then risks, then the rest. */
export function learnItems(o: { boards: CheckBoard[]; topics: Topic[]; voices: ReadonlyMap<string, Voice>; segments: string[]; now: number; product: string | null }): LearnItem[] {
  const boards = o.boards.filter((b) => !o.product || !b.product || b.product === o.product);
  const cards = cardsOf(boards);
  const out: Omit<LearnItem, "id">[] = [];
  for (const c of cards) {
    if (c.card.kind === "opportunity" && c.card.stage === "target") {
      const s = strengthOf(c.card, { now: o.now, voices: o.voices });
      if (s.level === "none" || s.level === "team" || s.level === "thin")
        out.push({ kind: "thin-target", text: `The target ${q(c.card.title)} on ${c.board.name} rests on ${STRENGTH_LABEL[s.level].toLowerCase()} evidence${s.why ? `: ${s.why}` : ""}`, ref: cardRef(c.board.id, c.id), board: c.board.id, card: c.id });
    }
  }
  for (const c of cards) {
    if (c.card.kind !== "solution" || c.card.stage === "dropped" || c.card.stage === "shipped") continue;
    const tested = new Set(cards.filter((t) => t.board === c.board && t.parent === c.id && t.card.kind === "test").flatMap((t) => t.card.test?.assumptionIds ?? []));
    for (const a of c.card.assumptions ?? [])
      if (a.importance === 3 && !tested.has(a.id)) out.push({ kind: "risky", text: `${q(c.card.title)} (${c.card.stage}) fails without this, and nothing tests it: ${a.text}`, ref: cardRef(c.board.id, c.id), board: c.board.id, card: c.id });
  }
  for (const c of cards) if (isAssumed(c.card) && c.card.stage !== "parked" && c.card.stage !== "solved") out.push({ kind: "assumed", text: `A need drafted with nothing behind it: ${q(c.card.title)} on ${c.board.name}`, ref: cardRef(c.board.id, c.id), board: c.board.id, card: c.id });
  for (const t of o.topics) {
    if (o.product && t.products.length && !t.products.includes(o.product)) continue;
    for (const l of t.lines) if (l.section === "open") out.push({ kind: "open", text: `An open question about ${q(t.title)}: ${l.text}`, ref: topicLineRef(t.id, l.id), topic: t.id });
  }
  // Kinds of customer no one has been heard from lately.
  const recent = [...o.voices.values()].filter((v) => o.now - v.at <= UNHEARD_DAYS * DAY);
  const heard = new Map(tally(recent).segments.map(([s, n]) => [s.toLowerCase(), n]));
  const ever = new Map(tally([...o.voices.values()]).segments.map(([s, n]) => [s.toLowerCase(), n]));
  for (const s of [...new Set(o.segments.map((x) => x.trim()).filter(Boolean))])
    if (!heard.get(s.toLowerCase())) out.push({ kind: "unheard", text: ever.get(s.toLowerCase()) ? `No one from ${q(s)} heard from in the last ${Math.round(UNHEARD_DAYS / 30)} months` : `No one from ${q(s)} heard from yet`, ref: `segment:${s}` });
  return out.slice(0, LEARN_LIMITS.items).map((x, i) => ({ ...x, id: `i${i + 1}` }));
}

const KIND_HEADING: Record<LearnKind, string> = {
  "thin-target": "Targets resting on thin evidence",
  risky: "Risky assumptions nothing tests",
  assumed: "Needs drafted with nothing behind them",
  open: "Open questions on the topic pages",
  unheard: "Kinds of customer not heard from",
};

export interface LearnMaterial {
  text: string;
  ids: string[];
  items: Map<string, LearnItem>;
  /** The segments the organization names (a "who" may be one of them). */
  segments: string[];
}

export function learnMaterial(o: { items: LearnItem[]; context: string; segments: string[] }): LearnMaterial {
  const out = [o.context.trim() || "The organization hasn't said what it is yet."];
  if (o.segments.length) out.push("", `Kinds of customer it tells apart: ${o.segments.join("; ")}`);
  out.push("", o.items.length ? "What it doesn't know yet (id: what):" : "Nothing open stands out.");
  for (const kind of Object.keys(KIND_HEADING) as LearnKind[]) {
    const list = o.items.filter((x) => x.kind === kind);
    if (!list.length) continue;
    out.push("", `${KIND_HEADING[kind]}:`, ...list.map((x) => `- ${x.id}: ${x.text}`));
  }
  out.push("", "What should the team learn next, from whom, and how?");
  return { text: out.join("\n"), ids: o.items.map((x) => x.id), items: new Map(o.items.map((x) => [x.id, x])), segments: o.segments };
}

export interface LearnPlan {
  focus: string;
  talkTo: { who: string; why: string; cites: string[] }[];
  questions: { question: string; learns: string; cites: string[] }[];
  tests: { what: string; method: string; passIf: string; cites: string[] }[];
}

const items = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);

/** What code keeps of the plan: each part citing gaps it was sent, its words found there; a "who" named in the material. */
export function sanitizePlan(raw: unknown, m: LearnMaterial): LearnPlan | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const cites = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && m.items.has(x.trim())).map((x) => x.trim()))];
  const texts = (ids: string[]) => ids.map((id) => ({ text: m.items.get(id)!.text }));
  const all = [...m.items.values()].map((x) => ({ text: x.text }));
  const said = new Set(words([m.text].join(" ")));
  const talkTo: LearnPlan["talkTo"] = [];
  for (const x of items(r.talkTo)) {
    const c = cites(x.cites);
    const who = typeof x.who === "string" ? x.who.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    // A kind of customer the material names: never one Qalam AI made up.
    if (!c.length || !who || !words(who).every((w) => said.has(w))) continue;
    const why = checkWords(x.why, texts(c), "", 300);
    if (why && talkTo.length < LEARN_LIMITS.talk) talkTo.push({ who, why, cites: c });
  }
  const questions: LearnPlan["questions"] = [];
  for (const x of items(r.questions)) {
    const c = cites(x.cites);
    const question = checkWords(x.question, texts(c), "", 240);
    const learns = checkWords(x.learns, texts(c), "", 240);
    if (c.length && question && learns && questions.length < LEARN_LIMITS.questions) questions.push({ question, learns, cites: c });
  }
  const tests: LearnPlan["tests"] = [];
  for (const x of items(r.tests)) {
    const c = cites(x.cites);
    const what = checkWords(x.what, texts(c), "", 240);
    const method = checkWords(x.method, texts(c), "", 240);
    const passIf = checkWords(x.passIf, texts(c), "", 200);
    if (c.length && what && method && passIf && tests.length < LEARN_LIMITS.tests) tests.push({ what, method, passIf, cites: c });
  }
  const focus = checkWords(r.focus, all, "", 400);
  if (!focus && !talkTo.length && !questions.length && !tests.length) return null;
  return { focus: focus ?? "", talkTo, questions, tests };
}

/** The plan as a Markdown page people can read, share and edit. */
export function planToMarkdown(p: LearnPlan, o: { title: string; at: number; items: Map<string, LearnItem> }): string {
  const day = new Date(o.at).toISOString().slice(0, 10);
  const why = (ids: string[]) => {
    const list = ids.map((id) => o.items.get(id)?.text).filter(Boolean);
    return list.length ? `\n  - Closes: ${list.join("; ")}` : "";
  };
  const parts = [`# ${o.title}`, "", `${day} · drafted by Qalam AI from what the organization doesn't know yet`];
  if (p.focus) parts.push("", p.focus);
  if (p.talkTo.length) parts.push("", "## Who to talk to", "", ...p.talkTo.map((x) => `- **${x.who}**: ${x.why}${why(x.cites)}`));
  if (p.questions.length) parts.push("", "## What to ask", "", ...p.questions.map((x, i) => `${i + 1}. ${x.question}\n   - Tells us: ${x.learns}`));
  if (p.tests.length) parts.push("", "## What to test", "", ...p.tests.map((x) => `- **${x.what}**: ${x.method}. Passes if ${x.passIf.replace(/^passes? if /i, "")}${why(x.cites)}`));
  return `${parts.join("\n")}\n`;
}
