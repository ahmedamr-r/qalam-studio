/*
 * What a point in a source rests on (pure): customers' words are one kind of material among
 * several. Each point the reader keeps says where its words come from, and that decides what it can
 * do: people said, measured and studied reach "We know" on a topic page; what's read elsewhere and
 * the team's own thinking stay in "We believe". Words are still found word for word in the source.
 * Code can hold a claim only so far (`heldBasis`): whether a report is a study or a guess, or the
 * team's or a vendor's, is the model's call, shown to the person, who can change it.
 */

export const BASES = ["said", "measured", "studied", "read", "own"] as const;
export type Basis = (typeof BASES)[number];

export const BASIS_LABEL: Record<Basis, string> = { said: "People said", measured: "Measured", studied: "Studied", read: "Read elsewhere", own: "Our thinking" };

/** A point's words, as a call hears whose they are. */
export const BASIS_WHOSE: Record<Basis, string> = { said: "customers", measured: "measured", studied: "a study", read: "read elsewhere", own: "the team" };

export const isBasis = (x: unknown): x is Basis => typeof x === "string" && (BASES as readonly string[]).includes(x);

/** What "We know" and "Against" can rest on. */
export const reachesKnow = (b: Basis) => b === "said" || b === "measured" || b === "studied";

/**
 * What code can hold a claim to: an interview's words are people's; a measurement has a number in
 * its words; a page fetched from the web is someone else's, so it isn't this team's measurement or
 * study (the person can still say it is).
 */
export function heldBasis(b: Basis, words: string, kind?: string): Basis {
  if (kind === "interview") return "said";
  if (b === "measured" && !/\p{Nd}/u.test(words)) return kind === "url" ? "read" : "own";
  if (kind === "url" && (b === "measured" || b === "studied")) return "read";
  return b;
}

/** A point's basis: the person's word on its source, else what the reader said, else what its source's kind has always meant. */
export function basisOf(s: { kind?: string; basis?: Basis }, q: { basis?: Basis }): Basis {
  if (s.kind === "post") return "read";
  return s.basis ?? q.basis ?? (s.kind === "dump" ? "own" : "said");
}

/** A quote piece's `sub`: `<kind>` for what people said, `<basis>:<kind>` for the rest. */
export const basisSub = (b: Basis, kind: string) => (b === "said" ? kind : `${b}:${kind}`);

/** A quote piece's basis, read from its `sub` (`dump:` and `online:` from before there was one). */
export function pieceBasis(p: { sub?: string | null }): Basis {
  const prefix = (p.sub ?? "").split(":")[0];
  if (!(p.sub ?? "").includes(":")) return "said";
  if (prefix === "dump" || prefix === "own") return "own";
  if (prefix === "online" || prefix === "read") return "read";
  if (prefix === "measured" || prefix === "studied") return prefix;
  return "said";
}

/** Words on a card: what they rest on (an older card's words say by their kind). */
export function evidenceBasis(e: { kind: string; basis?: Basis; online?: boolean }): Basis {
  if (e.online) return "read";
  return e.basis ?? (e.kind === "quote" ? "said" : "own");
}
