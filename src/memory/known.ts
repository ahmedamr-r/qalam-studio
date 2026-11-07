import { matchQuestions, type Match } from "./match";
import type { RecallSubject } from "./recall";
import type { AskedEntry, AskedFlow, AskedHow } from "./types";
import { FLOW_WORDS } from "./types";

/**
 * What was said before to a question like one asked now (pure): shown under the question, with Use it,
 * so they answer with a press instead of from memory. In the subject's scope: the same card, goal, page
 * or source, or either side about the whole project; never another product's, never the conversation the
 * question is in, never what was left. Exact matches first, then near, newest first, three at most.
 */

export interface KnownAnswer {
  /** The memory line's id. */
  id: string;
  /** What was said: their words, the pick they agreed to, or what they said not knowing. */
  text: string;
  how: Exclude<AskedHow, "left">;
  /** Whose: theirs (always, on a solo project), a teammate's by name, or a teammate's. */
  mine: boolean;
  name?: string;
  at: number;
  flow: AskedFlow;
  match: Exclude<Match, null>;
}

export const KNOWN_MAX = 3;

/** Whether a remembered answer is in a subject's scope. */
export function inScope(e: AskedEntry, s: RecallSubject): boolean {
  if (e.flow === s.flow && e.key === s.key) return false;
  const product = s.about.product ?? null;
  if (e.about.product !== null && product !== null && e.about.product !== product) return false;
  const pin = (a: RecallSubject["about"]) => a.card ?? a.goal ?? a.topic ?? a.source ?? null;
  const theirs = pin(e.about);
  const ours = pin(s.about);
  if (!theirs || !ours) return true;
  return (!!s.about.card && e.about.card === s.about.card) || (!!s.about.goal && e.about.goal === s.about.goal) || (!!s.about.topic && e.about.topic === s.about.topic) || (!!s.about.source && e.about.source === s.about.source);
}

export function knownFor(questions: readonly { id: string; title: string }[], entries: readonly AskedEntry[], s: RecallSubject, o: { me: string; solo: boolean; fold?: (t: string) => string }): Map<string, KnownAnswer[]> {
  const pool = entries.filter((e) => e.how !== "left" && inScope(e, s) && (e.how !== "unknown" || e.by.id === o.me));
  const out = new Map<string, KnownAnswer[]>();
  for (const q of questions) {
    const hits = pool
      .map((e) => ({ e, m: matchQuestions(q.title, e.q, o.fold) }))
      .filter((x): x is { e: AskedEntry; m: Exclude<Match, null> } => !!x.m)
      .sort((a, b) => Number(b.m === "exact") - Number(a.m === "exact") || b.e.at - a.e.at)
      .slice(0, KNOWN_MAX);
    if (!hits.length) continue;
    out.set(
      q.id,
      hits.map(({ e, m }) => {
        const mine = e.by.id === o.me || o.solo;
        return { id: e.id, text: e.a, how: e.how as KnownAnswer["how"], mine, ...(!mine && e.by.name ? { name: e.by.name } : {}), at: e.at, flow: e.flow, match: m };
      }),
    );
  }
  return out;
}

/** Where and when something was said: the flow, then how long ago. */
export function whereSaid(flow: AskedFlow, at: number, now = Date.now()): string {
  const days = Math.floor((now - at) / 86_400_000);
  const when = days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  return `${FLOW_WORDS[flow]}, ${when}`;
}

/** A known answer in words, for the strip under a question. */
export function knownLine(k: KnownAnswer, now = Date.now()): { who: string; said: string; where: string } {
  const who = k.mine ? "You" : (k.name ?? "A teammate");
  const said = k.how === "unknown" ? `didn't know${k.text ? ` (“${k.text}”)` : ""}` : k.how === "pick" ? `took Qalam AI's pick “${k.text}”` : `said “${k.text}”`;
  return { who, said, where: whereSaid(k.flow, k.at, now) };
}
