import { backingWords, evidenceBasis, reachesKnow, type BasisCounts } from "./basis";
import type { Came, OstCard, OstEvidence } from "./types";

/*
 * What a card rests on, decided by code from its evidence (pure). An opportunity Qalam AI drafted
 * with nothing behind it is Assumed until someone attaches words that back it: a customer quote,
 * the builder's own words (an interview answer, a brain dump), or a note. The builder's words
 * never count as a customer's. Words that speak against a card are kept on it and counted, but
 * never back it. What people said online (public posts, reviews) and what's read elsewhere (someone
 * else's report) back a card too, but on their own leave it Assumed until something of the team's
 * own shows it: what its people said, what it measured or studied. Qalam AI may propose a goal, a
 * problem or a solution with no evidence at all, and such a card says where it came from (`came`).
 */

export type EvidenceTier = "customer" | "answers" | "note" | "none";

/** The evidence that backs a card (not the words against it). */
export const backing = (card: Pick<OstCard, "evidence">): OstEvidence[] => card.evidence.filter((e) => e.stance !== "against");

/** What backs a card from its own customers and team (not people online, nor what's read elsewhere, nor what Qalam AI saw on a screen). */
const ownBacking = (card: Pick<OstCard, "evidence">): OstEvidence[] => backing(card).filter((e) => evidenceBasis(e) !== "read" && e.kind !== "screen");

/** How many of their screens a card was seen on (Qalam AI's look at them): it shows, and on its own leaves a card Assumed. */
export const seenCount = (card: Pick<OstCard, "evidence">) => new Set(backing(card).flatMap((e) => (e.kind === "screen" ? [e.shot?.asset ?? e.id] : []))).size;

/** What in that can reach "We know": what's said, measured or studied. */
const knownBacking = (card: Pick<OstCard, "evidence">): OstEvidence[] => ownBacking(card).filter((e) => reachesKnow(evidenceBasis(e)));

/** Whether anything customers said, or that was measured or studied, backs a card (a challenge's "nothing measured or said backs it"). */
export const knownBacked = (card: Pick<OstCard, "evidence">) => knownBacking(card).length > 0;

/** How many pieces read elsewhere (someone else's report, not people online) back a card. */
export const readCount = (card: Pick<OstCard, "evidence">) => backing(card).filter((e) => !e.online && evidenceBasis(e) === "read").length;

/** How many quotes from people online back a card. */
export const onlineCount = (card: Pick<OstCard, "evidence">) => backing(card).filter((e) => e.online).length;

/** How many of a card's quotes speak against it. */
export const againstCount = (card: Pick<OstCard, "evidence">) => card.evidence.filter((e) => e.stance === "against").length;

/** The strongest kind of evidence on a card. */
export function tierOf(card: Pick<OstCard, "evidence">): EvidenceTier {
  const kinds = new Set(ownBacking(card).map((e) => e.kind));
  if (knownBacking(card).length) return "customer";
  if (kinds.has("answer") || kinds.has("dump")) return "answers";
  if (kinds.has("note")) return "note";
  return "none";
}

/** A card's evidence at a glance, for the strip on top of it in the card panel. */
export interface EvidenceSummary {
  /** What backs it and can reach "We know" (customers' quotes, what's measured or studied), and the sources they come from. */
  quotes: number;
  sources: number;
  /** Those by what they rest on (none: all quotes). */
  mix?: BasisCounts;
  /** The team's own words that back it: interview answers, a brain dump, notes. */
  ours: number;
  /** Quotes from people online (public posts, reviews) that back it. */
  online: number;
  /** What's read elsewhere that backs it. */
  read?: number;
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
  const backs = ownBacking(card);
  const quotes = knownBacking(card);
  const mix: BasisCounts = {};
  for (const e of quotes) {
    const b = evidenceBasis(e);
    mix[b] = (mix[b] ?? 0) + 1;
  }
  const read = readCount(card);
  return {
    quotes: quotes.length,
    // A quote with no source of its own counts as one.
    sources: new Set(quotes.map((e) => e.sourceId ?? e.sourceTitle ?? e.id)).size,
    mix,
    ours: backs.length - quotes.length,
    ...(read ? { read } : {}),
    online: onlineCount(card),
    against: againstCount(card),
    who: mostFirst(quotes.map((e) => e.speaker)),
    from: mostFirst(quotes.map((e) => e.sourceTitle)),
  };
}

