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
