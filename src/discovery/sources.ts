import { newId } from "@/doc/factory";
import type { OstCard, OstEvidence } from "./types";
import { clock, type TranscriptMeta, type TranscriptSegment } from "./transcript";
import type { DumpRole, DumpSession } from "./dump";

/*
 * A Discovery board's sources (pure): documents, web pages, pasted text, interviews and items from
 * connected tools, kept as the raw text code checks quotes against. Qalam AI reads a source in
 * chunks of about 20k characters (several small ones share a call), picks out what customers said,
 * and code keeps a quote only where it finds it in the chunk, word for word, with where it sits.
 * A brain dump is the builder's own thinking: it's read its own way (dump.ts), and its pieces are
 * the builder's words, never a customer's.
 */

export type SourceKind = "pdf" | "docx" | "markdown" | "text" | "paste" | "url" | "connector" | "interview" | "dump";

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  pdf: "PDF",
  docx: "Word",
  markdown: "Markdown",
  text: "Text",
  paste: "Pasted text",
  url: "Web page",
  connector: "Connected tool",
  interview: "Interview",
  dump: "Brain dump",
};

/** What a quote shows about the customer. */
export const QUOTE_KINDS = ["pain", "need", "desire", "behavior", "idea"] as const;
export type QuoteKind = (typeof QUOTE_KINDS)[number];

export const QUOTE_KIND_LABEL: Record<QuoteKind, string> = { pain: "Pain", need: "Need", desire: "Desire", behavior: "Behaviour", idea: "Idea" };

/** A customer's words in a source, found there by code. */
export interface SourceQuote {
  id: string;
  /** The source's own words (parts joined by " … " where the quote leaves words out). */
  text: string;
  /** [start, end) in the source's text. */
  span: [number, number];
  /** The runs of words, when the quote leaves some out. */
  parts?: [number, number][];
  page?: number;
  /** Who said it, as the source names them (kept only if the source has the name). */
  speaker?: string;
  /** Interviews: the speaker's id in the transcript, the turns the words are in, and when they were said ([start, end) seconds). Set by code. */
  speakerId?: string;
  turnIds?: string[];
  time?: [number, number];
  kind: QuoteKind;
  /** A brain dump's piece: what it is to the tree (a goal, a need, an idea…). */
  role?: DumpRole;
  /** Picked by Qalam AI, or selected by hand. */
  addedBy: "ai" | "user";
  at: number;
  /** Cards it was proposed for and the builder discarded (it isn't proposed for them again). */
  dismissed?: string[];
}

/** A customer need Qalam AI saw in a source, with the quotes that show it. */
export interface SourceNeed {
  id: string;
  title: string;
  quoteIds: string[];
}

export interface SourceRecord {
  v: 1;
  id: string;
  projectId: string;
  kind: SourceKind;
  title: string;
  /** Where it came from: a file's name, a page's address, the tool and what was asked of it. */
  origin?: string;
  /** The raw text, as read. Quotes are checked against it. */
  text: string;
  /** PDF: where each page starts in `text` (page n starts at pages[n - 1]). */
  pages?: number[];
  /** Only the start of a longer text was kept. */
  truncated?: boolean;
  /** Interviews: where each stretch of speech sits in `text` and when it was said, and who spoke. */
  segments?: TranscriptSegment[];
  transcript?: TranscriptMeta;
  addedAt: number;
  /** The chunks Qalam AI has read (indices into `chunkText(text)`). */
  read: number[];
  quotes: SourceQuote[];
  needs: SourceNeed[];
  /** A brain dump: what Qalam AI made of it, the questions asked and answered, its proposals. */
  dump?: DumpSession;
}

/** The most text a source keeps (characters). */
export const MAX_SOURCE_TEXT = 1_000_000;

// ---------------------------------------------------------------------------
// Chunks and calls

/** About this many characters per chunk. */
export const CHUNK = 20_000;
/** Characters of material in one call (several small chunks share one). */
export const CALL_BUDGET = 24_000;
/** Calls one reading may make (the AI rate limit is shared); what's left waits for "Keep reading". */
export const MAX_CALLS = 6;

export interface Chunk {
  index: number;
  start: number;
  end: number;
}

