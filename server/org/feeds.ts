import { nanoid } from "nanoid";
import type { Hit } from "@/connectors/recipes";
import { FEED_LIMITS, feedLine, feedsOn, foldFeeds, freshHits, hitOrigin, type Feed, type FeedTarget } from "@/feeds/feeds";
import { goalById } from "@/goals/tree";
import { connectorsView, importItems, searchConnector, type ImportResult } from "../connectors";
import { flushBearings, type Linked } from "./goals";
import { NotFoundError, type OrgStore } from "./store";

/**
 * Feeds, in the core (src/feeds/feeds.ts): a connector's saved search wired to goals and cards.
 * Checking one runs its search and counts what it hasn't read (no tokens). Refreshing one takes up
 * to ten of those in like any material (kept, read, filed into the topic pages), proposes where
 * they fit only under the cards it's wired to (a goal's: its board's outcome), links what was filed
 * to its goals, and notes what it read so it never brings it in twice.
 */

/** A feed as the window shows it: and whether its tool is reached without Claude Code (then it's checked as the board opens). */
export type FeedView = Feed & { direct: boolean; label: string };

/** The feeds (on a board: those wired to its cards or the goals its outcomes are), as the window shows them. */
export async function feedsView(store: OrgStore, board?: string): Promise<FeedView[]> {
  const all = foldFeeds(await store.listFeedLog());
  let list = all;
  if (board) {
    const goals = (await store.getGoals()).goals.filter((g) => g.on?.board === board).map((g) => g.id);
    list = feedsOn(all, board, new Set(goals));
  }
  const { connectors } = await connectorsView();
  return list.map((f) => {
    const c = connectors.find((x) => x.id === f.connector);
    return { ...f, label: c?.label ?? f.connector, direct: !!c && c.tone === "ok" && c.via !== "claude-code" && c.via !== null };
  });
}

async function feedOf(store: OrgStore, id: string): Promise<Feed> {
  const f = foldFeeds(await store.listFeedLog()).find((x) => x.id === id);
  if (!f) throw new NotFoundError("No such feed");
  return f;
}

const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

/** A new feed: a connector that brings material in, its words, and what it's wired to. */
export async function addFeed(store: OrgStore, input: { connector: string; query: string; title?: string; targets: FeedTarget[] }, opts: { tab?: string } = {}): Promise<Feed> {
  const { connectors } = await connectorsView();
  const c = connectors.find((x) => x.id === input.connector);
  if (!c?.imports) throw new Error("That tool doesn't bring material in.");
  const query = clean(input.query, FEED_LIMITS.query);
  if (!query) throw new Error("Say what it should look for.");
  if (!input.targets.length) throw new Error("Wire it to a goal or a card.");
  const line = feedLine({ id: nanoid(10), connector: c.id, query, title: clean(input.title || query, FEED_LIMITS.title), targets: input.targets.slice(0, FEED_LIMITS.targets), at: Date.now() });
  await store.addFeeds([line], opts);
  return feedOf(store, line.id);
}

/** Wire it to more, unwire it, change its words, stop or start it. */
export async function changeFeed(store: OrgStore, id: string, patch: { query?: string; title?: string; status?: "on" | "off"; wire?: FeedTarget[]; unwire?: FeedTarget[] }, opts: { tab?: string } = {}): Promise<Feed> {
  await feedOf(store, id);
  const query = patch.query !== undefined ? clean(patch.query, FEED_LIMITS.query) : undefined;
  const title = patch.title !== undefined ? clean(patch.title, FEED_LIMITS.title) : undefined;
  await store.addFeeds([{ id, ...(query ? { query } : {}), ...(title ? { title } : {}), ...(patch.status ? { status: patch.status } : {}), ...(patch.wire?.length ? { wire: patch.wire } : {}), ...(patch.unwire?.length ? { unwire: patch.unwire } : {}), at: Date.now() }], opts);
  return feedOf(store, id);
}

/** What its search finds that it hasn't read (the newest first, as the tool gives them), with no tokens spent. */
export async function checkFeed(store: OrgStore, id: string): Promise<{ fresh: number; hits: Hit[] }> {
  const f = await feedOf(store, id);
  const hits = await searchConnector(f.connector, f.query);
  const known = new Set((await store.listSources()).flatMap((s) => (s.origin ? [s.origin] : [])));
  const fresh = freshHits(hits, f, known);
  return { fresh: fresh.length, hits: fresh.slice(0, 20) };
}

/** Where a feed's material is placed: each board it's wired to, under its cards (a goal's: its board's outcome). */
async function scopeOf(store: OrgStore, f: Feed): Promise<{ scope: Record<string, string[]>; goals: string[] }> {
  const tree = await store.getGoals();
  const scope: Record<string, string[]> = {};
  const goals: string[] = [];
  const add = (board: string, card: string) => (scope[board] = [...new Set([...(scope[board] ?? []), card])]);
  for (const t of f.targets) {
    if ("goal" in t) {
      const g = goalById(tree, t.goal);
      if (!g) continue;
      goals.push(g.id);
      if (g.on) add(g.on.board, g.on.card);
    } else if (store.getProject(t.board)) add(t.board, t.card);
  }
  return { scope, goals };
}

export interface Refreshed extends ImportResult {
  /** Proposals waiting on each board it's wired to. */
  placed: { board: string; count: number }[];
  linked: Linked | null;
  /** New items it left for the next refresh (it takes ten at a time). */
  left: number;
}

/** Take in what's new for a feed, propose it only under the cards it's wired to, link it to its goals. */
export async function refreshFeed(store: OrgStore, id: string, emit: (label: string) => void): Promise<Refreshed> {
  const f = await feedOf(store, id);
  emit(`Looking in ${f.connector} for “${f.title}”`);
  const { hits } = await checkFeed(store, id);
  const take = hits.slice(0, FEED_LIMITS.refresh);
  const { scope, goals } = await scopeOf(store, f);
  const r = take.length ? await importItems(store, f.connector, take, emit, { scope }) : { added: [], skipped: [], failed: [], sources: [], pages: [] };
  let linked: Linked | null = null;
  if (goals.length && r.pages?.length) {
    emit("Linking what it says to the goals");
    linked = await flushBearings(store, r.pages);
  }
  // What it read (or passed over as in already) is never brought in twice; one that couldn't be read is tried again.
  const failed = new Set(r.failed.map((x) => x.title));
  const seen = take.filter((h) => !failed.has(h.title)).map((h) => hitOrigin(f.connector, h));
  await store.addFeeds([{ id, read: Date.now(), seen, results: r.sources ?? [], at: Date.now() }]);
  const placed = await Promise.all(Object.keys(scope).map(async (board) => ({ board, count: Object.values(await store.placementsFor(board)).flat().length })));
  return { ...r, placed: placed.filter((p) => p.count), linked, left: Math.max(0, hits.length - take.length) };
}
