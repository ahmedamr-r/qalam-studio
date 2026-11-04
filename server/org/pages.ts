import { fetchGuarded } from "@/discovery/fetch-guard";
import { allReviews, isApplePage, isReddit, pickReviews, postAddress, reviewsText, withoutHandles } from "@/discovery/ingest/posts";
import { appLookup, appNameIn } from "@/scan/sources";
import { htmlText, isWall } from "@/discovery/ingest/text";
import type { OutsidePage } from "@/goals/outside";

/**
 * Web pages the core reads itself, never through a model: what others report for a goal (./outside.ts)
 * and what people say in public about a problem (./posts.ts). Every fetch is guarded (no private
 * addresses, a size and a time limit).
 */

const limit = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(20_000)]);

/** A page as words: HTML read as its text, plain text as it is; anything else (a PDF), or a page that turns readers away, isn't read. */
export async function readPage(link: { url: string; title?: string }, signal: AbortSignal): Promise<OutsidePage | null> {
  // Apple's terms bar reading its site by program, but for what it makes available for that: its search API and review feed, which are read as such.
  if (isApplePage(link.url)) return null;
  try {
    const page = await fetchGuarded(link.url, { signal: limit(signal) });
    const raw = new TextDecoder().decode(page.body);
    const html = /html/i.test(page.contentType) ? htmlText(raw) : /^text\//i.test(page.contentType) ? { text: raw } : null;
    if (!html || html.text.trim().length < 200 || isWall(html)) return null;
    const own = "title" in html ? html.title?.trim() : "";
    return { ref: "", url: link.url, title: (own && !/^(document|untitled|home|index|page)$/i.test(own) ? own : "") || link.title || new URL(link.url).hostname.replace(/^www\./, ""), text: html.text };
  } catch {
    return null;
  }
}

/** A public feed's answer as JSON; null when it refuses or doesn't answer in JSON. */
export async function readJson(url: string, signal: AbortSignal): Promise<unknown> {
  try {
    const res = await fetchGuarded(url, { signal: limit(signal) });
    return JSON.parse(new TextDecoder().decode(res.body)) as unknown;
  } catch {
    return null;
  }
}

export interface ReadReviews {
  page: OutsidePage;
  /** How many reviews the feed gave, and how many of them were kept for reading. */
  read: number;
  kept: number;
}

/** An app's App Store reviews, read by code: every page the feed gives, the ones worth a read kept. */
export async function readAppReviews(app: { id: string; country: string; name?: string; url: string }, signal: AbortSignal): Promise<ReadReviews | null> {
  if (signal.aborted) return null;
  const all = await allReviews(app, (url) => readJson(url, signal));
  if (signal.aborted) return null;
  const name = app.name ?? appNameIn(await readJson(appLookup(app.id, app.country), signal)) ?? "an app";
  const { kept } = pickReviews(all);
  const read = reviewsText(name, kept);
  return read && read.text.length >= 200 ? { page: { ref: "", url: app.url, title: read.title, text: read.text }, read: all.length, kept: kept.length } : null;
}

/** What people say on a page, as who said what: App Store reviews by role, any other page as its words without handles; never Reddit. */
export async function readPosts(link: { url: string; title?: string }, signal: AbortSignal): Promise<OutsidePage | null> {
  if (isReddit(link.url)) return null;
  const where = postAddress(link.url);
  // An app's page with no reviews to read is its maker's words, not what anyone complains about.
  if (where.kind === "appstore") return (await readAppReviews({ id: where.id, country: where.country, url: link.url }, signal))?.page ?? null;
  const page = await readPage(link, signal);
  return page && { ...page, text: withoutHandles(page.text) };
}