/** A card's evidence in the order its rows read: what can reach "We know", the rest, then what speaks against it (each kept as attached). */
export function evidenceRows(card: Pick<OstCard, "evidence">): OstEvidence[] {
  const rank = (e: OstEvidence) => (e.stance === "against" ? 2 : reachesKnow(evidenceBasis(e)) ? 0 : 1);
  return [...card.evidence].sort((a, b) => rank(a) - rank(b));
}

/** How a card with nothing behind it says where it came from. */
export const CAME_WORDS: Record<Came, string> = { answers: "your answers", read: "read online", picks: "Qalam AI's picks", idea: "Qalam AI's idea", seen: "seen on your screens" };

/**
 * A card that nothing of its own backs yet (dashed on the board): an opportunity Qalam AI drafted, as
 * people online alone don't back it, or anything proposed with nothing that can reach "We know".
 */
export const isAssumed = (card: Pick<OstCard, "kind" | "createdBy" | "evidence" | "came">) => (card.came ? knownBacking(card).length === 0 : card.kind === "opportunity" && card.createdBy === "ai" && ownBacking(card).length === 0);

/** A solution Qalam AI came up with (not one the builder named). */
export const isAIIdea = (card: Pick<OstCard, "kind" | "createdBy" | "evidence">) =>
  card.kind === "solution" && card.createdBy === "ai" && !ownBacking(card).some((e) => e.kind === "answer" || e.kind === "quote" || e.kind === "dump");

/** The evidence chip's words on a card ("" when a card has nothing to say about it). */
export function evidenceLabel(card: Pick<OstCard, "kind" | "createdBy" | "evidence" | "pageBacking" | "came" | "needed">): string {
  if (card.pageBacking) return card.pageBacking;
  // A part the product can't run without doesn't claim anyone asked for it.
  if (card.needed && !knownBacking(card).length) return "Needed to run it";
  const against = againstCount(card);
  const tail = against ? ` · ${against} against` : "";
  const online = onlineCount(card);
  const posts = online ? ` · ${online} ${online === 1 ? "post" : "posts"} online` : "";
  const read = readCount(card);
  const reads = read ? ` · ${read} read elsewhere` : "";
  const seen = seenCount(card);
  const shown = seen ? ` · seen on ${seen === 1 ? "your screen" : `${seen} of your screens`}` : "";
  if (card.came && isAssumed(card)) return `Assumed · ${card.came === "seen" && seen > 1 ? `seen on ${seen} of your screens` : CAME_WORDS[card.came]}${posts}${card.came === "read" ? "" : reads}${tail}`;
  if (isAssumed(card)) return against || online || read || seen ? `Assumed${shown}${posts}${reads}${tail}` : "Assumed · needs evidence";
  if (isAIIdea(card)) return `Qalam AI idea${tail}`;
  const n = (k: OstEvidence["kind"]) => ownBacking(card).filter((e) => e.kind === k).length;
  const known = evidenceSummary(card);
  if (known.quotes) return `${backingWords(known.mix ?? {})}${reads}${tail}`;
  // The answers to a card's questions are a source of the person's words too (src/discovery/questions.ts).
  if (n("answer") || ownBacking(card).some((e) => e.answerId?.startsWith("ask:"))) return `From your answers${tail}`;
  if (n("dump")) return `From your ${ownBacking(card).some((e) => e.kind === "dump" && !e.file) ? "brain dump" : "file"}${tail}`;
  if (n("note")) return `${n("note") === 1 ? "Your note" : `${n("note")} notes`}${tail}`;
  if (online) return `${online} ${online === 1 ? "post" : "posts"} online${reads}${tail}`;
  if (read) return `${read} read elsewhere${tail}`;
  if (against) return `${against} against`;
  return card.kind === "opportunity" ? "No evidence yet" : "";
}
