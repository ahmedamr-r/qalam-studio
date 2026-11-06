/*
 * The project's words (hub/terms.md, pure): the terms a team uses for its own things, what each one
 * is, and the words it says to avoid for it, so Qalam AI and the people working together mean one
 * thing by one word. Named `terms` in code, since src/org/words.ts is the solo or team copy and
 * src/hub/words.ts the search's folding; people see "Words".
 *
 * A glossary and nothing else: a term says what a thing is, in a sentence or two, never how it's
 * built. Qalam AI only proposes one a conversation settled, and it's kept once a person adds it.
 */

/** Who wrote a term as it stands: a person ("you"), or Qalam AI's proposal a person added. A term whose words a person changed is theirs. */
export type TermBy = "you" | "qalam";

export interface Term {
  id: string;
  /** The project's word for it, as they write it. */
  term: string;
  /** What it is, in one or two sentences. */
  means: string;
  /** Other words for the same thing the project doesn't use. */
  avoid: string[];
  by: TermBy;
  at: number;
}

export interface Terms {
  terms: Term[];
  /** Terms taken off, lowercased: Qalam AI never proposes them again until a person adds one back. */
  gone: string[];
  /** What a person wrote in the file under a heading this doesn't know, kept as it is. */
  notes?: string;
}

/** How long each part may be: a glossary's line, not a spec. */
export const TERMS_LIMITS = { term: 60, means: 240, avoid: 6, avoidWord: 40, gone: 200 } as const;

export const emptyTerms = (): Terms => ({ terms: [], gone: [] });
