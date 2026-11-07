import { connectorShown } from "@/lab";
import type { ConnectorState } from "@/org/connectors";
import type { Terms } from "@/terms/types";
import { sanitizePicks } from "./look";
import type { InsightNumbers } from "./numbers";
import type { Hit, ToolCall } from "./recipes";
import type { ToolFind } from "./suggest";

/*
 * Looking in every connected tool at once (pure). Code sends one small searcher to each tool that
 * holds material or numbers: it hears only the question, its own tool's name, how that tool's search
 * works and the project's words the question uses, and sees only its own results. Its steps are
 * structured calls that code checks: it writes searches, code runs them on the tool's read-only
 * search, then it picks from what came back by ids it was sent, or, once and only when nothing
 * fits, writes other searches. The searchers run side by side; code merges what they found, drops
 * the same item found twice, and marks what's already a source. Nothing is taken in until the
 * person picks.
 */

/** What a tool holds, which says how its searcher words a search. */
export type Holds = "docs" | "messages" | "conversations" | "charts";

const HOLDS: Readonly<Record<string, Holds>> = { notion: "docs", drive: "docs", confluence: "docs", slack: "messages", intercom: "conversations", posthog: "charts", amplitude: "charts", mixpanel: "charts" };

export const holdsOf = (id: string): Holds | undefined => HOLDS[id];

/** The limits each searcher and each look run under (Ahmed's pick, 7 November 2026). */
export const LIMITS = {
  /** Model calls per searcher: its searches, its pick, and one retry only when nothing fits. */
  calls: 3,
  /** Searches its first step writes, and its retry. */
  first: 3,
  again: 2,
  /** Results its pick is sent. */
  seen: 30,
  /** Its picks: documents, and saved charts (each read by code). */
  picks: 5,
  charts: 3,
  /** Found and not picked, shown folded under its picks. */
  more: 5,
  /** Picks read for the passages nearest the question, where Qalam reaches the tool itself. */
  previews: 2,
  /** How long a searcher may take: a tool Qalam reaches itself, and one through Claude Code (each run starts its servers). */
  directMs: 45_000,
  slowMs: 150_000,
  /** The whole look. */
  allMs: 180_000,
} as const;

/** A tool a look sends a searcher to. */
export interface LookTool {
  id: string;
  label: string;
  holds: Holds;
  /** Reached through Claude Code: a run takes about a minute. */
  slow: boolean;
}

const connected = (c: Pick<ConnectorState, "via" | "tone">) => !!c.via && c.tone === "ok";

/**
 * The tools a look sends searchers to: connected ones that hold material or numbers and that this copy
 * shows (`shown`: the core passes what its lab says, src/lab.ts being the window's), in Connections' order.
 */
export function toolsToLook(connectors: readonly ConnectorState[], only?: readonly string[], shown: (group: string) => boolean = connectorShown): LookTool[] {
  return connectors.flatMap((c) => {
    const holds = holdsOf(c.id);
    if (!holds || !connected(c) || !shown(c.group) || (only && !only.includes(c.id))) return [];
    if (holds === "charts" ? !c.numbers : !c.imports) return [];
    return [{ id: c.id, label: c.label, holds, slow: c.via === "claude-code" }];
  });
}

// ---------------------------------------------------------------------------
// A searcher's steps, as code keeps them

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const one = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const lower = (s: string) => s.toLowerCase();

/** A step's searches: its own, each once and none it ran already, cut to size. */
export function stepSearches(raw: unknown, o: { max: number; searched: readonly string[] }): string[] {
  const list = rec(raw).searches ?? rec(raw).again;
  const seen = new Set(o.searched.map(lower));
  const out: string[] = [];
  for (const s of Array.isArray(list) ? list : []) {
    const words = one(s).slice(0, 80);
    if (words.length < 2 || seen.has(lower(words))) continue;
    seen.add(lower(words));
    out.push(words);
    if (out.length >= o.max) break;
  }
  return out;
}

/** The first step's searches, else the question's own words. */
export function firstSearches(raw: unknown, about: string): string[] {
  const kept = stepSearches(raw, { max: LIMITS.first, searched: [] });
  return kept.length ? kept : [one(about).slice(0, 80)];
}

export interface Picked {
  hit: Hit;
  why?: string;
}

/**
 * A pick step: results it was sent, by id, each once, at most `max`, with a why only where its
 * numbers are in the result; or, where it may still search, other searches when nothing fits.
 * Picks win: a step that picks something doesn't search again.
 */
