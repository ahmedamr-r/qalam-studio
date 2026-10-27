import type { Doc } from "@/doc/schema";
import { allCards } from "@/discovery/tree";
import type { QuoteRef } from "@/discovery/proposals";
import { quoteEvidence } from "@/discovery/sources";
import type { OstEvidence } from "@/discovery/types";
import { cardRef } from "@/hub/pieces";
import { recordDecision } from "@/knowledge/store";
import { givenOf, sanitizeReliance } from "@/knowledge/trace";
import type { DecisionTrace, ReliedOn } from "@/knowledge/types";
import { quoteIdOf, type OrgContext } from "@/org/pack";
import { currentProject } from "@/projects/session";
import { sourceOf, visitSources } from "./sources";

/**
 * The organization's knowledge in the board's calls to Qalam AI: what a call is given beyond the
 * board (src/org/pack.ts), its customers' quotes made ready to attach, and the trace each call
 * leaves: what it was given, and the pieces it says shaped its answer (only ids it was sent).
 */

/** The product a board's packs rank by: its own; none for a board of the whole organization. */
export const packProduct = (): string | undefined => currentProject()?.product ?? undefined;

/** The board's cards as the index names them: a call that sends the tree leaves them out of its pack. */
export const boardCardRefs = (doc: Doc): string[] => {
  const board = currentProject()?.id;
  return board ? allCards(doc).map((c) => cardRef(board, c.id)) : [];
};

/** A packed customer quote, ready to attach: where it lives, and its words as evidence. */
export interface HubQuote {
  quote: QuoteRef;
  span: [number, number];
  evidence: (against?: boolean) => OstEvidence;
}

/** The packed quotes, by their ids (k…), once their sources are loaded; a quote whose source is gone drops out. */
export async function hubQuotes(org: OrgContext | null): Promise<Map<string, HubQuote>> {
  const out = new Map<string, HubQuote>();
  const quotes = (org?.pieces ?? []).filter((p) => p.type === "quote" && p.source);
  if (!quotes.length) return out;
  await visitSources(quotes.map((p) => p.source));
  for (const p of quotes) {
    const s = sourceOf(p.source!);
    const q = s?.quotes.find((x) => x.id === quoteIdOf(p.ref));
    if (!s || !q) continue;
    out.set(p.k, { quote: { sourceId: s.id, quoteId: q.id }, span: q.span, evidence: (against = false) => quoteEvidence(s, q, "ai", { against }) });
  }
  return out;
}

/**
 * Record a call's trace with the board's others; returns what it relied on (checked against `org`,
 * the pieces it was given under ids). `also`: pieces it was given another way (quotes in its list).
 */
export function recordCall(o: { title: string; summary?: string; org: OrgContext | null; also?: OrgContext | null; raw: unknown; model?: string; sample?: boolean; status?: DecisionTrace["status"]; produced?: DecisionTrace["produced"] }): ReliedOn[] {
  const reliedOn = o.org ? sanitizeReliance((o.raw as { reliedOn?: unknown } | null)?.reliedOn, o.org.manifest) : [];
  const given = [...(o.org ? givenOf(o.org.manifest) : []), ...(o.also ? givenOf(o.also.manifest) : [])];
  recordDecision({
    kind: "discovery",
    at: Date.now(),
    title: o.title,
    ...(o.summary ? { summary: o.summary.slice(0, 600) } : {}),
    ...(o.model ? { model: o.model } : {}),
    ...(o.sample ? { sample: true } : {}),
    status: o.status ?? "done",
    given,
    reliedOn,
    produced: o.produced ?? {},
  });
  return reliedOn;
}
