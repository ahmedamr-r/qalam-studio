import { nanoid } from "nanoid";
import { pickStepCall, searchStepCall, type SearcherContext } from "@/ai/searcher";
import { structured } from "@/ai/server";
import { connectorDef } from "@/connectors/catalog";
import { chartText, findsOf, firstSearches, holdsOf, LIMITS, mergeFound, originOf, resultsToSend, stepPicks, toolsToLook, wordsFor, type Candidate, type FoundIn, type KnownSource, type LookResult, type LookTool, type Picked, type ToolRun } from "@/connectors/everywhere";
import type { InsightNumbers } from "@/connectors/numbers";
import type { Hit } from "@/connectors/recipes";
import { findIn, nearPassages, searchedAlone, toolsForAsk, type FindDeps, type ToolAsk } from "@/connectors/suggest";
import type { ConnectorState, ImportResult } from "@/org/connectors";
import type { Terms } from "@/terms/types";
import { captureSource } from "../capture";
import { labOn } from "../lab";
import type { OrgStore } from "../org/store";
import { browseConnector, connectorsView, importItems, readItems, searchMany } from ".";
import { readInsight, readInsightsMany, searchInsights, searchInsightsMany } from "./numbers";

/*
 * One question looked for in every connected tool at once (src/connectors/everywhere.ts says how):
 * code sends a small searcher to each tool, side by side, each with its own time; a searcher's steps
 * are small calls that see only its own tool and results, and code runs its searches on the tool's
 * read-only search. What they found is merged, the same item kept once, and nothing is taken in
 * until the person picks: then `bringIn` takes the picks in as any material is (importItems,
 * captureSource), a saved chart as a source holding its numbers as the tool gave them.
 */

export interface LookDeps {
  structured: typeof structured;
  connectors: () => Promise<ConnectorState[]>;
  /** A tool's searches in one go: each one's results, or why it failed. */
  search: (tool: LookTool, words: readonly string[], signal: AbortSignal) => Promise<(Hit[] | Error)[]>;
  /** Picked items' words, for the passages nearest the question (null: nothing came back). */
  read: (tool: LookTool, hits: readonly Hit[]) => Promise<(string | null)[]>;
  /** Picked charts' numbers, as the tool gave them. */
  numbers: (tool: LookTool, hits: readonly Hit[], signal: AbortSignal) => Promise<(InsightNumbers | null)[]>;
  known: () => Promise<KnownSource[]>;
  terms: () => Promise<Terms | null>;
  now: () => number;
  /** What each look did, kept in chats/everywhere/traces. */
  trace?: (t: Record<string, unknown>) => Promise<void>;
  /** Other times than `LIMITS`' (tests). */
  times?: Partial<Record<"directMs" | "slowMs" | "allMs", number>>;
  /** The connector groups this copy shows, as its lab says (none: the window's src/lab.ts, as tests set it). */
  shown?: () => Promise<(group: string) => boolean>;
}

/** The connector groups shown here, as the core reads its lab (docs and analytics always; the rest with `connectors`). */
export async function shownHere(): Promise<(group: string) => boolean> {
  const on = await labOn();
  return (group) => group === "docs" || group === "numbers" || on === true || on.includes("connectors");
}

/** An interview's lookups: its own, and a look in their tools where one can be offered here. */
export async function lookupKinds<K extends string>(base: readonly K[]): Promise<readonly (K | "tools")[]> {
  return (await canLookInTools().catch(() => false)) ? [...base, "tools"] : base;
}

/** Whether a conversation may offer a look in their tools: the look is on here and a tool is connected to look in. Kept a minute. */
let toolsKnown: { at: number; on: boolean } | null = null;
export async function canLookInTools(now = Date.now()): Promise<boolean> {
  if (toolsKnown && now - toolsKnown.at < 60_000) return toolsKnown.on;
  const on = await labOn();
  const yes = (on === true || on.includes("everywhere")) && toolsToLook((await connectorsView()).connectors, undefined, await shownHere()).length > 0;
  toolsKnown = { at: now, on: yes };
  return yes;
}