export function stepPicks(raw: unknown, sent: readonly Hit[], o: { max: number; again: number; searched: readonly string[] }): { picks: Picked[]; again: string[] } {
  const picks = sanitizePicks(raw, sent)
    .slice(0, o.max)
    .map(({ why, ...hit }) => ({ hit, ...(why ? { why } : {}) }));
  if (picks.length || o.again <= 0) return { picks, again: [] };
  return { picks, again: stepSearches({ searches: rec(raw).again }, { max: o.again, searched: o.searched }) };
}

/** The results a pick is sent: each once by id, documents and charts it can read (no folders, nothing it can't read), at most `LIMITS.seen`. */
export function resultsToSend(lists: readonly (readonly Hit[])[]): Hit[] {
  const out = new Map<string, Hit>();
  for (const list of lists) for (const h of list) if (!h.folder && h.type !== "other" && !out.has(h.id)) out.set(h.id, h);
  return [...out.values()].slice(0, LIMITS.seen);
}

const escapeRe = (s: string) => s.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");

/** The project's words a question uses (a term, or a word to avoid for it): a searcher may search the team's word. */
export function wordsFor(terms: Terms | null | undefined, about: string): string[] {
  const hay = lower(about);
  // At the start of a word: "cart" is used in "carts", never inside "scarted".
  const has = (w: string) => {
    const x = lower(w.trim());
    return x.length > 1 && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(x)}`, "u").test(hay);
  };
  return (terms?.terms ?? [])
    .filter((t) => [t.term, ...t.avoid].some(has))
    .slice(0, 6)
    .map((t) => `${one(t.term)}${t.avoid.length ? ` (not: ${t.avoid.map(one).join(", ")})` : ""}: ${one(t.means).slice(0, 140)}`);
}

// ---------------------------------------------------------------------------
// What a look found

/** Something a searcher found, for the person to tick or leave. */
export interface Candidate {
  /** Within a look: the tool and the item's id. */
  key: string;
  tool: string;
  /** The item as the tool gave it. */
  hit: Hit;
  /** Where it came from, as a source keeps it (its address, else the tool and its id). */
  origin: string;
  /** Qalam AI picked it (ticked); otherwise the tool's search found it and the searcher left it. */
  picked: boolean;
  /** Qalam AI's line on why it fits, its numbers checked against the result. */
  why?: string;
  /** Its own words nearest the question, read by code. */
  passages?: string[];
  /** A saved chart's numbers, as the tool gave them. */
  numbers?: { label: string; value: number }[];
  /** A source already holding it: not taken in twice. */
  inSources?: string;
  /** Other tools the same item was found in. */
  also?: string[];
}

/** How one searcher went. */
export interface ToolRun {
  tool: string;
  label: string;
  holds: Holds;
  slow: boolean;
  state: "searching" | "picking" | "reading" | "done" | "failed" | "late" | "stopped";
  /** The searches it ran, in order. */
  searched: string[];
  /** Results it saw. */
  seen: number;
  /** Its model calls. */
  calls: number;
  picked: number;
  ms?: number;
  /** Why it failed, in the tool's or Qalam's words. */
  why?: string;
}

export interface LookResult {
  about: string;
  at: number;
  runs: ToolRun[];
  candidates: Candidate[];
}

/** Under a question, what one tool's search had on it with no model call (null: its search failed). */
export interface FoundIn {
  tool: string;
  label: string;
  finds: ToolFind[] | null;
}

/** Where an item came from, exactly as `importItems` keeps it on its source. */
export const originOf = (tool: string, hit: Pick<Hit, "id" | "url">) => hit.url ?? `${tool}:${hit.id}`;

/** An address as the same item has it everywhere: no fragment, no tracking, the host in lower case, a Google file by its id. */
export function canonAddress(origin: string): string {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return origin.trim();
  }
  if (!/^https?:$/.test(u.protocol)) return origin.trim();
  const google = /^\/(document|spreadsheets|presentation|file)\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{10,})/.exec(u.pathname);
  if (/(^|\.)google\.com$/.test(u.hostname) && google) return `google:${google[1]}:${google[2]}`;
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (/^utm_|^(pvs|source|src|ref|usp|sharing)$/i.test(k)) u.searchParams.delete(k);
  const search = u.searchParams.toString();
  return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${search ? `?${search}` : ""}`;
}

/** A source already kept: its id and where it came from. */
export interface KnownSource {
  id: string;
  origin?: string;
}

/**
 * Every searcher's finds as one list, in Connections' order of the tools and each searcher's own
 * order: the same item found again (its address, wherever it was found) kept once, saying where else
 * it was; one already a source marked so and left unticked.
 */
