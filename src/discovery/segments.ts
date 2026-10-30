import type { SourceQuote } from "./sources";

/*
 * A source's text cut where quotes (and pages) begin and end, so a reader can mark the quotes in
 * place (pure). `range` reads one part of the text (a doc inside a joined brain dump): the cuts
 * stay in the text's own positions, and a quote reaching past the part is marked only inside it.
 */

export interface Segment {
  start: number;
  end: number;
  quote?: string;
  /** A page starts here (PDF). */
  page?: number;
}

export function segmentsOf(text: string, quotes: readonly Pick<SourceQuote, "id" | "span" | "parts">[], o: { pages?: readonly number[]; range?: readonly [number, number] } = {}): Segment[] {
  const [from, to] = o.range ? [Math.max(0, o.range[0]), Math.min(text.length, o.range[1])] : [0, text.length];
  if (to <= from) return [];
  const marks = quotes
    .flatMap((q) => (q.parts ?? [q.span]).map(([a, b]) => ({ a: Math.max(a, from), b: Math.min(b, to), id: q.id })))
    .filter((m) => m.a < m.b)
    .sort((x, y) => x.a - y.a);
  const pages = o.pages ?? [];
  const cuts = new Set<number>([from, to, ...marks.flatMap((m) => [m.a, m.b]), ...pages.filter((p) => p > from && p < to)]);
  const at = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < at.length - 1; i++) {
    const [start, end] = [at[i], at[i + 1]];
    if (start === end) continue;
    const m = marks.find((x) => x.a <= start && end <= x.b);
    const page = pages.length > 1 ? pages.indexOf(start) : -1;
    out.push({ start, end, ...(m ? { quote: m.id } : {}), ...(page >= 0 ? { page: page + 1 } : {}) });
  }
  return out;
}
