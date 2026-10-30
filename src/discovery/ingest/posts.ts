/*
 * What people say in public, as text the extract reads (pure): a Reddit thread through its JSON, an
 * app's App Store reviews through Apple's review feed, any other page as its words. Each person is
 * named by their role there ("Reddit commenter", "App Store reviewer"), never by their handle, so a
 * quote says where it's from without saying who.
 */

export type PostAddress = { kind: "reddit"; api: string } | { kind: "appstore"; api: string } | { kind: "page" };

/** Where to read a page from: a Reddit thread's JSON, an app's review feed, or the page itself. */
export function postAddress(raw: string): PostAddress {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { kind: "page" };
  }
  const host = u.hostname.replace(/^(www|old|new|np)\./, "");
  const thread = host === "reddit.com" ? u.pathname.match(/^\/r\/([^/]+)\/comments\/([a-z0-9]+)/i) : null;
  if (thread) return { kind: "reddit", api: `https://www.reddit.com/r/${thread[1]}/comments/${thread[2]}/.json?limit=100&raw_json=1` };
  const app = host === "apps.apple.com" ? u.pathname.match(/^\/([a-z]{2})\/app\/(?:[^/]+\/)?id(\d+)/i) : null;
  if (app) return { kind: "appstore", api: `https://itunes.apple.com/${app[1].toLowerCase()}/rss/customerreviews/page=1/id=${app[2]}/sortby=mostrecent/json` };
  return { kind: "page" };
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const one = (s: string) => s.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
/** Markdown's marks off: links as their words, quotes and emphasis plain. */
const plain = (s: string) =>
  one(
    s
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^>\s?/gm, "")
      .replace(/[*_~`]{1,3}([^*_~`]+)[*_~`]{1,3}/g, "$1"),
  );
const GONE = new Set(["[deleted]", "[removed]"]);
/** A Reddit listing's children. */
const kids = (listing: unknown): unknown[] => {
  const c = rec(rec(listing).data).children;
  return Array.isArray(c) ? c : [];
};

/** A Reddit thread as who said what: the original post, then the comments (two levels deep), at most so many. */
export function redditText(json: unknown, max = 60): { title: string; text: string } | null {
  if (!Array.isArray(json) || json.length < 2) return null;
  const post = rec(rec(kids(json[0])[0]).data);
  const title = one(str(post.title));
  if (!title) return null;
  const sub = str(post.subreddit);
  const lines = [`Original post${sub ? ` in r/${sub}` : ""}: ${title}${str(post.selftext).trim() ? `\n${plain(str(post.selftext))}` : ""}`];
  const walk = (children: unknown[], depth: number) => {
    for (const c of children) {
      if (lines.length > max) return;
      const x = rec(c);
      if (x.kind !== "t1") continue;
      const d = rec(x.data);
      const body = str(d.body).trim();
      if (body && !GONE.has(body) && str(d.author) !== "AutoModerator") lines.push(`${d.is_submitter ? "Original poster" : "Reddit commenter"}: ${plain(body)}`);
      if (depth < 1) walk(kids(d.replies), depth + 1);
    }
  };
  walk(kids(json[1]), 0);
  return { title: `Reddit: ${title}`, text: lines.join("\n\n") };
}

/** An app's App Store reviews as who said what: each reviewer, their stars, their words. */
export function appStoreText(json: unknown, max = 50): { title: string; text: string } | null {
  const feed = rec(rec(json).feed);
  const entries = (Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : []).map(rec);
  const label = (v: unknown) => str(rec(v).label);
  const lines: string[] = [];
  for (const e of entries) {
    const words = one(label(e.content));
    const stars = Number(label(e["im:rating"]));
    if (!words || !Number.isFinite(stars) || stars < 1) continue;
    lines.push(`App Store reviewer (${stars} ${stars === 1 ? "star" : "stars"}): ${one(label(e.title))}. ${words}`);
    if (lines.length >= max) break;
  }
  if (!lines.length) return null;
  const app = one(label(rec(feed.title))).replace(/^iTunes Store: Customer Reviews$/, "") || "an app";
  return { title: `App Store reviews: ${app}`, text: lines.join("\n\n") };
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
  return DISCUSSION_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) || /^(forums?|community|communities|discuss|discussions|answers|support\.community)\./.test(host);
}

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
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What it came to, in a line for the person: what was read, else why nothing was and what to do instead. */
export function lookedOnlineLine(r: LookedOnline): string {
  if (r.added) return `Read ${count(r.read, "page")}: ${count(r.quotes, "quote")} from people online, filed where they fit.`;
  const w = r.why;
  const parts = w ? [w.before && `${count(w.before, "page")} in already`, w.articles && `${count(w.articles, "article")} rather than people's own words`, w.unreadable && `${count(w.unreadable, "page")} couldn't be read`, w.reddit && `${count(w.reddit, "Reddit thread")} Reddit won't show without a sign-in`].filter(Boolean) : [];
  const said = r.error ?? (parts.length ? `Nothing new: ${parts.join(", ")}.` : "Nothing new.");
  return w?.reddit || w?.unreadable ? `${said} Paste a thread's or reviews' text with Add to take it in.` : said;
}

/** A page's handles out of its words ("u/name", "@name"): whose words they are isn't ours to keep. */
export const withoutHandles = (text: string) => text.replace(/\bu\/[A-Za-z0-9_-]{3,20}\b/g, "someone").replace(/(^|[\s(])@[A-Za-z0-9_.]{2,30}\b/g, "$1someone");
