import { findQuote } from "@/discovery/quotes";
import type { OutsidePage } from "@/goals/outside";
import { valuesIn } from "@/hub/topics";
import { MAX_PAGES, PAGE_TEXT } from "./facts";
import { MARKET_LIMITS, type Competitor, type MarketLine } from "./types";

/*
 * The company's competitors and its domain, in the first run (pure). The research step finds the
 * pages, code reads them, one call proposes; code keeps a competitor named by them under their
 * name, a found one only where its name is on a page read, each line only where its quote is on
 * its page word for word with its numbers in it. The domain is what companies like it usually aim
 * for and what their customers usually struggle with, kept the same way: read on the web, never
 * what customers said.
 */

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const clip = (v: unknown, max: number) => (typeof v === "string" ? one(v).slice(0, max) : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const low = (s: string) => one(s).toLowerCase();
/** A name as words, to find it on a page ("Oilio" in "…oilio's trucks…"). */
const nameOn = (name: string, text: string) => {
  const words = low(name).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!words) return false;
  return low(text).replace(/[^\p{L}\p{N}]+/gu, " ").includes(words);
};

/** The company as the calls are told it: its name and the facts they kept. */
export const companyLines = (facts: readonly MarketLine[]) => facts.map((f) => `- ${one(f.text)}`).join("\n");

export interface PagesSent {
  text: string;
  pages: Map<string, OutsidePage>;
}

export function pagesBlock(pages: OutsidePage[]): Map<string, OutsidePage> {
  return new Map(pages.slice(0, MAX_PAGES).map((p, i) => [`w${i + 1}`, { ...p, ref: `w${i + 1}` }]));
}

export const pageLines = (pages: Map<string, OutsidePage>) => [...pages.values()].flatMap((p) => [`<page id="${p.ref}" title="${one(p.title).replace(/"/g, "'")}" url="${p.url}">`, p.text.slice(0, PAGE_TEXT), "</page>"]);

// ---------------------------------------------------------------------------
// Competitors

/** What the research step is asked about the competitors. */
export function competitorsTask(o: { org: string; facts: readonly MarketLine[]; named: readonly string[]; said?: string }): string {
  return [
    `“${o.org}”:`,
    ...(o.said ? [`What they want to build: ${one(o.said)}`] : []),
    companyLines(o.facts) || (o.said ? "" : "- (nothing known yet)"),
    o.named.length ? `The competitors they name: ${o.named.join(", ")}. Find each one's own website and what it does; add the other main competitors if there are clear ones.` : o.said ? "They named none: find what people use for this today, the most widely used first, big general products included, then the closest specialists." : "They named none: find the companies that compete with it for the same customers, in the same market.",
  ].join("\n");
}

export interface CompetitorsSent extends PagesSent {
  named: string[];
}

export function competitorsMaterial(o: { org: string; facts: readonly MarketLine[]; named: readonly string[]; notes: string; pages: OutsidePage[]; said?: string }): CompetitorsSent {
  const pages = pagesBlock(o.pages);
  const text = [
    `The company: “${o.org}”.`,
    ...(o.said ? [`What they want to build: ${one(o.said)}`] : []),
    companyLines(o.facts),
    "",
    o.named.length ? `The competitors they named: ${o.named.join(", ")}` : "They named no competitors.",
    "",
    o.notes.trim() ? `What the research step wrote:\n${o.notes.trim()}` : "The research step found nothing.",
    "",
    "The pages, as read (id · title · address, then the page's start):",
    ...pageLines(pages),
  ].join("\n");
  return { text, pages, named: [...o.named] };
}

/** A line about a competitor, or about the domain, kept only where its quote is on its page and its numbers are in the quote. */
export function checkedLine(x: Record<string, unknown>, pages: Map<string, OutsidePage>, o: { now: number; id: string }): MarketLine | null {
  const text = clip(x.text, MARKET_LIMITS.text);
  const page = typeof x.page === "string" ? pages.get(x.page.trim()) : undefined;
  const found = page && typeof x.quote === "string" ? findQuote(page.text, x.quote.slice(0, MARKET_LIMITS.quote)) : null;
  if (!text || !page || !found) return null;
  const quoted = valuesIn(found.words);
  if (valuesIn(text).some((v) => !quoted.includes(v))) return null;
  return { id: o.id, text, url: page.url, title: page.title.slice(0, MARKET_LIMITS.title), quote: found.words.slice(0, MARKET_LIMITS.quote), by: "qalam", at: o.now };
}

