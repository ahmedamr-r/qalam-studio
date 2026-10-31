import type { Hit } from "@/connectors/recipes";

/*
 * Feeds (pure): a connector and a saved search, wired to the goals and the board cards it should
 * find evidence for, so what it brings keeps coming to the same place. Refreshing one is by hand:
 * code counts what's new since it last read (its search, no tokens), and Refresh reads that in like
 * any material and proposes quotes only under the cards it's wired to. Each feed is a line in
 * hub/feeds.jsonl, then a line per change to it (never rewritten, so two people's merge in Git).
 */

/** What a feed finds evidence for: a goal (its board's outcome, and the goal itself), or a card on a board. */
export type FeedTarget = { goal: string } | { board: string; card: string };

export interface Feed {
  id: string;
  /** A connector that brings material in (its id in the catalog). */
  connector: string;
  /** The words it searches for, in the tool's own terms. */
  query: string;
  title: string;
  targets: FeedTarget[];
  /** Where each item it read or passed over came from: never brought in twice. */
  seen: string[];
  /** When it last read what was new. */
  read?: number;
  /** The sources it brought in. */
  results: string[];
  /** "off": it stopped watching (kept, so what it brought still says where from). */
  status: "on" | "off";
  at: number;
  /** When it last changed. */
  changed: number;
}

/** A line of hub/feeds.jsonl: a feed, or a change to one (`wire` and `unwire` change its targets; `seen` and `results` add to its own). */
export type FeedLog = Partial<Omit<Feed, "changed" | "targets">> & { id: string; at: number; targets?: FeedTarget[]; wire?: FeedTarget[]; unwire?: FeedTarget[] };

export const FEED_LIMITS = { query: 200, title: 120, targets: 24, refresh: 10 } as const;

const keyOf = (t: FeedTarget) => ("goal" in t ? `goal:${t.goal}` : `card:${t.board}:${t.card}`);

/** A target as it can be kept, else null. */
export function feedTarget(v: unknown): FeedTarget | null {
  const r = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  if (typeof r.goal === "string" && r.goal) return { goal: r.goal };
  if (typeof r.board === "string" && r.board && typeof r.card === "string" && r.card) return { board: r.board, card: r.card };
  return null;
}

const withTargets = (have: FeedTarget[], add: FeedTarget[] = [], drop: FeedTarget[] = []) => {
  const gone = new Set(drop.map(keyOf));
  const out = new Map(have.filter((t) => !gone.has(keyOf(t))).map((t) => [keyOf(t), t]));
  for (const t of add) if (!gone.has(keyOf(t)) && out.size < FEED_LIMITS.targets) out.set(keyOf(t), t);
  return [...out.values()];
};

/** The feeds as they are now: each one's first line, with every change after it. */
export function foldFeeds(log: FeedLog[]): Feed[] {
  const feeds = new Map<string, Feed>();
  for (const e of [...log].sort((a, b) => a.at - b.at)) {
    if (typeof e.id !== "string" || typeof e.at !== "number") continue;
    const cur = feeds.get(e.id);
    if (!cur) {
      if (typeof e.connector !== "string" || typeof e.query !== "string" || !e.query.trim()) continue;
      feeds.set(e.id, {
        id: e.id,
        connector: e.connector,
        query: e.query,
        title: e.title || e.query,
        targets: withTargets([], [...(e.targets ?? []), ...(e.wire ?? [])].flatMap((t) => feedTarget(t) ?? [])),
        seen: [...new Set(e.seen ?? [])],
        ...(e.read ? { read: e.read } : {}),
        results: [...new Set(e.results ?? [])],
        status: e.status === "off" ? "off" : "on",
        at: e.at,
        changed: e.at,
      });
      continue;
    }
    feeds.set(e.id, {
      ...cur,
      ...(typeof e.query === "string" && e.query.trim() ? { query: e.query } : {}),
      ...(typeof e.title === "string" && e.title.trim() ? { title: e.title } : {}),
      ...(e.status === "on" || e.status === "off" ? { status: e.status } : {}),
      ...(typeof e.read === "number" ? { read: e.read } : {}),
      targets: withTargets(cur.targets, (e.wire ?? []).flatMap((t) => feedTarget(t) ?? []), (e.unwire ?? []).flatMap((t) => feedTarget(t) ?? [])),
      seen: [...new Set([...cur.seen, ...(e.seen ?? [])])],
      results: [...new Set([...cur.results, ...(e.results ?? [])])],
      changed: e.at,
    });
  }
  return [...feeds.values()];
}

/** A feed as its first line in hub/feeds.jsonl. */
export function feedLine(f: Pick<Feed, "id" | "connector" | "query" | "title" | "targets" | "at">): FeedLog {
  return { id: f.id, connector: f.connector, query: f.query, title: f.title, targets: f.targets, status: "on", seen: [], results: [], at: f.at };
}

/** Where an item came from, as a feed and the sources keep it: its address, else the tool and its id. */
export const hitOrigin = (connector: string, hit: Pick<Hit, "id" | "url">) => hit.url ?? `${connector}:${hit.id}`;

/**
 * What a feed's search found that it hasn't read: an item from nowhere it has seen and no source
 * the organization keeps came from, or one the tool says changed since it last read.
 */
export function freshHits(hits: readonly Hit[], feed: Pick<Feed, "connector" | "seen" | "read">, known: ReadonlySet<string>): Hit[] {
  const seen = new Set(feed.seen);
  return hits.filter((h) => {
    if (h.folder) return false;
    const origin = hitOrigin(feed.connector, h);
    if (!seen.has(origin) && !known.has(origin)) return true;
    const at = h.at ? Date.parse(h.at) : NaN;
    return !!feed.read && Number.isFinite(at) && at > feed.read;
  });
}

/**
 * The feeds that bear on a board: wired to one of its cards, or to a goal whose outcome card is on
 * it (`goalsOn`: the goals the board's outcome cards are). Stopped ones too, so the lane can say so.
 */
export function feedsOn(feeds: readonly Feed[], board: string, goalsOn: ReadonlySet<string>): Feed[] {
  return feeds.filter((f) => f.targets.some((t) => ("goal" in t ? goalsOn.has(t.goal) : t.board === board)));
}
