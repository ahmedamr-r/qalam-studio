import { speakerAt } from "@/discovery/ingest/speaker-at";
import { chunkText, type SourceKind, type SourceQuote, type SourceRecord } from "@/discovery/sources";
import type { SetupDoc } from "./setup";

/*
 * A setup's docs of customers' words, each made a source of its own once the setup is settled
 * (pure). The setup reads everything sent as one brain dump, so its questions and proposal see it
 * together; but a brain dump's pieces are the team's words, and what customers said counts by the
 * sources it came from. So each doc marked as customers' words becomes a source of its kind with its
 * words and the quotes read in it (their ids kept, so what cites them still finds them, each with
 * who said it where the text names them), and only the person's own words stay in the dump. The
 * setup's screens see the quotes together again through `setupQuotes`.
 */

/** Kinds a doc from this computer can be as a source of its own. */
const FILE_KINDS = new Set<SourceKind>(["pdf", "docx", "markdown", "text", "interview"]);

/** What a doc is as a source of its own: a connector's item, a page, or a file by what it was read as. */
export function kindOfDoc(doc: Pick<SetupDoc, "from" | "type">): SourceKind {
  if (doc.from === "page") return "url";
  if (doc.from !== "computer") return "connector";
  return doc.type && FILE_KINDS.has(doc.type as SourceKind) ? (doc.type as SourceKind) : "text";
}

const inSpan = (q: Pick<SourceQuote, "span">, [a, b]: readonly [number, number]) => q.span[0] >= a && q.span[1] <= b;
const shifted = (q: SourceQuote, by: number): SourceQuote => ({
  ...q,
  span: [q.span[0] + by, q.span[1] + by],
  ...(q.parts ? { parts: q.parts.map(([x, y]) => [x + by, y + by] as [number, number]) } : {}),
});

/** The docs still to split: customers' words, with their words in the dump, not split before. */
const toSplit = (docs: readonly SetupDoc[] | undefined) => (docs ?? []).filter((d) => d.voice === "customers" && d.span && !d.source && d.from !== "said");

/**
 * The dump once its customers' docs are sources of their own, and those sources. Running it again
 * changes nothing (a doc split before says where it went).
 */
export function splitSetup(dump: SourceRecord, newId: () => string): { dump: SourceRecord; made: SourceRecord[] } {
  const docs = dump.setup?.docs;
  const todo = toSplit(docs);
  if (!dump.setup || !docs || !todo.length) return { dump, made: [] };
  const made: SourceRecord[] = [];
  const moved = new Set<string>();
  const ids = new Map<SetupDoc, string>();
  for (const doc of todo) {
    const span = doc.span!;
    const text = dump.text.slice(span[0], span[1]);
    if (!text.trim()) continue;
    const quotes = dump.quotes
      .filter((q) => inSpan(q, span))
      .map((q) => {
        const own = shifted(q, -span[0]);
        const speaker = q.speaker ?? speakerAt(text, own.span);
        return { ...own, ...(speaker ? { speaker } : {}) };
      });
    for (const q of quotes) moved.add(q.id);
    const blocks = (dump.blocks ?? []).filter((b) => b.span[0] >= span[0] && b.span[1] <= span[1]).map((b) => ({ ...b, span: [b.span[0] - span[0], b.span[1] - span[0]] as [number, number] }));
    const id = newId();
    ids.set(doc, id);
    made.push({
      v: 1,
      id,
      projectId: "",
      boards: [...(dump.boards ?? [])],
      product: dump.product ?? null,
      kind: kindOfDoc(doc),
      title: doc.title,
      ...(doc.origin ? { origin: doc.origin } : {}),
      text,
      ...(blocks.length ? { blocks } : {}),
      ...(doc.cut ? { truncated: true } : {}),
      addedAt: dump.addedAt,
      // The setup's reading took what customers said from it: it isn't read again unasked.
      read: chunkText(text).map((c) => c.index),
      quotes,
      needs: [],
    });
  }
  if (!made.length) return { dump, made: [] };
  return {
    dump: {
      ...dump,
      quotes: dump.quotes.filter((q) => !moved.has(q.id)),
      ...(dump.filed ? { filed: dump.filed.filter((id) => !moved.has(id)) } : {}),
      setup: { ...dump.setup, docs: docs.map((d) => (ids.has(d) ? { ...d, source: ids.get(d)! } : d)) },
    },
    made,
  };
}

/** The sources a setup's docs were split into, by id (the ones the dump names). */
export const splitIds = (dump: Pick<SourceRecord, "setup">): string[] => (dump.setup?.docs ?? []).flatMap((d) => (d.source ? [d.source] : []));

/** Where a quote of the setup lives now: its own source (and the quote as that source has it), else the dump. */
export interface QuoteHome {
  source: SourceRecord;
  quote: SourceQuote;
}

/**
 * Every quote the setup read, in the dump's text as it was read (each split doc's quotes shifted
 * back into its span), and where each lives now. Quotes added to a split source later, outside the
 * words it took from the dump, aren't the setup's.
 */
export function setupQuotes(dump: SourceRecord, splits: readonly SourceRecord[]): { quotes: SourceQuote[]; homeOf: (quoteId: string) => QuoteHome | null } {
  const homes = new Map<string, QuoteHome>(dump.quotes.map((q) => [q.id, { source: dump, quote: q }]));
  const quotes = [...dump.quotes];
  for (const doc of dump.setup?.docs ?? []) {
    const s = doc.source && doc.span ? splits.find((x) => x.id === doc.source) : undefined;
    if (!s) continue;
    for (const q of s.quotes) {
      if (homes.has(q.id) || q.span[1] > doc.span![1] - doc.span![0]) continue;
      homes.set(q.id, { source: s, quote: q });
      quotes.push(shifted(q, doc.span![0]));
    }
  }
  quotes.sort((a, b) => a.span[0] - b.span[0]);
  return { quotes, homeOf: (id) => homes.get(id) ?? null };
}
