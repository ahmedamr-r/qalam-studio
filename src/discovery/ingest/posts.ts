/*
 * What people say in public, as text the extract reads (pure): an app's App Store reviews through
 * Apple's review feed, any other page as its words. Each person is named by their role there ("App
 * Store reviewer"), never by their handle, so a quote says where it's from without saying who. Reddit
 * closed its API to new apps (October 2026) and is closing it for good in March 2027, so its threads
 * aren't read: people paste them.
 */

export type PostAddress = { kind: "appstore"; id: string; country: string } | { kind: "page" };

/** Where to read a page from: an app's review feed, or the page itself. */
export function postAddress(raw: string): PostAddress {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { kind: "page" };
  }
  const host = u.hostname.replace(/^www\./, "");
  // A link needn't name a country's store (apps.apple.com/app/id123), and its page is only the maker's words.
  const app = host === "apps.apple.com" ? u.pathname.match(/^(?:\/([a-z]{2}))?\/app\/(?:[^/]+\/)?id(\d+)/i) : null;
  return app ? { kind: "appstore", id: app[2], country: (app[1] ?? "us").toLowerCase() } : { kind: "page" };
}

/** Review sites that refuse to be read from here (403, November 2026): tried last, so forums that answer get their turn. */
export const refusesReaders = (raw: string) => {
  try {
    return /(^|\.)(g2|capterra|producthunt)\.com$/i.test(new URL(raw).hostname);
  } catch {
    return false;
  }
};

/** A Reddit address: found by search, but not ours to read. */
export function isReddit(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === "reddit.com" || host.endsWith(".reddit.com") || host === "redd.it";
  } catch {
    return false;
  }
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const one = (s: string) => s.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();

/** Apple's feed answers ten pages of 50 for an app, and refuses the eleventh (checked November 2026). */
export const REVIEW_PAGES = 10;
/** What one read call takes of reviews: a source of this size is one chunk (src/discovery/sources.ts). */
export const REVIEW_CHARS = 20_000;

export const reviewFeed = (id: string, country: string, page: number) => `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${id}/sortby=mostrecent/json`;

export interface Review {
  stars: number;
  title: string;
  words: string;
  votes: number;
  at: number;
}

/** The reviews on one page of the feed (never who wrote them). */
export function reviewsIn(json: unknown): Review[] {
  const feed = rec(rec(json).feed);
  const entries = (Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : []).map(rec);
  const label = (v: unknown) => str(rec(v).label);
  return entries.flatMap((e) => {
    const words = one(label(e.content));
    const stars = Number(label(e["im:rating"]));
    if (!words || !Number.isFinite(stars) || stars < 1) return [];
    // Some reviewers title a review with their own name or business: never kept.
    const by = one(label(rec(e.author).name)).toLowerCase();
    const said = one(label(e.title));
    const title = by.length >= 5 && said.toLowerCase().includes(by) ? "" : said;
    return [{ stars, title, words, votes: Number(label(e["im:voteSum"])) || 0, at: Date.parse(label(e.updated)) || 0 }];
  });
}

/**
 * The reviews worth a read, as many as fit: complaints first (1 to 3 stars), then the "good, but…" of
 * 4 stars, most voted and then newest within each. 5 stars aren't complaints, so they're left out.
 */
export function pickReviews(all: readonly Review[], max = REVIEW_CHARS): { kept: Review[]; left: number } {
  const rank = (r: Review) => (r.stars <= 3 ? 0 : 1);
  const order = all.filter((r) => r.stars < 5).sort((a, b) => rank(a) - rank(b) || b.votes - a.votes || b.at - a.at);
  const kept: Review[] = [];
  let size = 0;
  for (const r of order) {
    const n = reviewLine(r).length + 2;
    if (size + n > max) continue;
    kept.push(r);
    size += n;
  }
  return { kept, left: all.length - kept.length };
}

const reviewLine = (r: Review) => `App Store reviewer (${r.stars} ${r.stars === 1 ? "star" : "stars"}): ${r.title ? `${r.title}. ` : ""}${r.words}`;

/** An app's reviews as who said what: each reviewer, their stars, their words. */
export function reviewsText(app: string, reviews: readonly Review[]): { title: string; text: string } | null {
  if (!reviews.length) return null;
  return { title: `App Store reviews: ${app}`, text: reviews.map(reviewLine).join("\n\n") };
}

/** Sites where people speak for themselves (forums, Q&A, reviews), not articles about them. */
const DISCUSSION_HOSTS = ["reddit.com", "apps.apple.com", "play.google.com", "quora.com", "stackexchange.com", "stackoverflow.com", "news.ycombinator.com", "trustpilot.com", "producthunt.com", "g2.com", "capterra.com", "tripadvisor.com", "indiehackers.com", "discord.com", "community.shopify.com"];

/** A page where people say things in their own words: a thread, reviews, a forum. An article, a vendor's page or a news story isn't. */
export function isDiscussion(raw: string): boolean {
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return DISCUSSION_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) || /^(forums?|community|communities|discuss|discussions|answers|support\.community)\./.test(host) || isThread(raw);
}

/** An address shaped like a forum's thread, on a site we don't know by name (allnurses.com/how-eat-night-shift-t574298). */
const isThread = (raw: string) => {
  const u = new URL(raw);
  return /forums?\./i.test(u.hostname) || /\/(t|threads?|topics?|forums?|discussions?|talk|viewtopic)(\/|\.|$)|-t\d+\/?$/i.test(u.pathname);
};

/** What looking online came to (server/org/posts.ts). */
export interface LookedOnline {
  read: number;
  /** Sources kept, and the quotes taken from them. */
  added: number;
  quotes: number;
  /** Pages left: in already, articles rather than people's own words, or not readable from here. */
  skipped: number;
  why?: { before: number; articles: number; unreadable: number; reddit: number };
  error?: string;
  /** The sources kept (people online's pages). */
  sources?: string[];
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What it came to, in a line for the person: what was read, else why nothing was and what to do instead. */
export function lookedOnlineLine(r: LookedOnline): string {
  if (r.added) return `Read ${count(r.read, "page")}: ${count(r.quotes, "quote")} from people online, filed where they fit.`;
  const w = r.why;
  const parts = w ? [w.before && `${count(w.before, "page")} in already`, w.articles && `${count(w.articles, "article")} rather than people's own words`, w.unreadable && `${count(w.unreadable, "page")} couldn't be read`, w.reddit && `${count(w.reddit, "Reddit thread")} Reddit doesn't let apps read`].filter(Boolean) : [];
  const said = r.error ?? (parts.length ? `Nothing new: ${parts.join(", ")}.` : "Nothing new.");
  return w?.reddit || w?.unreadable ? `${said} Paste a thread's or reviews' text with Add to take it in.` : said;
}

/** A page's handles out of its words ("u/name", "@name"): whose words they are isn't ours to keep. */
export const withoutHandles = (text: string) => text.replace(/\bu\/[A-Za-z0-9_-]{3,20}\b/g, "someone").replace(/(^|[\s(])@[A-Za-z0-9_.]{2,30}\b/g, "$1someone");
