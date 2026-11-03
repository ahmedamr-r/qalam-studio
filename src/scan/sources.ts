import { withoutHandles } from "@/discovery/ingest/posts";
import { htmlText } from "@/discovery/ingest/text";

/*
 * Where a scan reads what people complain about, by code with no tokens (pure): an app found through
 * Apple's search, and Hacker News's comments through Algolia's API, grouped by the thread they're in
 * so a quote's source is a page anyone can open. Usernames are never kept.
 */

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export interface AppHit {
  id: string;
  name: string;
  url: string;
  ratings: number;
  /** What it says it is: its category and its description's start. */
  about?: string;
}

export const appSearch = (term: string, country: string) => `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&limit=10&country=${country}`;
export const appLookup = (id: string, country: string) => `https://itunes.apple.com/lookup?id=${id}&country=${country}`;

export function appsIn(json: unknown): AppHit[] {
  const results = rec(json).results;
  return (Array.isArray(results) ? results : []).map(rec).flatMap((r) => {
    const id = typeof r.trackId === "number" ? String(r.trackId) : "";
    const name = str(r.trackName).trim();
    const url = str(r.trackViewUrl);
    const about = [str(r.primaryGenreName), str(r.description).replace(/\s+/g, " ").slice(0, 220)].filter(Boolean).join(": ");
    return id && name && url ? [{ id, name, url, ratings: Number(r.userRatingCount) || 0, ...(about ? { about } : {}) }] : [];
  });
}

/** An app's name as Apple's lookup gives it. */
export const appNameIn = (json: unknown): string | null => appsIn(json)[0]?.name ?? null;

/** Too few ratings and there's nothing to read. */
const MIN_RATINGS = 10;

/**
 * The app that's this product: its name whole in the app's name, as words ("Notion" in "Notion: Notes,
 * Docs, Tasks", never "Notional"), the one most people rated. None rather than a near miss: a
 * stranger's reviews would be read as this product's.
 */
export function bestApp(name: string, apps: readonly AppHit[]): AppHit | null {
  const want = ` ${words(name)} `;
  if (want.trim().length < 2) return null;
  return apps.filter((a) => a.ratings >= MIN_RATINGS && ` ${words(a.name)} `.includes(want)).sort((a, b) => b.ratings - a.ratings)[0] ?? null;
}

/** The apps most people rated for a search, for an idea whose named competitors have none: enough ratings to have reviews worth reading. */
export const popularApps = (apps: readonly AppHit[], min = 200) => apps.filter((a) => a.ratings >= min).sort((a, b) => b.ratings - a.ratings);

export interface HnComment {
  story: string;
  title: string;
  text: string;
}

const YEAR = 365 * 86_400_000;

/** Comments from the last three years that match some words. */
export const hnSearch = (query: string, now: number) => `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=comment&hitsPerPage=50&numericFilters=created_at_i>${Math.floor((now - 3 * YEAR) / 1000)}`;

/**
 * Whether a comment is about what was searched: a product's name whole ("Shift Fuel", never "the shift
 * away from fossil fuel"), or every word of a search, its endings free ("plans" for "plan"). The search
 * itself matches far more loosely than that.
 */
export function hnMatches(text: string, q: { name?: string; words?: string }): boolean {
  const have = ` ${words(text)} `;
  if (q.name) return have.includes(` ${words(q.name)} `);
  return words(q.words ?? "").split(" ").filter(Boolean).every((w) => have.includes(` ${w}`));
}

/** The comments in an answer that are about what was searched, as words with no username; too short to say anything, or with no thread to link to, they're left out. */
export function hnComments(json: unknown, q: { name?: string; words?: string } = {}): HnComment[] {
  const hits = rec(json).hits;
  return (Array.isArray(hits) ? hits : []).map(rec).flatMap((h) => {
    const story = h.story_id === null || h.story_id === undefined ? "" : String(h.story_id);
    const text = withoutHandles(htmlText(str(h.comment_text)).text).trim();
    return story && text.length >= 60 && hnMatches(text, q) ? [{ story, title: str(h.story_title).trim(), text }] : [];
  });
}

export interface HnThread {
  title: string;
  origin: string;
  text: string;
}

export const HN_LIMITS = { threads: 3, comments: 30, chars: 12_000 } as const;

/** The threads where most of the comments matched, each as who said what with the same comment once. */
export function hnThreads(comments: readonly HnComment[], max: number = HN_LIMITS.threads): HnThread[] {
  const byStory = new Map<string, HnComment[]>();
  for (const c of comments) {
    const list = byStory.get(c.story) ?? [];
    if (!list.some((x) => x.text === c.text)) byStory.set(c.story, [...list, c]);
  }
  return [...byStory.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, max)
    .flatMap(([story, list]) => {
      const lines: string[] = [];
      let size = 0;
      for (const c of list.slice(0, HN_LIMITS.comments)) {
        const line = `Hacker News commenter: ${c.text}`;
        if (size + line.length > HN_LIMITS.chars) continue;
        lines.push(line);
        size += line.length + 2;
      }
      const text = lines.join("\n\n");
      return text.length >= 200 ? [{ title: `Hacker News: ${list[0].title || "a thread"}`, origin: `https://news.ycombinator.com/item?id=${story}`, text }] : [];
    });
}