export const lookDeps = (store: OrgStore): LookDeps => ({
  structured,
  connectors: async () => (await connectorsView()).connectors,
  search: (t, words, signal) => (t.holds === "charts" ? searchInsightsMany(t.id, words, signal) : searchMany(t.id, words, signal)),
  read: async (t, hits) => (await readItems(t.id, [...hits], () => {}, store)).map((it) => it.ingested?.text ?? null),
  numbers: (t, hits, signal) => readInsightsMany(t.id, hits.map((h) => h.id), signal),
  known: async () => (await store.listSources()).map((s) => ({ id: s.id, origin: s.origin })),
  terms: () => store.getTerms(),
  now: Date.now,
  trace: (t) => store.putTrace({ id: nanoid(10), projectId: "everywhere", ...t } as { id: string; projectId: string }),
  shown: shownHere,
});

export interface LookRequest {
  about: string;
  /** Only these tools (default: every one connected). */
  tools?: readonly string[];
}

/** One line per searcher as it goes (`{type: "tool", run}`), then what they found together. */
export async function lookEverywhere(req: LookRequest, send: (line: Record<string, unknown>) => void, signal: AbortSignal | undefined, deps: LookDeps): Promise<LookResult> {
  const about = req.about.replace(/\s+/g, " ").trim().slice(0, 600);
  const tools = toolsToLook(await deps.connectors(), req.tools, deps.shown ? await deps.shown() : undefined);
  if (!tools.length) throw new Error("No tool is connected to look in yet. Connections connects one.");
  const [terms, known] = await Promise.all([deps.terms().catch(() => null), deps.known().catch(() => [])]);
  const words = wordsFor(terms, about);
  const all = new AbortController();
  const stop = () => all.abort(STOPPED);
  if (signal?.aborted) stop();
  signal?.addEventListener("abort", stop, { once: true });
  // The whole look's time: every searcher still going hands back what it has.
  const whole = setTimeout(() => all.abort(LATE), deps.times?.allMs ?? LIMITS.allMs);
  const runs = new Map<string, ToolRun>();
  const tell = (r: ToolRun) => {
    runs.set(r.tool, r);
    send({ type: "tool", run: r });
  };
  try {
    const found = await Promise.all(tools.map((t) => searcher(t, about, words, tell, all.signal, deps)));
    if (signal?.aborted) throw Object.assign(new Error("Stopped."), { name: "AbortError" });
    const labels = new Map(tools.map((t) => [t.id, t.label]));
    const result: LookResult = { about, at: deps.now(), runs: tools.map((t) => runs.get(t.id)!), candidates: mergeFound(found, known, (id) => labels.get(id) ?? id) };
    await deps.trace?.({ kind: "look", at: result.at, about, words, runs: result.runs, kept: result.candidates.map((c) => ({ tool: c.tool, id: c.hit.id, title: c.hit.title, picked: c.picked, ...(c.inSources ? { inSources: c.inSources } : {}) })) }).catch(() => {});
    return result;
  } finally {
    clearTimeout(whole);
    signal?.removeEventListener("abort", stop);
  }
}

/** Why a searcher was cut short: its time (or the look's) ran out, or the person stopped the look. */
const LATE = "late";
const STOPPED = "stopped";

/** Waits for `p`, or for the signal (the searcher's time, or Stop): a tool call that hangs doesn't hold the look up. */
function until<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  const why = () => Object.assign(new Error(signal.reason === LATE ? "It took too long." : "Stopped."), { name: "AbortError" });
  if (signal.aborted) return Promise.reject(why());
  return new Promise<T>((resolve, reject) => {
    const off = () => reject(why());
    signal.addEventListener("abort", off, { once: true });
    p.then(
      (v) => (signal.removeEventListener("abort", off), resolve(v)),
      (e) => (signal.removeEventListener("abort", off), reject(e)),
    );
  });
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * One tool's searcher. It never throws: a failure, its time running out or Stop is the run's state,
 * and it hands back what it found by then (its picks, else what its searches found, unticked).
 */
