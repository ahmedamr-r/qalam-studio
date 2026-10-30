import { fetchGuarded } from "@/discovery/fetch-guard";
import { appStoreText, postAddress, redditText, withoutHandles } from "@/discovery/ingest/posts";
import { htmlText } from "@/discovery/ingest/text";
import type { OutsidePage } from "@/goals/outside";

/**
 * Web pages the core reads itself, never through a model: what others report for a goal (./outside.ts)
 * and what people say in public about a problem (./posts.ts). Every fetch is guarded (no private
 * addresses, a size and a time limit).
 */

const limit = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(20_000)]);

/** A page as words: HTML read as its text, plain text as it is; anything else (a PDF) isn't read. */
export async function readPage(link: { url: string; title?: string }, signal: AbortSignal): Promise<OutsidePage | null> {
  try {
    const page = await fetchGuarded(link.url, { signal: limit(signal) });
    const raw = new TextDecoder().decode(page.body);
    const html = /html/i.test(page.contentType) ? htmlText(raw) : /^text\//i.test(page.contentType) ? { text: raw } : null;
    if (!html || html.text.trim().length < 200) return null;
    return { ref: "", url: link.url, title: ("title" in html && html.title?.trim()) || link.title || link.url, text: html.text };
  } catch {
    return null;
  }
}

/** What people say on a page, as who said what: a Reddit thread and App Store reviews by role, any other page as its words without handles. */
export async function readPosts(link: { url: string; title?: string }, signal: AbortSignal): Promise<OutsidePage | null> {
  const where = postAddress(link.url);
  if (where.kind === "page") {
    const page = await readPage(link, signal);
    return page && { ...page, text: withoutHandles(page.text) };
  }
  try {
    const res = await fetchGuarded(where.api, { signal: limit(signal) });
    const json = JSON.parse(new TextDecoder().decode(res.body)) as unknown;
    const read = where.kind === "reddit" ? redditText(json) : appStoreText(json);
    return read && read.text.length >= 200 ? { ref: "", url: link.url, title: read.title, text: read.text } : null;
  } catch {
    // Refused or not JSON (a site that turns readers away): the page itself, as its words.
    const page = await readPage(link, signal);
    return page && { ...page, text: withoutHandles(page.text) };
  }
}
