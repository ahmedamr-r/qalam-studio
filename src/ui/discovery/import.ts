import { newId } from "@/doc/factory";
import { studio } from "@/doc/store";
import type { Doc } from "@/doc/schema";
import { isOstCard } from "@/doc/board";
import { AIError, callAI } from "@/ai/client";
import type { ResearchInfo } from "@/ai/research-shared";
import { feedback } from "@/commands/feedback";
import { cardOf } from "@/discovery/ops";
import { allCards, childCards } from "@/discovery/tree";
import { SOURCE_KIND_LABEL, hasQuote, packCalls, unread, type SourceKind, type SourceRecord } from "@/discovery/sources";
import { sanitizeExtract, sanitizeSynthesis, type CallChunk, type SynthCard, type SynthContext, type SynthQuote } from "@/discovery/synthesis";
import { awaitingRoles, finishExtracted, finishInterviewQuotes, speakerNote, type SpeakerRole } from "@/discovery/transcript";
import { currentProject } from "@/projects/session";
import { offline } from "./ai";
import { boardTree } from "./draft";
import { IngestError, ingestFile, ingestPaste, ingestUrl, type Ingested } from "./ingest";
import { addSourceRecord, setJob, sourceOf, updateSource, useSources } from "./sources";
import { startReview } from "./review";

/*
 * Bringing sources onto a board: each is read in the browser (or fetched through the server, or
 * brought in from connected tools), kept as raw text, then Qalam AI picks out what customers said
 * (extract, a few parts per call) and maps it to the tree (synthesize). Code checks every quote
 * against the source and every proposal against the tree; the proposals wait as a ghost over the
 * tree until they're accepted or discarded. An interview waits until the builder says who is who:
 * Qalam AI quotes participants only, and code drops any quote outside their turns.
 */

export type AddInput =
  | { kind: "file"; file: File }
  | { kind: "url"; url: string }
  | { kind: "paste"; text: string; title?: string }
  | { kind: "connector"; connectors: string[]; request: string; label: string };

const PATH = "/api/discovery";

const titleOf = (i: AddInput) => (i.kind === "file" ? i.file.name : i.kind === "url" ? i.url : i.kind === "paste" ? i.title || "Pasted text" : `${i.label}: ${i.request}`);
const kindOf = (i: AddInput): SourceKind => (i.kind === "file" ? "text" : i.kind === "url" ? "url" : i.kind === "paste" ? "paste" : "connector");
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Work in flight (reading, quoting, mapping): Stop stops all of it. */
const running = new Set<AbortController>();
function begin(): AbortController {
  const ctrl = new AbortController();
  running.add(ctrl);
  useSources.setState({ busy: true });
  return ctrl;
}
function end(ctrl: AbortController) {
  running.delete(ctrl);
  useSources.setState({ busy: running.size > 0 });
}

export function stopSources() {
  for (const c of running) c.abort();
}

