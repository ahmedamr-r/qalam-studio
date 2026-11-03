import { sharedWords } from "@/discovery/near";
import { connectorShown } from "@/lab";
import type { ConnectorState } from "@/org/connectors";

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

/** A document's passages nearest what was asked, its own words, most shared words first (with none sharing, its first ones). */
export function passagesFor(text: string, asked: string, count = 4): string[] {
  const passages = text
    .split(/\n\s*\n|\n(?=[-*#] )/)
    .map((p) => p.replace(/\s+/g, " ").replace(/^[-*#]+ /, "").trim())
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
