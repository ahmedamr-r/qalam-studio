import { newId } from "@/doc/factory";
import type { SourceQuote } from "@/discovery/sources";
import { checkWords } from "@/hub/topics";
import { wordOverlap } from "@/discovery/near";

export { wordOverlap };
import type { SetupProblem, SetupSession } from "./setup";

/*
 * The problems a setup's reading saw (pure): what customers said and the needs in the dump, grouped
 * by the problem they raise, so the canvas and a board show a few problems with their quotes rather
 * than a card per quote. Qalam AI proposes the groups; code keeps a quote in a group only where the
 * call was sent it, it's a need or what customers said, and no group took it before. The title is
 * the problem as Qalam AI puts it, its quotes the evidence under it; code keeps it where its numbers
 * and quoted words are in those quotes (else the words of its first need, or its first quote).
 */

const CARD_TITLE_MAX = 160;

/** A card's title from someone's words: whole words, the first sentence when it's long. */
export function titleOf(words: string): string {
  const one = words.replace(/\s+/g, " ").trim();
  if (one.length <= CARD_TITLE_MAX) return one;
  const first = one.split(/(?<=[.!?])\s/)[0];
  if (first.length <= CARD_TITLE_MAX) return first;
  const cut = one.slice(0, CARD_TITLE_MAX);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 80 ? cut.lastIndexOf(" ") : CARD_TITLE_MAX).trim()}…`;
}

/** The need an idea answers: the one sharing the most words with it, else the first. */
export function needFor(idea: Pick<SourceQuote, "text">, needs: readonly Pick<SourceQuote, "text">[]): number {
  let best = 0;
  let score = 0;
  needs.forEach((n, i) => {
    const shared = wordOverlap(idea.text, n.text);
    if (shared > score) {
      score = shared;
      best = i;
    }
  });
  return best;
}

export const MAX_PROBLEMS = 12;
const TITLE_MAX = 120;

/** A quote a problem rests on: a need it found, or what customers said. */
export const isProblem = (q: Pick<SourceQuote, "role">) => q.role === "need" || q.role === "evidence";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const items = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []).map(rec);
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/**
 * A group's title: the problem as Qalam AI puts it (what goes wrong, for whom), kept where every
 * number and quoted word in it is in its quotes; else its first need's words, else its first quote's.
 */
function titled(title: string, quotes: SourceQuote[]): { title: string; by?: "qalam" } {
  const kept = title ? checkWords(title, quotes, "", TITLE_MAX) : null;
  if (kept) return { title: kept, by: "qalam" };
  const first = quotes.find((q) => q.role === "need") ?? quotes[0];
  return { title: titleOf(first.text) };
}

/** The groups the reading proposed, as code keeps them. `refs` names each piece by the id the call gave it (f…). */
export function sanitizeGroups(raw: unknown, refs: Readonly<Record<string, string>>, quotes: readonly SourceQuote[], makeId: () => string = newId): SetupProblem[] {
  const byId = new Map(quotes.map((q) => [q.id, q]));
  const taken = new Set<string>();
  const out: SetupProblem[] = [];
  for (const g of items(raw)) {
    if (out.length >= MAX_PROBLEMS) break;
    const mine = (Array.isArray(g.fragmentIds) ? g.fragmentIds : [])
      .flatMap((ref) => (typeof ref === "string" && refs[ref] ? [byId.get(refs[ref])] : []))
      .filter((q): q is SourceQuote => !!q && isProblem(q) && !taken.has(q.id));
    const unique = [...new Map(mine.map((q) => [q.id, q])).values()];
    if (!unique.length) continue;
    for (const q of unique) taken.add(q.id);
    out.push({ id: makeId(), ...titled(clip(g.title, TITLE_MAX), unique), quotes: unique.map((q) => q.id) });
  }
  return out;
}

/**
 * Groups for a session the reading didn't group (from before): each need it found, with what
 * customers said that shares at least two words with it; what customers said that fits no need is
 * a problem of its own, as before.
 */
export function groupsFromNeeds(quotes: readonly SourceQuote[], makeId: (i: number) => string = (i) => `n${i}`): SetupProblem[] {
  const needs = quotes.filter((q) => q.role === "need");
  const groups = needs.map((n, i) => ({ id: makeId(i), title: titleOf(n.text), quotes: [n.id] }));
  let i = needs.length;
  for (const q of quotes.filter((x) => x.role === "evidence")) {
    let best = -1;
    let score = 1;
    needs.forEach((n, j) => {
      const shared = wordOverlap(n.text, q.text);
      if (shared > score) {
        score = shared;
        best = j;
      }
    });
    if (best >= 0) groups[best].quotes.push(q.id);
    else groups.push({ id: makeId(i++), title: titleOf(q.text), quotes: [q.id] });
  }
  return groups;
}

/**
 * The setup's problems as they stand: the reading's groups, each keeping only quotes that are still
 * there and still problems (an answer can change a piece's role), else groups made from its needs;
 * and the problem quotes no group took (`loose`).
 */
export function setupGroups(session: Pick<SetupSession, "problems">, quotes: readonly SourceQuote[]): { groups: SetupProblem[]; loose: string[] } {
  const byId = new Map(quotes.map((q) => [q.id, q]));
  if (!session.problems) return { groups: groupsFromNeeds(quotes), loose: [] };
  const groups = session.problems.map((g) => ({ ...g, quotes: g.quotes.filter((id) => byId.has(id) && isProblem(byId.get(id)!)) })).filter((g) => g.quotes.length);
  const grouped = new Set(groups.flatMap((g) => g.quotes));
  const loose = quotes.filter((q) => isProblem(q) && !grouped.has(q.id)).map((q) => q.id);
  return { groups, loose };
}