/** Add sources, have Qalam AI pick out their quotes, then map those to the tree (unless `map` is false). */
export async function addSources(inputs: AddInput[], opts: { map?: boolean } = {}) {
  const projectId = currentProject()?.id;
  if (!projectId || !inputs.length) return;
  const ctrl = begin();
  useSources.setState({ notice: null });
  const added: string[] = [];
  await Promise.all(
    inputs.map(async (input) => {
      const job = newId();
      setJob(job, { phase: "reading", title: titleOf(input), kind: kindOf(input) });
      try {
        const read = input.kind === "file" ? [await ingestFile(input.file)] : input.kind === "url" ? [await ingestUrl(input.url, ctrl.signal)] : input.kind === "paste" ? [await ingestPaste(input.text, input.title)] : await fromTools(input, job, ctrl.signal);
        for (const r of read) {
          const rec: SourceRecord = { v: 1, id: newId(), projectId, kind: r.kind, title: r.title, ...(r.origin ? { origin: r.origin } : {}), text: r.text, ...(r.pages ? { pages: r.pages } : {}), ...(r.truncated ? { truncated: true } : {}), ...(r.segments && r.transcript ? { segments: r.segments, transcript: r.transcript } : {}), addedAt: Date.now(), read: [], quotes: [], needs: [] };
          await addSourceRecord(rec);
          added.push(rec.id);
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        useSources.setState((s) => ({ failed: [...s.failed, { id: job, title: titleOf(input), error: e instanceof IngestError || e instanceof AIError ? e.message : `Couldn't read it (${message(e)}).` }] }));
      } finally {
        setJob(job, null);
      }
    }),
  );
  try {
    if (!added.length || ctrl.signal.aborted) return;
    if (added.length === 1) useSources.setState({ open: { id: added[0] } });
    const waiting = added.filter((id) => awaitingRoles(sourceOf(id) ?? { kind: "" })).length;
    if (waiting && added.length > 1) useSources.setState({ notice: { text: `Say who is who in ${waiting === 1 ? "the interview" : `${waiting} interviews`} (open ${waiting === 1 ? "it" : "each"} from the list): Qalam AI reads ${waiting === 1 ? "it" : "them"} after that.` } });
    const found = await readSources(added, ctrl);
    if (opts.map !== false && found > 0 && !ctrl.signal.aborted && boardTree(studio().doc)) await mapQuotes({ sourceIds: added }, ctrl);
  } finally {
    end(ctrl);
  }
}

// ---------------------------------------------------------------------------
// Connected tools

async function fromTools(input: Extract<AddInput, { kind: "connector" }>, job: string, signal: AbortSignal): Promise<Ingested[]> {
  if (await offline()) throw new IngestError("Qalam AI isn't set up here, so it can't reach your tools.");
  const { data } = await callAI<ResearchInfo>(PATH, { stage: "import", request: input.request, connectors: input.connectors }, undefined, signal, (e) => {
    if (e.type === "activity") setJob(job, { phase: "reading", title: e.label, kind: "connector" });
  });
  const caps = data.captures ?? [];
  if (!caps.length) throw new IngestError(data.error || `${input.label} didn't return anything to read. Name the pages, tickets or documents to bring in.`);
  const { captureText, captureTitle } = await import("./ingest/text");
  return caps
    .map((c) => {
      const text = captureText(c.text);
      return { kind: "connector" as const, title: captureTitle(text, c.title), origin: c.url ?? input.label, text };
    })
    .filter((c) => c.text);
}

// ---------------------------------------------------------------------------
// Extract: what customers said

/** The product and the outcome, for Qalam AI to read the material with. */
function productLine(doc: Doc): string {
  const root = boardTree(doc);
  const outcome = root ? cardOf(doc, root) : null;
  return [doc.brief?.summary ?? "", outcome?.title ? `The outcome the team wants to move: ${outcome.title}${outcome.metric?.name ? ` (measured by ${outcome.metric.name})` : ""}.` : ""]
    .filter(Boolean)
    .join(" ")
    .slice(0, 2000);
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/**
 * Have Qalam AI read the sources' unread parts (a few calls at most; the rest waits for "Keep
 * reading"). Returns how many quotes code kept.
 */
export async function readSources(ids: string[], given?: AbortController): Promise<number> {
  // An interview waits until the builder says who is who.
  const sources = ids.map(sourceOf).filter((s): s is SourceRecord => !!s && !awaitingRoles(s));
  if (!sources.length) return 0;
  if (await offline()) {
    useSources.setState({ notice: { text: "Qalam AI isn't set up here, so it can't pick out quotes. Select words in a source and drag them onto a card to quote them yourself." } });
    return 0;
  }
  const ctrl = given ?? begin();
  const calls = packCalls(sources.flatMap(unread));
  const touched = new Set(calls.flat().map((c) => c.sourceId));
  for (const id of touched) setJob(id, { phase: "quoting" });
  const product = productLine(studio().doc);
  let found = 0;
  let failure: string | null = null;
  try {
    await pool(calls, 2, async (call) => {
      if (ctrl.signal.aborted || failure) return;
      const chunks: CallChunk[] = call.map((c, i) => {
        const s = sourceOf(c.sourceId)!;
        return { ref: `c${i + 1}`, sourceId: c.sourceId, start: c.start, text: s.text.slice(c.start, c.end), ...(s.pages ? { pages: s.pages } : {}) };
      });
      try {
        const part = (c: CallChunk) => {
          const s = sourceOf(c.sourceId)!;
          return { id: c.ref, source: s.title.slice(0, 300), kind: SOURCE_KIND_LABEL[s.kind], text: c.text, ...(s.transcript ? { speakers: speakerNote(s.transcript) } : {}) };
        };
        const { data } = await callAI<unknown>(PATH, { stage: "extract", product, chunks: chunks.map(part) }, undefined, ctrl.signal);
        const taken = new Map(chunks.map((c) => [c.sourceId, (sourceOf(c.sourceId)?.quotes ?? []).map((q) => q.span)]));
        // In an interview, only participants' words, with who said them and when (code's say).
        const got = finishExtracted(sanitizeExtract(data, chunks, taken), sourceOf);
        found += got.quotes.length;
        for (const id of new Set(call.map((c) => c.sourceId)))
          await updateSource(id, (s) => ({
            ...s,
            read: [...new Set([...s.read, ...call.filter((c) => c.sourceId === id).map((c) => c.index)])],
            quotes: [...s.quotes, ...got.quotes.filter((q) => q.sourceId === id).map((q) => q.quote)].sort((a, b) => a.span[0] - b.span[0]),
            needs: [...s.needs, ...got.needs.filter((n) => n.sourceId === id).map((n) => n.need)],
          }));
      } catch (e) {
        if ((e as Error).name !== "AbortError") failure ??= message(e);
      }
    });
  } finally {
    for (const id of touched) setJob(id, null);
    if (!given) end(ctrl);
  }
  const left = ids.map(sourceOf).filter((s): s is SourceRecord => !!s && !awaitingRoles(s)).reduce((n, s) => n + unread(s).length, 0);
  if (failure) useSources.setState({ notice: { text: `Qalam AI couldn't read everything: ${failure}`, action: "read" } });
  else if (left && !ctrl.signal.aborted) useSources.setState({ notice: { text: `Qalam AI read what one go allows; ${left} ${left === 1 ? "part is" : "parts are"} still unread.`, action: "read" } });
  return found;
}

/**
 * The builder says who is who in an interview. Quotes it already has stay only where they're a
 * participant's words; the first time, Qalam AI then reads it and maps its quotes to the tree.
 */
export async function confirmSpeakers(id: string, roles: Record<string, SpeakerRole>) {
  const first = awaitingRoles(sourceOf(id) ?? { kind: "" });
  await updateSource(id, (s) => {
    if (!s.transcript) return s;
    const next = { ...s, transcript: { ...s.transcript, rolesConfirmed: true, speakers: s.transcript.speakers.map((sp) => ({ ...sp, role: roles[sp.id] ?? sp.role, roleBy: "user" as const })) } };
    const quotes = finishInterviewQuotes(next, s.quotes);
    const kept = new Set(quotes.map((q) => q.id));
    return { ...next, quotes, needs: s.needs.map((n) => ({ ...n, quoteIds: n.quoteIds.filter((q) => kept.has(q)) })).filter((n) => n.quoteIds.length) };
  });
  if (!first) return;
  const ctrl = begin();
  try {
    const found = await readSources([id], ctrl);
    if (found > 0 && !ctrl.signal.aborted && boardTree(studio().doc)) await mapQuotes({ sourceIds: [id] }, ctrl);
  } finally {
    end(ctrl);
  }
}

// ---------------------------------------------------------------------------
// Synthesize: where the quotes fit the tree

/** How deep an opportunity is (1 = right under the outcome); 0 for other cards. */
function depthOf(doc: Doc, id: string): number {
  let d = 0;
  let n = doc.nodes[id];
  while (isOstCard(n) && n.meta.ost.kind === "opportunity") {
    d++;
    n = n.parentId ? doc.nodes[n.parentId] : undefined!;
  }
  return d;
}

const MAX_QUOTES = 150;
const MAX_CARDS = 400;

/** The synthesize request and what code checks its answer against. */
export function synthesizeInput(doc: Doc, sources: SourceRecord[]) {
  const cards = allCards(doc).slice(0, MAX_CARDS);
  const refOf = new Map(cards.map((c, i) => [c.id, `c${i + 1}`]));
  const synthCards: SynthCard[] = cards.map(({ id, card }) => {
    const parent = doc.nodes[id].parentId;
    return {
      ref: refOf.get(id)!,
      id,
      kind: card.kind,
      title: card.title,
      parentRef: parent ? (refOf.get(parent) ?? null) : null,
      depth: depthOf(doc, id),
      childTitles: childCards(doc, id).map((c) => cardOf(doc, c)?.title ?? ""),
    };
  });
  // Quotes no card has yet first, then the rest, up to what one call takes.
  const on = new Set(cards.flatMap(({ card }) => card.evidence.flatMap((e) => (e.kind === "quote" && e.sourceId && e.span ? [`${e.sourceId}:${e.span[0]}:${e.span[1]}`] : []))));
  const all = sources.flatMap((s) => s.quotes.map((q) => ({ s, q })));
  const placed = (x: (typeof all)[number]) => on.has(`${x.s.id}:${x.q.span[0]}:${x.q.span[1]}`);
  const picked = [...all.filter((x) => !placed(x)), ...all.filter(placed)].slice(0, MAX_QUOTES);
  const quotes: SynthQuote[] = picked.map((x, i) => ({ ref: `q${i + 1}`, sourceId: x.s.id, quoteId: x.q.id, span: x.q.span, ...(x.q.dismissed?.length ? { dismissed: x.q.dismissed } : {}) }));
  const refByQuote = new Map(picked.map((x, i) => [x.q.id, `q${i + 1}`]));
  const root = boardTree(doc);
  const body = {
    stage: "synthesize" as const,
    product: productLine(doc),
    tree: synthCards.map((c) => ({ id: c.ref, parent: c.parentRef, kind: c.kind, title: c.title.slice(0, 400), quotes: cardOf(doc, c.id)?.evidence.filter((e) => e.kind === "quote").length ?? 0 })),
    quotes: picked.map((x, i) => ({ id: `q${i + 1}`, text: x.q.text.slice(0, 1200), source: x.s.title.slice(0, 300), speaker: x.q.speaker?.slice(0, 80) ?? null, kind: x.q.kind })),
    needs: sources
      .flatMap((s) => s.needs.map((n) => ({ title: n.title.slice(0, 200), quoteIds: n.quoteIds.map((id) => refByQuote.get(id)).filter((x): x is string => !!x).slice(0, 30) })))
      .filter((n) => n.quoteIds.length)
      .slice(0, 60),
  };
  const ctx: SynthContext = {
    cards: synthCards,
    quotes,
    outcomeRef: root ? (refOf.get(root) ?? null) : null,
    has: (cardId, q) => {
      const c = cardOf(studio().doc, cardId);
      return !!c && hasQuote(c, q.sourceId, q.span);
    },
  };
  return { body, ctx };
}

/** Have Qalam AI map the sources' quotes to the tree; its proposals open for review. */
export async function mapQuotes(opts: { sourceIds?: string[] } = {}, given?: AbortController) {
  const doc = studio().doc;
  if (!allCards(doc).length) return void useSources.setState({ notice: { text: "Name the outcome you want to move first: quotes are mapped to a tree." } });
  if (await offline()) return void useSources.setState({ notice: { text: "Qalam AI isn't set up here. Drag quotes onto cards to attach them yourself." } });
  const all = useSources.getState().list;
  // The new sources' quotes first; the others' fill up the call.
  const want = new Set(opts.sourceIds ?? []);
  const sources = [...all.filter((s) => want.has(s.id)), ...all.filter((s) => !want.has(s.id))].filter((s) => s.quotes.length);
  if (!sources.length) return void useSources.setState({ notice: { text: "No quotes to map yet: add a source, and Qalam AI picks out what customers said." } });
  const ctrl = given ?? begin();
  const { body, ctx } = synthesizeInput(doc, sources);
  useSources.setState({ mapping: { started: Date.now(), tokens: 0 } });
  try {
    const { data } = await callAI<unknown>(PATH, body, (tokens) => useSources.setState((s) => (s.mapping ? { mapping: { ...s.mapping, tokens } } : {})), ctrl.signal);
    const proposals = sanitizeSynthesis(data, ctx);
    if (!proposals.length) feedback("Qalam AI found nothing to add: the tree already reflects these quotes", { id: "discovery.map" });
    else startReview(proposals);
  } catch (e) {
    if ((e as Error).name !== "AbortError") useSources.setState({ notice: { text: `Qalam AI couldn't map the quotes: ${message(e)}` } });
  } finally {
    useSources.setState({ mapping: null });
    if (!given) end(ctrl);
  }
}
