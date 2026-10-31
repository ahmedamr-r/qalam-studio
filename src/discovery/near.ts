import type { SourceQuote } from "./sources";

/*
 * Which words sit nearest a card (pure): by the words (past the small ones) they share with the
 * card's title and what it's under. Instant and with no index, for picking quotes by hand.
 */

const STOP = new Set("about after also and are because been but can could did does for from had has have her his how into its just like more most much not now only our out over some such than that the their them then there these they this those very was were what when where which while who why will with would your you".split(" "));
const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)));

/** How many words (past the small ones) two texts share. */
export function wordOverlap(a: string, b: string): number {
  const mine = words(a);
  return [...words(b)].filter((w) => mine.has(w)).length;
}

/**
 * A source's quotes in the order a card would take them: those sharing the most words with the card
 * (twice over) and with what it's under first, those dismissed for it last, the rest as they come in
 * the source. Quotes on the card already are left out.
 */
export function rankQuotes(quotes: readonly SourceQuote[], card: { id: string; title: string; description?: string }, parentTitle: string, on: ReadonlySet<string>): SourceQuote[] {
  const mine = [card.title, card.description ?? ""].join(" ");
  return quotes
    .filter((q) => !on.has(q.id))
    .map((q, i) => ({ q, i, score: wordOverlap(mine, q.text) * 2 + wordOverlap(parentTitle, q.text), gone: q.dismissed?.includes(card.id) ? 1 : 0 }))
    .sort((a, b) => a.gone - b.gone || b.score - a.score || a.i - b.i)
    .map((x) => x.q);
}