async function searcher(t: LookTool, about: string, words: readonly string[], tell: (r: ToolRun) => void, outer: AbortSignal, d: LookDeps): Promise<Candidate[]> {
  const started = d.now();
  const limit = t.slow ? (d.times?.slowMs ?? LIMITS.slowMs) : (d.times?.directMs ?? LIMITS.directMs);
  const own = new AbortController();
  const late = setTimeout(() => own.abort(LATE), limit);
  const quit = () => own.abort(outer.reason);
  if (outer.aborted) quit();
  outer.addEventListener("abort", quit, { once: true });
  const run: ToolRun = { tool: t.id, label: t.label, holds: t.holds, slow: t.slow, state: "searching", searched: [], seen: 0, calls: 0, picked: 0 };
  const update = (p: Partial<ToolRun>) => {
    Object.assign(run, p);
    tell({ ...run, searched: [...run.searched] });
  };
  const ctx: SearcherContext = { about, tool: t, words };
  const lists: Hit[][] = [];
  let seen: Hit[] = [];
  let picks: Picked[] = [];
  let finds: Candidate[] | null = null;
  const ask = async <T>(call: Parameters<typeof d.structured>[0]): Promise<T> => {
    if (run.calls >= LIMITS.calls) throw new Error("It used every step it has.");
    run.calls++;
    return (await until(d.structured<T>(call, own.signal), own.signal)).data;
  };
  const searchFor = async (queries: string[]) => {
    run.searched.push(...queries);
    update({ state: "searching" });
    const answers = await until(d.search(t, queries, own.signal), own.signal);
    const ok = answers.filter((a): a is Hit[] => Array.isArray(a));
    // Every search failing, with nothing found before, says why; one failing among others doesn't.
    if (!ok.length && !lists.length) throw answers.find((a): a is Error => a instanceof Error) ?? new Error(`${t.label} didn't search it.`);
    lists.push(...ok);
    seen = resultsToSend(lists);
    update({ seen: seen.length });
  };
  const max = t.holds === "charts" ? LIMITS.charts : LIMITS.picks;
  /** A pick step; `again`: searches it may still write when nothing fits (only while there's time for them). */
  const pickStep = async (again: number) => {
    if (!seen.length && !again) return { picks: [] as Picked[], again: [] as string[] };
    update({ state: "picking" });
    return stepPicks(await ask(pickStepCall({ ...ctx, searched: run.searched, results: seen, max, again })), seen, { max, again, searched: run.searched });
  };
  update({});
  try {
    await searchFor(firstSearches(await ask(searchStepCall(ctx)), about));
    // One retry, only while there's time for it: through Claude Code each round of searches is a run of its own (about a minute), so none.
    const retry = !t.slow && d.now() - started < limit / 2 ? LIMITS.again : 0;
    let step = await pickStep(retry);
    if (!step.picks.length && step.again.length) {
      await searchFor(step.again);
      step = await pickStep(0);
    }
    picks = step.picks;
    finds = findsOf(t.id, picks, seen);
    if (picks.length && t.holds === "charts") {
      update({ state: "reading", picked: picks.length });
      const numbers = await until(d.numbers(t, picks.map((p) => p.hit), own.signal), own.signal);
      const by = new Map(picks.map((p, i) => [p.hit.id, numbers[i]]));
      finds = finds.map((c) => {
        const n = by.get(c.hit.id);
        return n?.series.length ? { ...c, numbers: n.series.map((s) => ({ label: s.label, value: s.value })) } : c;
      });
    } else if (picks.length && !t.slow) {
      // The top picks' own words nearest the question and the searcher's searches (its words for it in this tool), read by code: no tokens.
      update({ state: "reading", picked: picks.length });
      const top = picks.slice(0, LIMITS.previews).map((p) => p.hit);
      const texts = await until(d.read(t, top), own.signal).catch(() => top.map(() => null));
      const by = new Map(top.map((h, i) => [h.id, texts[i]]));
      const asked = [about, ...run.searched].join(" ");
      finds = finds.map((c) => {
        const text = by.get(c.hit.id);
        const passages = text ? nearPassages(text, asked, 2) : [];
        return passages.length ? { ...c, passages } : c;
      });
    }
    update({ state: "done", picked: picks.length, ms: d.now() - started });
    return finds;
  } catch (e) {
    const sofar = finds ?? findsOf(t.id, picks, seen);
    if (own.signal.aborted && own.signal.reason !== LATE) update({ state: "stopped", ms: d.now() - started });
    else if (own.signal.aborted) update({ state: "late", why: "It took too long, so this is what it found by then.", picked: picks.length, ms: d.now() - started });
    else update({ state: "failed", why: message(e), picked: picks.length, ms: d.now() - started });
    return sofar;
  } finally {
    clearTimeout(late);
    outer.removeEventListener("abort", quit);
  }
}

// ---------------------------------------------------------------------------
// Bringing the picks in

export interface BringPick {
  tool: string;
  hit: Hit;
}

export interface BringDeps {
  importItems: typeof importItems;
  readChart: (tool: string, ref: string) => Promise<InsightNumbers>;
  capture: typeof captureSource;
  now: () => number;
}

