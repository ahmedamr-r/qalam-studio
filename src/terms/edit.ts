import { avoidList, sentence } from "./terms-md";
import { TERMS_LIMITS, type Term, type TermBy, type Terms } from "./types";

/*
 * A change to the project's words (pure). A person adds, fixes or takes off a term; a term Qalam AI
 * proposed is added once they keep it (`by: "qalam"`, theirs once they change its words). One taken
 * off is never proposed again, until a person adds it back.
 */

export type TermsEdit =
  | { op: "add"; term: string; means: string; avoid?: readonly string[]; by?: TermBy }
  | { op: "fix"; id: string; term?: string; means?: string; avoid?: readonly string[] }
  | { op: "remove"; id: string };

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const key = (s: string) => one(s).toLowerCase();
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const words = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20) : undefined);

/** An edit as a request sends it, checked (null: not one). */
export function termsEditOf(raw: unknown): TermsEdit | null {
  const b = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const id = text(b.id, 40)?.trim() ?? "";
  if (b.op === "remove") return id ? { op: "remove", id } : null;
  const term = text(b.term, 200);
  const means = text(b.means, 1000);
  const avoid = words(b.avoid);
  if (b.op === "fix") return id && (term?.trim() || means?.trim() || avoid) ? { op: "fix", id, ...(term?.trim() ? { term } : {}), ...(means?.trim() ? { means } : {}), ...(avoid ? { avoid } : {}) } : null;
  if (b.op === "add") return term?.trim() && means?.trim() ? { op: "add", term, means, ...(avoid ? { avoid } : {}), ...(b.by === "qalam" ? { by: "qalam" as const } : {}) } : null;
  return null;
}

/** The term with that word, or one that says to avoid it. */
export function termFor(t: Terms, word: string): Term | undefined {
  const k = key(word);
  return t.terms.find((x) => key(x.term) === k) ?? t.terms.find((x) => x.avoid.some((a) => key(a) === k));
}

export function editTerms(t: Terms, e: TermsEdit, o: { now: number; id: () => string }): Terms {
  if (e.op === "remove") {
    const gone = t.terms.find((x) => x.id === e.id);
    if (!gone) return t;
    return { ...t, terms: t.terms.filter((x) => x.id !== e.id), gone: [...t.gone.filter((g) => g !== key(gone.term)), key(gone.term)].slice(-TERMS_LIMITS.gone) };
  }
  if (e.op === "fix") {
    const was = t.terms.find((x) => x.id === e.id);
    if (!was) return t;
    const term = e.term !== undefined ? one(e.term).slice(0, TERMS_LIMITS.term) : was.term;
    const means = e.means !== undefined ? sentence(e.means) : was.means;
    if (!term || !means) return t;
    // A fix that makes it another term's word would leave two: the fix is refused.
    if (t.terms.some((x) => x.id !== was.id && key(x.term) === key(term))) return t;
    const next: Term = { ...was, term, means, avoid: avoidList(e.avoid ?? was.avoid, term), by: "you", at: o.now };
    return { ...t, terms: t.terms.map((x) => (x.id === was.id ? next : x)), gone: t.gone.filter((g) => g !== key(term)) };
  }
  const term = one(e.term).slice(0, TERMS_LIMITS.term);
  const means = sentence(e.means);
  if (!term || !means) return t;
  const there = t.terms.find((x) => key(x.term) === key(term));
  // The same term again is its fix, in the newer words.
  if (there) return editTerms(t, { op: "fix", id: there.id, means, avoid: e.avoid ?? there.avoid }, o);
  const added: Term = { id: o.id(), term, means, avoid: avoidList(e.avoid ?? [], term), by: e.by ?? "you", at: o.now };
  return { ...t, terms: [...t.terms, added], gone: t.gone.filter((g) => g !== key(term)) };
}