export function mergeFound(found: readonly (readonly Candidate[])[], known: readonly KnownSource[], labelOf: (tool: string) => string = (t) => t): Candidate[] {
  const kept = new Map<string, Candidate>();
  const sources = new Map<string, string>();
  for (const s of known) if (s.origin) sources.set(canonAddress(s.origin), s.id);
  for (const list of found)
    for (const c of list) {
      const key = canonAddress(c.origin);
      const had = kept.get(key);
      if (had) {
        if (had.tool !== c.tool && !had.also?.includes(labelOf(c.tool))) had.also = [...(had.also ?? []), labelOf(c.tool)];
        if (c.picked && !had.picked && !had.inSources) had.picked = true;
        continue;
      }
      const inSources = sources.get(key);
      kept.set(key, { ...c, ...(inSources ? { inSources, picked: false } : {}) });
    }
  return [...kept.values()];
}

/** A searcher's finds: its picks (ticked), then what its tool found that it left, folded. */
export function findsOf(tool: string, picks: readonly Picked[], seen: readonly Hit[]): Candidate[] {
  const chosen = new Set(picks.map((p) => p.hit.id));
  const picked = picks.map((p): Candidate => ({ key: `${tool}:${p.hit.id}`, tool, hit: p.hit, origin: originOf(tool, p.hit), picked: true, ...(p.why ? { why: p.why } : {}) }));
  const more = seen
    .filter((h) => !chosen.has(h.id))
    .slice(0, LIMITS.more)
    .map((hit): Candidate => ({ key: `${tool}:${hit.id}`, tool, hit, origin: originOf(tool, hit), picked: false }));
  return [...picked, ...more];
}

// ---------------------------------------------------------------------------
// Read-only

/**
 * The tools Qalam may call on each tool's server: its searches and its reads, nothing that writes.
 * The recipes plan only these; a planned call that isn't one is refused before it's made, in every
 * flow, not only a look. PostHog's server has one tool, `exec`, so its commands are checked instead.
 * Mixpanel's real tool names aren't known yet (its calls are fitted to what its server lists), so
 * only what its tool's name says is checked there.
 */
export const READ_TOOLS: Readonly<Record<string, readonly string[]>> = {
  notion: ["notion-search", "notion-fetch", "notion-list-recent-pages", "notion-list-private-pages", "notion-list-shared-pages"],
  confluence: ["getAccessibleAtlassianResources", "searchConfluenceUsingCql", "getConfluencePage"],
  slack: ["slack_search_public_and_private", "slack_read_thread"],
  intercom: ["search", "fetch"],
  amplitude: ["search_amp_entities", "get_amplitude_charts", "get_amplitude_context", "query_amplitude_data"],
  posthog: ["exec"],
};

/** PostHog's read commands: listing saved charts, reading one, listing events and counting one. */
const POSTHOG_READS = /^call --json (insights-list|insight-query|read-data-schema|query-trends) \{/;

/** Words in a tool's name that say it changes something. */
const WRITES = new Set(["create", "update", "delete", "remove", "save", "rename", "set", "share", "move", "archive", "edit", "write", "post", "send", "manage", "cancel", "restore", "duplicate", "upload", "publish", "add", "invite", "resolve", "convert", "spawn", "stop", "link", "track", "complete", "react"]);

/** Whether a tool's name says it writes ("save_chart_edits", "notion-update-page", "createJiraIssue"). */
export function looksLikeWrite(name: string): boolean {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z]+/)
    .some((w) => WRITES.has(w.toLowerCase()));
}

/** Whether a look may make this call: a read tool its server lists for it, and for PostHog a read command. */
export function readOnly(tool: string, call: Pick<ToolCall, "tool" | "args">): boolean {
  if (looksLikeWrite(call.tool)) return false;
  if (tool === "posthog") return call.tool === "exec" && POSTHOG_READS.test(String(call.args?.command ?? ""));
  const listed = READ_TOOLS[tool];
  return !listed || listed.includes(call.tool);
}

// ---------------------------------------------------------------------------
// A saved chart as a source

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** A saved chart's numbers as a source's words: its name and what it measures as the tool gave them, when they were read. */
export function chartText(o: { title: string; tool: string; numbers: InsightNumbers; at: number; description?: string }): string {
  const name = one(o.numbers.name) || one(o.title);
  const lines = [`${name}: a saved chart in ${o.tool}, read on ${DAY.format(new Date(o.at))}.`];
  if (o.description) lines.push(one(o.description));
  for (const s of o.numbers.series) lines.push(`${one(s.label) || name}: ${s.value}`);
  if (o.numbers.steps?.length) lines.push(`Its steps: ${o.numbers.steps.map((s) => `${one(s.label)} ${s.count}`).join(", ")}`);
  return lines.join("\n");
}
