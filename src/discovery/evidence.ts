import type { OstCard, OstEvidence } from "./types";

/*
 * What a card rests on, decided by code from its evidence (pure). An opportunity Qalam AI drafted
 * with nothing behind it is Assumed until someone attaches words that back it: a customer quote,
 * the builder's own words (an interview answer, a brain dump), or a note. The builder's words
 * never count as a customer's. Words that speak against a card are kept on it and counted, but
 * never back it.
 */

export type EvidenceTier = "customer" | "answers" | "note" | "none";

/** The evidence that backs a card (not the words against it). */
export const backing = (card: Pick<OstCard, "evidence">): OstEvidence[] => card.evidence.filter((e) => e.stance !== "against");

/** How many of a card's quotes speak against it. */
export const againstCount = (card: Pick<OstCard, "evidence">) => card.evidence.filter((e) => e.stance === "against").length;

/** The strongest kind of evidence on a card. */
export function tierOf(card: Pick<OstCard, "evidence">): EvidenceTier {
  const kinds = new Set(backing(card).map((e) => e.kind));
  if (kinds.has("quote")) return "customer";
  if (kinds.has("answer") || kinds.has("dump")) return "answers";
  if (kinds.has("note")) return "note";
  return "none";
}

/** A card's evidence at a glance, for the strip on top of it in the card panel. */
export interface EvidenceSummary {
  /** Customers' quotes that back it, and the sources they come from. */
  quotes: number;
  sources: number;
  /** The team's own words that back it: interview answers, a brain dump, notes. */
  ours: number;
  against: number;
  /** Who said those quotes, as their sources name them, the most quoted first. */
  who: string[];
  /** The sources' titles, the most quoted first. */
  from: string[];
}

/** Names counted, the most first (ties: the first seen first); the same name in another case is one. */
function mostFirst(names: (string | undefined)[]): string[] {
  const seen = new Map<string, { name: string; n: number }>();
  for (const raw of names) {
    const name = raw?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const s = seen.get(key);
    if (s) s.n++;
    else seen.set(key, { name, n: 1 });
  }
  return [...seen.values()].sort((a, b) => b.n - a.n).map((s) => s.name);
}

export function evidenceSummary(card: Pick<OstCard, "evidence">): EvidenceSummary {
  const backs = backing(card);
  const quotes = backs.filter((e) => e.kind === "quote");
  return {
    quotes: quotes.length,
    // A quote with no source of its own counts as one.
    sources: new Set(quotes.map((e) => e.sourceId ?? e.sourceTitle ?? e.id)).size,
    ours: backs.length - quotes.length,
    against: againstCount(card),
    who: mostFirst(quotes.map((e) => e.speaker)),
    from: mostFirst(quotes.map((e) => e.sourceTitle)),
  };
}

/** A card's evidence in the order its rows read: customers' quotes, the team's own words, then what speaks against it (each kept as attached). */
export function evidenceRows(card: Pick<OstCard, "evidence">): OstEvidence[] {
  const rank = (e: OstEvidence) => (e.stance === "against" ? 2 : e.kind === "quote" ? 0 : 1);
  return [...card.evidence].sort((a, b) => rank(a) - rank(b));
}

/** An opportunity Qalam AI drafted that nothing backs yet (dashed on the board). */
export const isAssumed = (card: Pick<OstCard, "kind" | "createdBy" | "evidence">) => card.kind === "opportunity" && card.createdBy === "ai" && backing(card).length === 0;

/** A solution Qalam AI came up with (not one the builder named). */
export const isAIIdea = (card: Pick<OstCard, "kind" | "createdBy" | "evidence">) =>
  card.kind === "solution" && card.createdBy === "ai" && !backing(card).some((e) => e.kind === "answer" || e.kind === "quote" || e.kind === "dump");

/** The evidence chip's words on a card ("" when a card has nothing to say about it). */
export function evidenceLabel(card: Pick<OstCard, "kind" | "createdBy" | "evidence">): string {
  const against = againstCount(card);
  const tail = against ? ` · ${against} against` : "";
  if (isAssumed(card)) return against ? `Assumed${tail}` : "Assumed · needs evidence";
  if (isAIIdea(card)) return `Qalam AI idea${tail}`;
  const n = (k: OstEvidence["kind"]) => backing(card).filter((e) => e.kind === k).length;
  const quotes = n("quote");
  if (quotes) return `${quotes} ${quotes === 1 ? "quote" : "quotes"}${tail}`;
  if (n("answer")) return `From your answers${tail}`;
  if (n("dump")) return `From your brain dump${tail}`;
  if (n("note")) return `${n("note") === 1 ? "Your note" : `${n("note")} notes`}${tail}`;
  if (against) return `${against} against`;
  return card.kind === "opportunity" ? "No evidence yet" : "";
}
