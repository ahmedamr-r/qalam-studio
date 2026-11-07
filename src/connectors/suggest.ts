import { sharedWords } from "@/discovery/near";
import { connectorShown } from "@/lab";
import type { ConnectorState } from "@/org/connectors";
import type { InsightNumbers } from "./numbers";
import type { Hit } from "./recipes";

/*
 * A question that a tool could answer better than memory (pure): Qalam AI, or code for its own
 * questions, says what kind of tool and what to look for; code keeps it only as a kind it knows.
 * What comes back goes in the answer, for the person to read and change before it's sent.
 */

export type ToolKind = "numbers" | "docs";

export interface ToolAsk {
  kind: ToolKind;
  /** Words to search the tool for. */
  lookFor?: string;
}

/** The schema's fields for it, in a question the model writes. */
export const TOOL_FIELDS = {
  from: {
    type: "string",
    enum: ["none", "numbers", "docs"],
    description: "Where a better answer than their memory lives, if anywhere: \"numbers\" when the answer is a figure a product analytics tool tracks (a rate, a count, a funnel), \"docs\" when it's likely written down in their docs or notes (a strategy, a research summary, a spec). \"none\" for what only they can say: an opinion, a choice, a preference",
  },
  look_for: { type: "string", description: "With \"numbers\" or \"docs\": 2 to 5 words to search that tool for. Otherwise empty" },
} as const;

/** The model's fields, checked. */
export function toolAsk(from: unknown, lookFor: unknown): ToolAsk | undefined {
  if (from !== "numbers" && from !== "docs") return undefined;
  const words = typeof lookFor === "string" ? lookFor.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  return { kind: from, ...(words ? { lookFor: words } : {}) };
}

export const toolConnected = (c: Pick<ConnectorState, "via" | "tone">) => !!c.via && c.tone === "ok";

/** The tools to offer for it: connected ones first, then those Claude Code has, then the rest; never one this copy of Qalam can't reach. */
export function toolsForAsk(ask: ToolAsk, connectors: readonly ConnectorState[]): ConnectorState[] {
  const fits = (c: ConnectorState) => connectorShown(c.group) && (ask.kind === "numbers" ? c.numbers : c.group === "docs" && c.imports) && (!c.needsClient || !!c.via);
  const rank = (c: ConnectorState) => (toolConnected(c) ? 0 : c.claudeCode?.status === "connected" ? 1 : 2);
  return connectors
    .map((c, i) => ({ c, i }))
    .filter((x) => fits(x.c))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map((x) => x.c);
}

/** Longest passage shown, and put in an answer. */
const PASSAGE_MAX = 400;

/** The inline marks a tool's text may carry (Notion's <b>, <span color>, <mention-page>), taken off a passage: its words stay. */
const INLINE_TAG = /<\/?(?:b|i|u|s|em|strong|span|br|code|mark|sup|sub|a|mention-[a-z]+)\b[^<>]*>/gi;

/** A document's passages nearest what was asked, its own words, most shared words first (with none sharing, its first ones). */
export function passagesFor(text: string, asked: string, count = 4): string[] {
  const passages = text
    .split(/\n\s*\n|\n(?=[-*#] )/)
    .map((p) => p.replace(INLINE_TAG, "").replace(/\s+/g, " ").replace(/^[-*#]+ /, "").trim())
    .filter((p) => p.length >= 30)
    .map((p) => (p.length > PASSAGE_MAX ? `${p.slice(0, p.lastIndexOf(" ", PASSAGE_MAX))}…` : p));
  return passages
    .map((p, i) => ({ p, i, n: sharedWords(p, asked) }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, count)
    .map((x) => x.p);
}

/** A number as an answer: the number first (it's what's read back), then what it is and where it was read. */
export function numberLine(value: number, o: { series: string; chart: string; tool: string }): string {
  const what = o.series && o.series !== o.chart && o.series !== "Value" ? `${o.series}, ${o.chart}` : o.chart;
  return `${value} (${what}, from ${o.tool})`;
}

/** A passage as an answer: its words, and the page and tool they're from. */
export const passageLine = (passage: string, o: { title: string; tool: string }) => `“${passage}” (${o.title}, from ${o.tool})`;

// ---------------------------------------------------------------------------
// Searched on its own: what a connected tool has on a question, listed under it to pick from

/**
 * A tool searched as soon as a question needing it shows: one Qalam reaches itself (its own sign-in, a
 * token, Drive's API), which costs no tokens and answers in seconds. Through Claude Code a call takes
 * about a minute, so that one waits for a press, and so does counting an event (it leaves a draft in
 * Amplitude).
 */
export const searchedAlone = (c: Pick<ConnectorState, "via" | "tone">) => toolConnected(c) && c.via !== "claude-code";

/** What a tool had on a question: its words (a passage, or a number), where it's from, and the line that goes in the answer when it's picked. */
export interface ToolFind {
  key: string;
  text: string;
  from: string;
  line: string;
}

/** The calls a search needs, from the window. */
export interface FindDeps {
  browse(id: string, query: string): Promise<Hit[]>;
  read(id: string, hits: Hit[]): Promise<{ id: string; text?: string }[]>;
  charts(id: string, query: string): Promise<Hit[]>;
  numbers(id: string, ref: string): Promise<InsightNumbers>;
}

/** Pages read, charts read, and finds listed, at most. */
const PAGES = 3;
const CHARTS = 3;
const FINDS = 6;

/** A page's passages that bear on what was asked: sharing two telling words with it, nearest first. */
export function nearPassages(text: string, asked: string, count = 2): string[] {
  return passagesFor(text, asked, count + 4)
    .filter((p) => sharedWords(p, asked) >= 2)
    .slice(0, count);
}

/**
 * Search a tool for a question, as a person would: docs by the tool's own search, the first few pages
 * read by code, and the passages that bear on it; analytics by its saved charts, the first few read for
 * their numbers. Nothing is kept and nothing is put in the answer: the person picks.
 */
export async function findIn(c: Pick<ConnectorState, "id" | "label">, ask: ToolAsk, question: string, d: FindDeps): Promise<ToolFind[]> {
  const query = (ask.lookFor || question).slice(0, 120);
  if (ask.kind === "docs") {
    const hits = (await d.browse(c.id, query)).filter((h) => !h.folder && h.type !== "other").slice(0, PAGES);
    if (!hits.length) return [];
    const asked = `${question} ${ask.lookFor ?? ""}`;
    const read = await d.read(c.id, hits);
    return read
      .flatMap((it) => {
        const hit = hits.find((h) => h.id === it.id);
        return hit && it.text ? nearPassages(it.text, asked).map((p, i) => ({ key: `${hit.id}:${i}`, text: p, from: hit.title, line: passageLine(p, { title: hit.title, tool: c.label }) })) : [];
      })
      .slice(0, FINDS);
  }
  const charts = (await d.charts(c.id, query)).filter((h) => !h.folder).slice(0, CHARTS);
  const read = await Promise.all(charts.map((h) => d.numbers(c.id, h.id).then((n) => ({ h, n }), () => null)));
  return read
    .flatMap((x) => (x ? x.n.series.map((s) => ({ h: x.h, chart: x.n.name ?? x.h.title, s })) : []))
    .map(({ h, chart, s }) => ({ key: `${h.id}:${s.label}`, text: String(s.value), from: s.label && s.label !== chart && s.label !== "Value" ? `${s.label}, ${chart}` : chart, line: numberLine(s.value, { series: s.label, chart, tool: c.label }) }))
    .slice(0, FINDS);
}