/** Where to end a chunk that starts at `start`: the last paragraph, line, sentence or word break before `limit`. */
function breakBefore(text: string, start: number, limit: number): number {
  // Look for a break in the last 40% of the window, so chunks stay near the size asked for.
  const floor = start + Math.floor((limit - start) * 0.6);
  const window = text.slice(floor, limit);
  for (const re of [/\n\s*\n/g, /\n/g, /[.!?。؟](?=\s)/g, /\s/g]) {
    let last = -1;
    for (const m of window.matchAll(re)) last = m.index! + m[0].length;
    if (last > 0) return floor + last;
  }
  // No break at all: cut, but never between the two halves of a surrogate pair.
  const code = text.charCodeAt(limit - 1);
  return code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
}

/** A text in chunks of at most `size` characters, broken at paragraphs where possible (contiguous, no overlap). */
export function chunkText(text: string, size = CHUNK): Chunk[] {
  const out: Chunk[] = [];
  let start = 0;
  while (start < text.length) {
    const end = text.length - start <= size ? text.length : breakBefore(text, start, start + size);
    out.push({ index: out.length, start, end });
    start = end;
  }
  // Nothing but whitespace isn't worth reading.
  return out.filter((c) => text.slice(c.start, c.end).trim());
}

export interface ChunkRef extends Chunk {
  sourceId: string;
}

/** Chunks still to read, packed into calls in order (small ones share), at most `maxCalls` calls. */
export function packCalls(pending: ChunkRef[], budget = CALL_BUDGET, maxCalls = MAX_CALLS): ChunkRef[][] {
  const calls: ChunkRef[][] = [];
  let size = 0;
  for (const c of pending) {
    const len = c.end - c.start;
    const cur = calls[calls.length - 1];
    if (cur && size + len <= budget) {
      cur.push(c);
      size += len;
      continue;
    }
    if (calls.length >= maxCalls) break;
    calls.push([c]);
    size = len;
  }
  return calls;
}

/** A source's chunks Qalam AI hasn't read yet (a brain dump has none: it isn't read for customers' words). */
export function unread(s: Pick<SourceRecord, "id" | "text" | "read"> & { kind?: SourceKind }): ChunkRef[] {
  if (s.kind === "dump") return [];
  const done = new Set(s.read);
  return chunkText(s.text)
    .filter((c) => !done.has(c.index))
    .map((c) => ({ ...c, sourceId: s.id }));
}

/** The page (1-based) a character of a PDF's text is on. */
export function pageAt(pages: number[] | undefined, offset: number): number | undefined {
  if (!pages?.length) return undefined;
  let lo = 0;
  let hi = pages.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pages[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// ---------------------------------------------------------------------------
// Evidence

/** A quote as evidence on a card (a brain dump's words are the builder's own). */
export function quoteEvidence(source: Pick<SourceRecord, "id" | "title"> & { kind?: SourceKind }, q: SourceQuote, addedBy: "user" | "ai", opts: { against?: boolean; now?: number } = {}): OstEvidence {
  return {
    id: newId(),
    kind: source.kind === "dump" ? "dump" : "quote",
    text: q.text,
    sourceId: source.id,
    sourceTitle: source.title,
    span: [q.span[0], q.span[1]],
    ...(q.page ? { page: q.page } : {}),
    ...(q.speaker ? { speaker: q.speaker } : {}),
    ...(q.time ? { time: [q.time[0], q.time[1]] as [number, number] } : {}),
    ...(opts.against ? { stance: "against" as const } : {}),
    addedBy,
    at: opts.now ?? Date.now(),
  };
}

/** Words that sit in a source (a quote, or a brain dump's piece). */
export const fromSource = (e: Pick<OstEvidence, "kind">) => e.kind === "quote" || e.kind === "dump";

/** The same words of the same source are already on the card. */
export const hasQuote = (card: Pick<OstCard, "evidence">, sourceId: string, span: [number, number]) =>
  card.evidence.some((e) => fromSource(e) && e.sourceId === sourceId && e.span?.[0] === span[0] && e.span?.[1] === span[1]);

/** Cards a quote can back: needs and the solutions to them; a brain dump's words can also be where a goal came from. */
export const quotable = (card: Pick<OstCard, "kind"> | undefined, sourceKind?: SourceKind) =>
  card?.kind === "opportunity" || card?.kind === "solution" || (sourceKind === "dump" && card?.kind === "outcome");

/** "Interviews.pdf · p. 3 · Sara", "Omar interview · 12:30 · Omar": where a quote is from, for captions. */
export function citation(e: Pick<OstEvidence, "sourceTitle" | "page" | "speaker" | "time">, sourceTitle?: string): string {
  return [sourceTitle ?? e.sourceTitle, e.page ? `p. ${e.page}` : "", e.time ? clock(e.time[0]) : "", e.speaker ?? ""].filter(Boolean).join(" · ");
}
