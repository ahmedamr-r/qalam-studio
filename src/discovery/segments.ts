import type { SourceQuote, TextBlock } from "./sources";

/*
 * A source's text cut where quotes (and pages) begin and end, so a reader can mark the quotes in
 * place (pure). `range` reads one part of the text (a doc inside a joined brain dump): the cuts
 * stay in the text's own positions, and a quote reaching past the part is marked only inside it.
 * With a source's shape (`blocks`, read from a PDF's layout) the text is also cut where its
 * headings, list items and paragraphs begin and end, for `shapeSegments` to group.
 */

export interface Segment {
  start: number;
  end: number;
  quote?: string;
  /** A page starts here (PDF). */
  page?: number;
}

export function segmentsOf(text: string, quotes: readonly Pick<SourceQuote, "id" | "span" | "parts">[], o: { pages?: readonly number[]; range?: readonly [number, number]; blocks?: readonly TextBlock[] } = {}): Segment[] {
  const [from, to] = o.range ? [Math.max(0, o.range[0]), Math.min(text.length, o.range[1])] : [0, text.length];
  if (to <= from) return [];
  const marks = quotes
    .flatMap((q) => (q.parts ?? [q.span]).map(([a, b]) => ({ a: Math.max(a, from), b: Math.min(b, to), id: q.id })))
    .filter((m) => m.a < m.b)
    .sort((x, y) => x.a - y.a);
  const pages = o.pages ?? [];
  const cuts = new Set<number>([from, to, ...marks.flatMap((m) => [m.a, m.b]), ...pages.filter((p) => p > from && p < to)]);
  if (o.blocks) {
    for (const b of o.blocks) for (const at of b.span) if (at > from && at < to) cuts.add(at);
    for (const m of text.slice(from, to).matchAll(/\n{2,}/g)) cuts.add(from + m.index).add(from + m.index + m[0].length);
  }
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

export type BlockKind = TextBlock["kind"] | "p";

/** What a reader draws as one block: a paragraph, a heading or a list item, and the page it starts when it does. */
export interface ShapedBlock {
  kind: BlockKind;
  segments: Segment[];
  page?: number;
}

/**
 * The segments (cut with the source's `blocks`) as the blocks a reader draws: the source's
 * headings and list items, and paragraphs between them a blank line apart. The blank lines aren't
 * drawn; every other segment keeps its place in the text.
 */
export function shapeSegments(text: string, segments: readonly Segment[], blocks: readonly TextBlock[]): ShapedBlock[] {
  const out: ShapedBlock[] = [];
  let cur: ShapedBlock | null = null;
  for (const s of segments) {
    const words = text.slice(s.start, s.end);
    if (s.page) cur = null;
    if (/^\n{2,}$/.test(words)) {
      cur = null;
      continue;
    }
    const kind: BlockKind = blocks.find((b) => b.span[0] <= s.start && s.end <= b.span[1])?.kind ?? "p";
    if (!cur || cur.kind !== kind || (kind !== "p" && blocks.some((b) => b.span[0] === s.start))) {
      cur = { kind, segments: [], ...(s.page ? { page: s.page } : {}) };
      out.push(cur);
    }
    cur.segments.push(s);
  }
  return out;
}