/**
 * What code keeps of the proposed competitors: one they named, under their name (its lines only
 * where they hold); one found, only where its name is on a page read and a line about it holds;
 * never the company itself, one they took off before, or the same one twice.
 */
export function sanitizeCompetitors(raw: unknown, m: CompetitorsSent, o: { org: string; now: number; id: () => string; gone: readonly string[] }, dropped?: (why: string, item: unknown) => void): Competitor[] {
  const out: Competitor[] = [];
  const drop = (why: string, x: unknown) => void dropped?.(why, x);
  const named = new Map(m.named.map((n) => [low(n), one(n)]));
  const gone = new Set(o.gone.map(low));
  const texts = [...m.pages.values()].map((p) => p.text);
  for (const x of list(rec(raw).competitors)) {
    const c = rec(x);
    const name = clip(c.name, MARKET_LIMITS.name);
    if (!name || out.length >= 6) {
      drop(!name ? "no name" : "over the limit", x);
      continue;
    }
    const theirs = named.get(low(name)) ?? [...named.entries()].find(([k]) => nameOn(k, name) || nameOn(name, k))?.[1];
    if (low(name) === low(o.org) || nameOn(o.org, name)) {
      drop("the company itself", x);
      continue;
    }
    if (gone.has(low(theirs ?? name)) || out.some((k) => low(k.name) === low(theirs ?? name))) {
      drop(gone.has(low(theirs ?? name)) ? "taken off before" : "there twice", x);
      continue;
    }
    if (!theirs && !texts.some((t) => nameOn(name, t))) {
      drop("its name isn't on a page read", x);
      continue;
    }
    const lines = list(c.lines)
      .map((l) => checkedLine(rec(l), m.pages, { now: o.now, id: o.id() }))
      .filter((l): l is MarketLine => !!l)
      .slice(0, MARKET_LIMITS.perCompetitor);
    if (!theirs && !lines.length) {
      drop("nothing about it holds", x);
      continue;
    }
    const site = typeof c.page === "string" ? m.pages.get(c.page.trim())?.url : undefined;
    out.push({ id: o.id(), name: theirs ?? name, ...(site ?? lines[0]?.url ? { url: site ?? lines[0]?.url } : {}), lines, by: theirs ? "you" : "qalam", at: o.now });
  }
  // A competitor they named that the call left out is still theirs.
  for (const [k, n] of named) if (!out.some((c) => low(c.name) === k) && !gone.has(k)) out.push({ id: o.id(), name: n, lines: [], by: "you", at: o.now });
  return out;
}

// ---------------------------------------------------------------------------
// The domain

export function domainTask(o: { org: string; facts: readonly MarketLine[]; competitors: readonly string[] }): string {
  return [
    `“${o.org}”:`,
    companyLines(o.facts) || "- (nothing known yet)",
    ...(o.competitors.length ? [`Its competitors: ${o.competitors.join(", ")}.`] : []),
    "What do companies in this domain usually aim for and measure, and what do their customers usually struggle with, complain about or ask for?",
  ].join("\n");
}

export function domainMaterial(o: { org: string; facts: readonly MarketLine[]; notes: string; pages: OutsidePage[] }): PagesSent {
  const pages = pagesBlock(o.pages);
  const text = [`The company: “${o.org}”.`, companyLines(o.facts), "", o.notes.trim() ? `What the research step wrote:\n${o.notes.trim()}` : "The research step found nothing.", "", "The pages, as read (id · title · address, then the page's start):", ...pageLines(pages)].join("\n");
  return { text, pages };
}

/** What code keeps of the domain: what companies like it aim for, and what their customers struggle with, each line on its page. */
export function sanitizeDomain(raw: unknown, m: PagesSent, o: { now: number; id: () => string }, dropped?: (why: string, item: unknown) => void): { aims: MarketLine[]; struggles: MarketLine[] } {
  const r = rec(raw);
  const keep = (v: unknown) => {
    const out: MarketLine[] = [];
    for (const x of list(v)) {
      if (out.length >= MARKET_LIMITS.domain) break;
      const l = checkedLine(rec(x), m.pages, { now: o.now, id: o.id() });
      if (!l) dropped?.("its quote isn't on its page, or a number isn't in it", x);
      else if (out.some((k) => low(k.text) === low(l.text))) dropped?.("there twice", x);
      else out.push(l);
    }
    return out;
  };
  return { aims: keep(r.aims), struggles: keep(r.struggles) };
}
