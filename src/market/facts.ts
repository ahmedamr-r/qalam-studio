import { findQuote } from "@/discovery/quotes";
import type { OutsidePage } from "@/goals/outside";
import { valuesIn } from "@/hub/topics";
import { FACT_FIELDS, MARKET_LIMITS, type FactField, type MarketLine } from "./types";

/*
 * What the first run checks with them about their company (pure): the research step's notes and
 * the pages code read itself go to one call, which proposes facts, each quoting its page (or their
 * own line). Code keeps a fact only when its quote is on its page word for word and every number in
 * it is in the quote; a fact from their own line is theirs. Then they keep, fix or drop each one.
 */

export const PAGE_TEXT = 3500;
export const MAX_PAGES = 5;

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const sentence = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const clip = (v: unknown, max: number) => (typeof v === "string" ? one(v).slice(0, max) : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A website as an address (a bare "example.com" gets https://); null when it isn't one. */
export function siteUrl(site: string | undefined | null): string | null {
  const s = (site ?? "").trim();
  if (!s || /\s/.test(s)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return /\./.test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** What the research step is asked about the company. */
export function companyTask(o: { org: string; site?: string | null; said?: string | null; solo?: boolean }): string {
  return [
    `${o.solo ? "A project" : "A company"} called “${o.org}”${o.site ? `, at ${o.site}` : ""}.`,
    ...(o.said ? [`What they say about it: ${one(o.said).slice(0, 600)}`] : []),
    "What does it do and sell, who are its customers, where does it operate, how does it make money, how far along is it, and what are its products called?",
  ].join("\n");
}

export interface FactsSent {
  text: string;
  /** The pages read (w1…), and their own line as `you`. */
  pages: Map<string, OutsidePage>;
}

/** What the facts call reads: who it is, the notes, each page's start (w1…), and their own line (you). */
export function companyMaterial(o: { org: string; site?: string | null; said?: string | null; notes: string; pages: OutsidePage[] }): FactsSent {
  const pages = new Map(o.pages.slice(0, MAX_PAGES).map((p, i) => [`w${i + 1}`, { ...p, ref: `w${i + 1}` }]));
  if (o.said?.trim()) pages.set("you", { ref: "you", url: "", title: "What they said", text: o.said.trim() });
  const text = [
    `The company: “${o.org}”${o.site ? `, at ${o.site}` : ""}.`,
    "",
    o.notes.trim() ? `What the research step wrote:\n${o.notes.trim()}` : "The research step found nothing.",
    "",
    "The pages, as read (id · title · address, then the page's start):",
    ...[...pages.values()].flatMap((p) => [`<page id="${p.ref}" title="${one(p.title).replace(/"/g, "'")}" url="${p.url}">`, p.text.slice(0, PAGE_TEXT), "</page>"]),
  ].join("\n");
  return { text, pages };
}

const fieldOf = (v: unknown): FactField => (typeof v === "string" && (FACT_FIELDS as readonly string[]).includes(v) ? (v as FactField) : "does");
const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * What code keeps of the proposed facts: each on a page that was read (or their own line), its
 * quote found there word for word, every number in its sentence in that quote; at most 12, none
 * twice. `dropped` hears each fact left out and why.
 */
export function sanitizeFacts(raw: unknown, m: FactsSent, o: { now: number; id: (i: number) => string }, dropped?: (why: string, item: unknown) => void): MarketLine[] {
  const out: MarketLine[] = [];
  const seen = new Set<string>();
  const drop = (why: string, x: unknown) => void dropped?.(why, x);
  for (const x of list(rec(raw).facts)) {
    const f = rec(x);
    if (out.length >= MARKET_LIMITS.company - 2) {
      drop("over the limit", x);
      continue;
    }
    const text = clip(f.text, MARKET_LIMITS.text);
    const page = typeof f.page === "string" ? m.pages.get(f.page.trim()) : undefined;
    const found = page && typeof f.quote === "string" ? findQuote(page.text, f.quote.slice(0, MARKET_LIMITS.quote)) : null;
    if (!text || !page || !found) {
      drop(!text ? "no sentence" : !page ? "a page not read" : "its quote isn't on the page", x);
      continue;
    }
    const quoted = valuesIn(found.words);
    if (valuesIn(text).some((v) => !quoted.includes(v))) {
      drop("a number that isn't in the quote", x);
      continue;
    }
    if (seen.has(key(text))) {
      drop("there twice", x);
      continue;
    }
    seen.add(key(text));
    const theirs = page.ref === "you";
    out.push({ id: o.id(out.length), text, field: fieldOf(f.field), by: theirs ? "you" : "qalam", at: o.now, ...(theirs ? {} : { url: page.url, title: page.title.slice(0, MARKET_LIMITS.title), quote: found.words.slice(0, MARKET_LIMITS.quote) }) });
  }
  return out;
}

/** The About's empty fields, filled from the facts kept: what it does (with where, its model and stage), and who it's for. */
export function aboutFromFacts(facts: readonly MarketLine[], about: { audience: string; context: string }): { audience?: string; context?: string } {
  const join = (fields: FactField[]) => facts.filter((f) => f.field && fields.includes(f.field)).map((f) => sentence(f.text)).join(" ").slice(0, 1200);
  const context = about.context.trim() ? "" : join(["does", "where", "model", "stage", "product"]);
  const audience = about.audience.trim() ? "" : join(["for"]);
  return { ...(context ? { context } : {}), ...(audience ? { audience } : {}) };
}

/**
 * The About once a fact it was filled from is fixed (`now`) or taken off (null): the sentence goes
 * with it, so Qalam AI stops hearing it. A field they rewrote no longer has it word for word, and stays.
 */
export function aboutAfterFact(about: { audience: string; context: string }, was: string, now: string | null): { audience?: string; context?: string } {
  const change = (field: string) => {
    const at = field.indexOf(sentence(was));
    if (at < 0) return null;
    return `${field.slice(0, at)}${now ? sentence(now) : ""}${field.slice(at + sentence(was).length)}`.replace(/ {2,}/g, " ").trim();
  };
  const context = change(about.context);
  const audience = change(about.audience);
  return { ...(context !== null ? { context } : {}), ...(audience !== null ? { audience } : {}) };
}
