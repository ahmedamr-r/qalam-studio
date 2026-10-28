import { findQuote } from "@/discovery/quotes";
import { valuesIn } from "@/hub/topics";
import { metricLine } from "./goals-md";
import { wordsHold } from "./said";
import type { Goal } from "./types";

/*
 * What others aim for (pure): numbers companies in the same or a similar domain report for goals
 * like this one, found on the web. Qalam AI reads the pages; code keeps a claim only when its quote
 * is on its page word for word and its number is in the quote. They're the outside's numbers: kept
 * apart from the sources, never customer evidence, never a goal's own number.
 */

export interface Benchmark {
  id: string;
  /** What it measures. */
  what: string;
  value: number;
  unit?: string;
  /** Who reports it, for which market and year. */
  who: string;
  /** The page's own words, found there by code. */
  quote: string;
  url: string;
  title: string;
  at: number;
}

/** What was looked up for a goal, and what held. */
export interface Outside {
  at: number;
  claims: Benchmark[];
  /** The research step's notes, as it wrote them (each fact linked). */
  notes: string;
  /** The pages read. */
  pages: { title: string; url: string }[];
}

export interface OutsidePage {
  ref: string;
  url: string;
  title: string;
  text: string;
}

export const OUTSIDE_LIMITS = { pages: 5, excerpt: 4000, window: 350, claims: 8, what: 120, who: 120, quote: 400 } as const;

const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** The numbers the notes give for each page they link. */
export function numbersByPage(notes: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const line of notes.split("\n")) {
    const values = valuesIn(line.replace(LINK, " "));
    for (const m of line.matchAll(LINK)) out.set(m[2], [...new Set([...(out.get(m[2]) ?? []), ...values])]);
  }
  return out;
}

/** The parts of a page around the numbers the notes say it has (its start when none is found), at most so long. */
export function pageExcerpt(text: string, numbers: number[], max: number = OUTSIDE_LIMITS.excerpt): string {
  const spans: [number, number][] = [];
  for (const m of text.matchAll(/\d+(?:[.,]\d+)*(?:\s*(?:k|m|bn|%))?/gi)) {
    if (!valuesIn(m[0]).some((v) => numbers.includes(v))) continue;
    const at = m.index ?? 0;
    spans.push([Math.max(0, at - OUTSIDE_LIMITS.window), Math.min(text.length, at + m[0].length + OUTSIDE_LIMITS.window)]);
  }
  if (!spans.length) return text.slice(0, Math.min(max, 3000));
  const merged: [number, number][] = [];
  for (const s of spans.sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  let out = "";
  for (const [a, b] of merged) {
    const part = `${a > 0 ? "…" : ""}${text.slice(a, b)}${b < text.length ? "…" : ""}`;
    if (out.length + part.length > max) break;
    out += (out ? "\n" : "") + part;
  }
  return out || text.slice(0, max);
}

/** What the research step is asked: the goal, where it sits, and what the company is. */
export function outsideTask(o: { org: string; about: string; product?: string; chain: Goal[]; goal: Goal }): string {
  const above = o.chain.filter((g) => g.id !== o.goal.id);
  return [
    `${o.org}${o.about ? `: ${o.about.replace(/\s+/g, " ").slice(0, 600)}` : ""}`,
    `A goal of ${o.product ? `its product ${o.product}` : "the company's"}: “${o.goal.title}”${o.goal.metric ? ` (${[o.goal.metric.name, metricLine(o.goal.metric)].filter(Boolean).join(": ")})` : ""}.`,
    ...(above.length ? [`It feeds: ${above.map((g) => `“${g.title}”`).join(", then ")}.`] : []),
    "What do companies in the same or a similar domain take as their North Star and the goals under it, and which numbers do they report publicly for goals like this one?",
  ].join("\n");
}

export interface ClaimsSent {
  text: string;
  pages: Map<string, OutsidePage>;
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();

/** What the claims call reads: the goal, the research notes, and an excerpt of each page (w1…). */
export function claimsMaterial(o: { task: string; notes: string; pages: OutsidePage[] }): ClaimsSent {
  const numbers = numbersByPage(o.notes);
  const pages = new Map(o.pages.slice(0, OUTSIDE_LIMITS.pages).map((p, i) => [`w${i + 1}`, { ...p, ref: `w${i + 1}` }]));
  const text = [
    "The goal:",
    o.task,
    "",
    "What the research step wrote:",
    o.notes.trim(),
    "",
    "The pages, as read (id · title · address, then excerpts around the numbers):",
    ...[...pages.values()].flatMap((p) => [`<page id="${p.ref}" title="${one(p.title).replace(/"/g, "'")}" url="${p.url}">`, pageExcerpt(p.text, numbers.get(p.url) ?? []), "</page>"]),
  ].join("\n");
  return { text, pages };
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const clip = (v: unknown, max: number) => (typeof v === "string" ? one(v).slice(0, max) : "");

/**
 * What code keeps of the claims: each on a page that was read, its quote found there word for word
 * (the page's own words are kept), its number in that quote, its unit there too. `dropped` hears
 * each claim left out and why.
 */
export function sanitizeClaims(raw: unknown, m: ClaimsSent, o: { now: number }, dropped?: (why: string, item: unknown) => void): Benchmark[] {
  const out: Benchmark[] = [];
  const drop = (why: string, x: unknown) => void dropped?.(why, x);
  for (const x of Array.isArray(rec(raw).claims) ? (rec(raw).claims as unknown[]) : []) {
    if (out.length >= OUTSIDE_LIMITS.claims) {
      drop("over the limit", x);
      continue;
    }
    const c = rec(x);
    const page = typeof c.page === "string" ? m.pages.get(c.page.trim()) : undefined;
    const found = page && typeof c.quote === "string" ? findQuote(page.text, c.quote.slice(0, OUTSIDE_LIMITS.quote)) : null;
    if (!page || !found) {
      drop(!page ? "a page not read" : "its quote isn't on the page", x);
      continue;
    }
    const value = typeof c.value === "number" && Number.isFinite(c.value) ? c.value : null;
    if (value === null || !valuesIn(found.words).includes(value)) {
      drop("its number isn't in the quote", x);
      continue;
    }
    const what = clip(c.what, OUTSIDE_LIMITS.what);
    const who = clip(c.who, OUTSIDE_LIMITS.who);
    // A unit, without the asides models add to it ("% (over)").
    const unit = clip(c.unit, 40).replace(/\s*\([^)]*\)/g, "").trim().slice(0, 24);
    if (!what) {
      drop("it says nothing of what it measures", x);
      continue;
    }
    // A unit the page gives: a sign it wrote, or words in the quote.
    const unitHolds = !unit || (/[\p{L}\p{N}]/u.test(unit) ? wordsHold(unit, found.words) : found.words.includes(unit));
    if (out.some((b) => b.url === page.url && b.value === value && b.what.toLowerCase() === what.toLowerCase())) {
      drop("there twice", x);
      continue;
    }
    out.push({ id: `b${out.length + 1}`, what, value, ...(unit && unitHolds ? { unit } : {}), who: who || page.title, quote: found.words, url: page.url, title: page.title, at: o.now });
  }
  return out;
}
