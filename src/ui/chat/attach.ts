import { create } from "zustand";
import type { Ingested } from "@/discovery/ingest/core";
import type { TextBlock } from "@/discovery/sources";
import type { Hit } from "@/connectors/recipes";
import type { SetupDoc } from "@/org/setup";
import { connectorsDb, type ConnectorState } from "@/org/connectors";

/*
 * Docs brought into the chat box, beside what's typed: files from this computer and items picked in
 * a connector. Each is read as soon as it's picked (in the window for files, in the core for a
 * connector's), so the box can say how long it is, or why it couldn't be read, before anything is
 * sent. Which sources the box offers depends on what Qalam AI asked: docs for an idea or a brain dump,
 * customers' own words for problems. The pure parts are exported for tests.
 */

/** What Qalam AI asked for: the person's own thinking (an idea, the company), or what customers said. */
export type SourceFit = "docs" | "customers";

/** A doc as it's kept once it's sent: where it came from ("computer", or a connector's id), its title, and what was known of it when it was picked. */
export type DocRef = Omit<SetupDoc, "span" | "cut">;

export interface Attachment extends DocRef {
  /** One per file or item: the same one picked twice stays one. */
  key: string;
  /** Where it came from, in words ("this computer", "Google Drive"). */
  via: string;
  state: "reading" | "ready" | "failed";
  ingested?: Ingested;
  why?: string;
}

/** The connector groups each fit draws on, in order. */
const GROUPS: Record<SourceFit, readonly string[]> = { docs: ["docs"], customers: ["voice", "docs"] };

const reach = (c: ConnectorState) => (c.via && c.tone === "ok" ? 0 : c.claudeCode?.status === "connected" ? 1 : 2);

/**
 * The connectors that fit what was asked, in the order the box offers them: connected ones first,
 * then those Claude Code has, then the rest; within each, the fit's groups in order, then the
 * catalog's. Only connectors that bring material in.
 */
export function sourcesFor(fit: SourceFit, connectors: readonly ConnectorState[]): ConnectorState[] {
  const groups = GROUPS[fit];
  return connectors
    .map((c, i) => ({ c, i, g: groups.indexOf(c.group) }))
    .filter((x) => x.c.feeds === "material" && x.c.imports && x.g >= 0)
    .sort((a, b) => reach(a.c) - reach(b.c) || a.g - b.g || a.i - b.i)
    .map((x) => x.c);
}

/** A part of what's sent as one text: its words, under a line naming where they came from (none for their own words). */
export interface Part {
  header?: string;
  body: string;
  /** A PDF's shape, in the body's own positions. */
  blocks?: readonly TextBlock[];
}

/** The parts as one text, read as their own thinking, where each part's words sit in it ([start, end), its header left out), and their shapes in the text's positions. */
export function joinParts(parts: readonly Part[]): { text: string; spans: [number, number][]; blocks: TextBlock[] } {
  let text = "";
  const spans: [number, number][] = [];
  const blocks: TextBlock[] = [];
  for (const p of parts) {
    const body = p.body.trim();
    if (text) text += "\n\n";
    if (p.header) text += `${p.header}\n\n`;
    spans.push([text.length, text.length + body.length]);
    // Positions in the body as it came, before its ends were trimmed.
    const shift = text.length - (p.body.length - p.body.trimStart().length);
    for (const b of p.blocks ?? []) {
      const span: [number, number] = [b.span[0] + shift, b.span[1] + shift];
      if (span[0] >= text.length && span[1] <= text.length + body.length) blocks.push({ ...b, span });
    }
    text += body;
  }
  return { text, spans, blocks };
}

/** A doc's part: its words under "From <tool>: <title>". */
export const docPart = (d: { via: string; title: string; text: string; blocks?: readonly TextBlock[] }): Part => ({ header: `From ${d.via}: ${d.title}`, body: d.text, ...(d.blocks?.length ? { blocks: d.blocks } : {}) });

/** Each part's span once the text is cut at `max`: shortened (`cut`) where the cut falls in it, left out where it falls before it. */
export function spansWithin<T>(parts: readonly T[], spans: readonly [number, number][], max: number): (T & { span: [number, number]; cut?: true })[] {
  return parts.flatMap((p, i) => {
    const [a, b] = spans[i];
    if (a >= max) return [];
    return [{ ...p, span: [a, Math.min(b, max)] as [number, number], ...(b > max ? { cut: true as const } : {}) }];
  });
}

