import { sharedWords } from "@/discovery/near";
import { FLOW_WORDS, type AskedAbout, type AskedEntry, type AskedFlow } from "./types";

/**
 * Recall (pure): what's already known about what an interview is about, picked and worded for a turn,
 * with no tokens spent. Four kinds, each with its own room: what was asked and answered in other
 * conversations (the project's memory), what their material says (the index, found by search), the
 * problem pages' known lines, and decisions. The conversation the turn is in is left out: it reads
 * that already. Another product's answers never come; a teammate's come only when they bear on this.
 */

/** What a turn is about: its conversation, its product, card, goal, problem page or source, and its words. */
export interface RecallSubject {
  flow: AskedFlow;
  key: string;
  about: AskedAbout;
  words: string;
}

/** A line found in their material or on a page, as the core gives it. */
export interface RecallLine {
  text: string;
  /** Where it's from: a source's title, a page's title. */
  from: string;
  /** Whose words: people said, measured, read elsewhere, the team's… */
  whose?: string;
}

export interface RecallDecision {
  at: number;
  what: string;
  why?: string;
}

export interface RecallItem {
  id: string;
  kind: "said" | "material" | "page" | "decision";
  why?: "subject" | "words" | "recent";
  mine?: boolean;
  how?: string;
  ageDays?: number;
}

export interface Recalled {
  /** The block a turn reads ("" when nothing's known). */
  block: string;
  /** The words it may hold its settled points to: what was said and found, never a pick. */
  hay: string;
  ids: string[];
  /** For the turn's trace. */
  items: RecallItem[];
}

export const RECALL_LIMITS = { said: 12, recent: 4, recentDays: 14, material: 8, pages: 4, decisions: 3, chars: 6000, line: 300 } as const;

const DAY = 86_400_000;
const one = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, max: number = RECALL_LIMITS.line) => {
  const t = one(s);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const dateOf = (at: number) => new Date(at).toISOString().slice(0, 10);

type Why = "subject" | "words" | "recent";

/** The past answers that bear on a subject: the same card, goal, page or source first, then those sharing its words, then their own lately in this space. */
export function pickAnswers(entries: readonly AskedEntry[], s: RecallSubject, o: { me: string; now: number }): { e: AskedEntry; why: Why }[] {
  const product = s.about.product ?? null;
  const pool = entries.filter((e) => !(e.flow === s.flow && e.key === s.key) && e.how !== "left" && (e.about.product === null || product === null || e.about.product === product));
  const sameSubject = (e: AskedEntry) =>
    (!!s.about.card && e.about.card === s.about.card) || (!!s.about.goal && e.about.goal === s.about.goal) || (!!s.about.topic && e.about.topic === s.about.topic) || (!!s.about.source && e.about.source === s.about.source);
  const out: { e: AskedEntry; why: Why }[] = [];
  const seen = new Set<string>();
  const add = (e: AskedEntry, why: Why) => {
    if (seen.has(e.id) || out.length >= RECALL_LIMITS.said) return;
    seen.add(e.id);
    out.push({ e, why });
  };
  for (const e of pool) if (sameSubject(e)) add(e, "subject");
  const near = pool
    .map((e) => ({ e, n: sharedWords(s.words, `${e.q} ${e.a}`) }))
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n || b.e.at - a.e.at);
  for (const x of near) add(x.e, "words");
  let recent = 0;
  for (const e of pool) {
    if (recent >= RECALL_LIMITS.recent) break;
    if (seen.has(e.id) || e.by.id !== o.me || o.now - e.at > RECALL_LIMITS.recentDays * DAY || (e.about.product ?? null) !== product) continue;
    add(e, "recent");
    recent++;
  }
  return out;
}

/** Whose answer, as a turn reads it: theirs (always, on a solo project), a teammate's name, or "a teammate". */
const whoSaid = (e: AskedEntry, me: string, solo: boolean) => (e.by.id === me || solo ? "they" : (e.by.name ?? "a teammate"));