const bringDeps: BringDeps = { importItems, readChart: readInsight, capture: captureSource, now: Date.now };

/**
 * The ticked items taken in, tool by tool, as anything brought from a tool is (read, kept, filed and
 * placed; `scope` places them only under a card). A saved chart is read again and kept as a source
 * of what was measured: its name and numbers as the tool gave them, with when.
 */
export async function bringIn(store: OrgStore, picks: readonly BringPick[], emit: (label: string) => void, o: { scope?: Record<string, string[]>; product?: string | null } = {}, d: BringDeps = bringDeps): Promise<ImportResult & { sources: string[]; pages: string[] }> {
  const out: ImportResult & { sources: string[]; pages: string[] } = { added: [], skipped: [], failed: [], sources: [], pages: [] };
  const byTool = new Map<string, Hit[]>();
  for (const p of picks) byTool.set(p.tool, [...(byTool.get(p.tool) ?? []), p.hit]);
  const scope = { ...(o.scope ? { scope: o.scope } : {}), ...(o.product !== undefined ? { product: o.product } : {}) };
  for (const [tool, hits] of byTool) {
    const label = connectorDef(tool)?.label ?? tool;
    if (holdsOf(tool) !== "charts") {
      const r = await d.importItems(store, tool, hits, emit, scope).catch((e: unknown): ImportResult => ({ added: [], skipped: [], failed: hits.map((h) => ({ title: h.title, why: message(e) })) }));
      out.added.push(...r.added);
      out.skipped.push(...r.skipped);
      out.failed.push(...r.failed);
      out.sources.push(...(r.sources ?? []));
      for (const p of r.pages ?? []) if (!out.pages.includes(p)) out.pages.push(p);
      continue;
    }
    for (const hit of hits) {
      try {
        emit(`Reading “${hit.title}” from ${label}`);
        const numbers = await d.readChart(tool, hit.id);
        if (!numbers.series.length && !numbers.steps?.length) {
          out.failed.push({ title: hit.title, why: "It has no number Qalam can read." });
          continue;
        }
        const text = chartText({ title: hit.title, tool: label, numbers, at: d.now(), ...(hit.snippet ? { description: hit.snippet } : {}) });
        emit(`Taking in “${hit.title}”`);
        const r = await d.capture(store, { kind: "connector", title: numbers.name ?? hit.title, origin: originOf(tool, { id: hit.id, url: hit.url ?? numbers.url }), text }, { emit, basis: "measured", ...scope });
        out.added.push(hit.title);
        out.sources.push(r.sourceId);
        for (const p of r.filed?.pages ?? []) if (!out.pages.includes(p.id)) out.pages.push(p.id);
      } catch (e) {
        out.failed.push({ title: hit.title, why: message(e) });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Under a question: every tool searched with its words, no model call

const findDeps = (store?: OrgStore): FindDeps => ({
  browse: (id, query) => browseConnector(id, { query }),
  read: async (id, hits) => (await readItems(id, hits, () => {}, store)).map((it) => ({ id: it.id, text: it.ingested?.text })),
  charts: (id, query) => searchInsights(id, query),
  numbers: (id, ref) => readInsight(id, ref),
});

/**
 * What every tool a question's kind fits has on it, in one request: each tool Qalam reaches itself
 * searched with the question's words, as `findIn` searches one, side by side. A passage two tools
 * both have is shown once.
 */
export async function findEverywhere(ask: ToolAsk, question: string, o: { store?: OrgStore; connectors?: () => Promise<ConnectorState[]>; deps?: FindDeps } = {}): Promise<FoundIn[]> {
  const connectors = await (o.connectors ?? (async () => (await connectorsView()).connectors))();
  const tools = toolsForAsk(ask, connectors).filter(searchedAlone);
  const deps = o.deps ?? findDeps(o.store);
  const found = await Promise.all(tools.map((c) => findIn(c, ask, question, deps).then((finds) => ({ tool: c.id, label: c.label, finds }), () => ({ tool: c.id, label: c.label, finds: null }))));
  const shown = new Set<string>();
  return found.map((f) => ({
    ...f,
    finds: f.finds?.filter((x) => {
      const key = x.text.replace(/\s+/g, " ").trim().toLowerCase();
      if (shown.has(key)) return false;
      shown.add(key);
      return true;
    }) ?? null,
  }));
}
