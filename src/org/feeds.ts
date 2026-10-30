/**
 * Feeds (pure): material that keeps coming in without anyone adding it. A feed is a page or an
 * export at an address (a public sheet of survey answers, a changelog of app reviews) or a request
 * to a connected tool ("this week's support tickets tagged delivery"), pulled every day or week by
 * the core (server/feeds.ts). What it brings that wasn't seen before is captured like anything
 * added to the organization: kept as a source, read, filed into the topic pages, placed on the
 * boards. The list lives in hub/feeds.json with what each has seen, so a second computer on the
 * same folder doesn't bring the same item in twice.
 */

export type FeedEvery = "day" | "week";

export interface Feed {
  id: string;
  label: string;
  kind: "url" | "tool";
  /** A page or an export's address. */
  url?: string;
  /** Connected tools to ask, and what to bring in from them. */
  connectors?: string[];
  request?: string;
  every: FeedEvery;
  /** The product what it brings is about (null: the whole organization). */
  product: string | null;
  paused?: boolean;
  /** When it was last pulled, and what went wrong then, if anything. */
  last?: number;
  error?: string;
  /** Hashes of what it already brought in (newest last). */
  seen?: string[];
  /** How many sources it has brought in. */
  added?: number;
  /** Its last pull left new items for the next one (one pull takes a few). */
  more?: boolean;
}

const DAY = 86_400_000;
export const FEED_EVERY_MS: Record<FeedEvery, number> = { day: DAY, week: 7 * DAY };
export const FEED_EVERY_LABEL: Record<FeedEvery, string> = { day: "Every day", week: "Every week" };
/** Hashes a feed remembers. */
export const FEED_SEEN = 400;

export const feedDue = (f: Feed, now: number) => !f.paused && (!f.last || !!f.more || now - f.last >= FEED_EVERY_MS[f.every] - 60_000);

/** What a feed has seen, with new hashes added (the oldest forgotten past the limit). */
export const withSeen = (f: Feed, hashes: string[]) => [...(f.seen ?? []).filter((h) => !hashes.includes(h)), ...hashes].slice(-FEED_SEEN);

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const tidy = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A feed as a window sends it (what to pull, how often, for which product), checked; null: not one. Its history stays the store's. */
export function feedShape(raw: unknown, id: string): Pick<Feed, "id" | "label" | "kind" | "url" | "connectors" | "request" | "every" | "product" | "paused"> | null {
  const f = raw as Record<string, unknown> | null;
  if (!f || f.id !== id || !ID.test(id)) return null;
  const label = tidy(f.label, 80);
  const every = f.every === "week" ? "week" : f.every === "day" ? "day" : null;
  const product = f.product === null || f.product === undefined ? null : typeof f.product === "string" && ID.test(f.product) ? f.product : undefined;
  if (!label || !every || product === undefined) return null;
  const paused = f.paused === true ? { paused: true } : {};
  if (f.kind === "url") {
    const url = tidy(f.url, 2048);
    if (!/^https?:\/\/\S+$/i.test(url)) return null;
    return { id, label, kind: "url", url, every, product, ...paused };
  }
  if (f.kind === "tool") {
    const connectors = Array.isArray(f.connectors) ? f.connectors.filter((c): c is string => typeof c === "string" && /^[A-Za-z0-9:_-]{1,60}$/.test(c) && c !== "web").slice(0, 6) : [];
    const request = tidy(f.request, 600);
    if (!connectors.length || request.length < 4) return null;
    return { id, label, kind: "tool", connectors, request, every, product, ...paused };
  }
  return null;
}