function answerLine(e: AskedEntry, me: string, solo: boolean): string {
  const who = whoSaid(e, me, solo);
  // Screenshots shown: by name only, kept with the product's screens; what's on them isn't anyone's words.
  const shown = e.shots?.length ? `showed screenshots (${e.shots.map((s) => `“${clip(s)}”`).join(", ")})` : "";
  if (e.how === "own" && shown) return e.a ? `${who} said “${clip(e.a)}” and ${shown}` : `${who} ${shown}`;
  if (e.how === "own") return `${who} said “${clip(e.a)}”`;
  if (e.how === "pick") return `${who} agreed to your recommendation “${clip(e.a)}” (agreement, not their words)`;
  return `${who} said they don't know${e.a ? ` (“${clip(e.a)}”)` : ""}`;
}

/** The block a turn reads, its hay and its ids, within its room: what's said before goes first, what's found next, then pages and decisions. */
export function recallBlock(o: {
  answers: readonly { e: AskedEntry; why: Why }[];
  material: readonly RecallLine[];
  pages: readonly RecallLine[];
  decisions: readonly RecallDecision[];
  me: string;
  solo: boolean;
  now: number;
  /** What the flow sends already: a line it holds isn't repeated. */
  sent?: string;
}): Recalled {
  const sent = one(o.sent ?? "").toLowerCase();
  const fresh = (text: string) => !sent || !sent.includes(one(text).toLowerCase().slice(0, 120));
  let n = 0;
  const id = () => `m${++n}`;
  const items: RecallItem[] = [];
  const hay: string[] = [];
  const sections: string[][] = [];
  let used = 0;
  const room = (line: string) => {
    if (used + line.length > RECALL_LIMITS.chars) return false;
    used += line.length + 1;
    return true;
  };

  const said: string[] = [];
  for (const { e, why } of o.answers) {
    // An answer the turn holds already (a dump that is the find's answers) isn't told twice; a short one ("Yes") always is.
    if (e.a.length >= 12 && !fresh(e.a)) continue;
    const ref = id();
    const line = `- ${ref} · ${FLOW_WORDS[e.flow]}, ${dateOf(e.at)} · ${clip(e.q, 200)} → ${answerLine(e, o.me, o.solo)}`;
    if (!room(line)) break;
    said.push(line);
    items.push({ id: ref, kind: "said", why, mine: e.by.id === o.me, how: e.how, ageDays: Math.floor((o.now - e.at) / DAY) });
    hay.push(e.q);
    if (e.how === "own" || e.how === "unknown") hay.push(e.a);
  }
  if (said.length) sections.push(["Asked before, in other conversations (id · where, when · the question → the answer):", ...said]);

  const found = (lines: readonly RecallLine[], max: number, kind: "material" | "page") => {
    const out: string[] = [];
    for (const l of lines.filter((x) => fresh(x.text)).slice(0, max)) {
      const ref = id();
      const line = `- ${ref} · ${l.whose ? `${l.whose} · ` : ""}${clip(l.from, 80)} · “${clip(l.text)}”`;
      if (!room(line)) break;
      out.push(line);
      items.push({ id: ref, kind });
      hay.push(l.text);
    }
    return out;
  };
  const material = found(o.material, RECALL_LIMITS.material, "material");
  if (material.length) sections.push(["In their material, found by search (id · whose · where · words):", ...material]);
  const pages = found(o.pages, RECALL_LIMITS.pages, "page");
  if (pages.length) sections.push(["What their problem pages hold as known (id · the page · the line):", ...pages]);

  const decided: string[] = [];
  for (const d of o.decisions.slice(0, RECALL_LIMITS.decisions)) {
    const ref = id();
    const line = `- ${ref} · ${dateOf(d.at)} · ${clip(d.what, 200)}${d.why ? ` · why: ${clip(d.why, 200)}` : ""}`;
    if (!room(line)) break;
    decided.push(line);
    items.push({ id: ref, kind: "decision" });
    hay.push(d.what, d.why ?? "");
  }
  if (decided.length) sections.push(["Decided already (id · when · what · why):", ...decided]);

  if (!sections.length) return { block: "", hay: "", ids: [], items: [] };
  const block = [
    "What's already known (memory: other conversations, their material, their pages and decisions). Never ask what it answers; build on it. Where what they say now disagrees with it, put both to them in a question.",
    ...sections.map((s) => s.join("\n")),
  ].join("\n\n");
  return { block, hay: hay.filter(Boolean).join("\n"), ids: items.map((i) => i.id), items };
}