/** Why the box can't send yet because of its docs (one still reading, too long together), else null. */
export function docsCheck(words: string, docs: readonly Attachment[], max: number | null): string | null {
  const reading = docs.find((d) => d.state === "reading");
  if (reading) return `Wait for “${reading.title}” to finish reading.`;
  if (max === null) return null;
  const ready = docs.filter((d) => d.state === "ready" && d.ingested);
  if (!ready.length) return null;
  const total = words.trim().length + ready.reduce((n, d) => n + d.ingested!.text.length + d.title.length + 30, 0);
  return total > max ? `That's over ${max.toLocaleString()} characters with the docs: leave one out.` : null;
}

/** A doc's words, counted the way the chip shows them. */
export const wordCount = (text: string) => (text.match(/\S+/g) ?? []).length;

// ---------------------------------------------------------------------------
// The box's docs (one box at a time: what the current question holds)

interface AttachState {
  items: Attachment[];
}

export const useAttach = create<AttachState>(() => ({ items: [] }));

/** A PDF's page count, for the reader. */
const pagesOf = (ing: Ingested) => (ing.pages?.length ? { pages: ing.pages.length } : {});
const set = (key: string, patch: Partial<Attachment>) => useAttach.setState((s) => ({ items: s.items.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The ones not already in the box, added as reading. */
function add(items: Attachment[]): Attachment[] {
  const have = new Set(useAttach.getState().items.map((x) => x.key));
  const fresh = items.filter((x) => !have.has(x.key));
  useAttach.setState((s) => ({ items: [...s.items, ...fresh] }));
  return fresh;
}

/** Files from this computer: each read here, as the home's Add reads them. */
export function attachFiles(files: File[]) {
  const fresh = add(files.map((f) => ({ key: `computer:${f.name}:${f.size}:${f.lastModified}`, from: "computer", via: "this computer", title: f.name, at: new Date(f.lastModified).toISOString(), state: "reading" as const })));
  for (const a of fresh) {
    const file = files.find((f) => `computer:${f.name}:${f.size}:${f.lastModified}` === a.key)!;
    void import("../discovery/ingest").then(({ ingestFile }) =>
      ingestFile(file).then(
        (ingested) => set(a.key, { state: "ready", ingested, type: ingested.kind, ...pagesOf(ingested) }),
        (e: unknown) => set(a.key, { state: "failed", why: message(e) }),
      ),
    );
  }
}

/** Items picked in a connector: read together in the core, not taken in until the box sends. */
export async function attachHits(connector: Pick<ConnectorState, "id" | "label">, hits: Hit[]) {
  const fresh = add(hits.map((h) => ({ key: `${connector.id}:${h.id}`, from: connector.id, via: connector.label, title: h.title, ...(h.url ? { origin: h.url } : {}), ...(h.type && h.type !== "folder" ? { type: h.type } : {}), ...(h.at ? { at: h.at } : {}), state: "reading" as const })));
  if (!fresh.length) return;
  const picked = hits.filter((h) => fresh.some((a) => a.key === `${connector.id}:${h.id}`));
  try {
    const read = await connectorsDb.read(connector.id, picked);
    for (const it of read) set(`${connector.id}:${it.id}`, it.ingested ? { state: "ready", ingested: it.ingested, ...pagesOf(it.ingested) } : { state: "failed", why: it.why ?? "Nothing came back for it." });
  } catch (e) {
    for (const a of fresh) set(a.key, { state: "failed", why: message(e) });
  }
}

export const removeAttachment = (key: string) => useAttach.setState((s) => ({ items: s.items.filter((x) => x.key !== key) }));
export const clearAttachments = () => useAttach.setState({ items: [] });

/** A doc ready to send: where it came from, its title, its words. */
export type SentDoc = Attachment & { ingested: Ingested };

/** The docs ready to send, with their words. */
export const readyDocs = (items: readonly Attachment[]): SentDoc[] => items.filter((x): x is SentDoc => x.state === "ready" && !!x.ingested);

/** What's kept of a sent doc: where it came from and what was known of it. */
export const docRef = ({ from, title, origin, type, at, pages }: DocRef): DocRef => ({ from, title, ...(origin ? { origin } : {}), ...(type ? { type } : {}), ...(at ? { at } : {}), ...(pages ? { pages } : {}) });
