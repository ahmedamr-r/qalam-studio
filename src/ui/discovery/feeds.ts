import { create } from "zustand";
import { studio } from "@/doc/store";
import { feedback } from "@/commands/feedback";
import type { FeedTarget } from "@/feeds/feeds";
import { useGoals } from "@/goals/client";
import { feedsDb, type FeedView } from "@/org/feeds";
import { loadPlacements } from "./placements";

/*
 * The feeds on this board (server/org/feeds.ts): a connector's saved search wired to its cards or
 * the goals its outcomes are. The lane draws each as a tile with dashed cords to what it watches;
 * what's new for it is counted as the board opens where that costs nothing (its tool reached
 * without Claude Code), else when asked; Refresh takes it in and its proposals open for review.
 */

export interface FeedNews {
  /** What its search found that it hasn't read. */
  fresh?: number;
  checking?: boolean;
  /** Refreshing: how it's going. */
  activity?: string;
  error?: string;
}

interface FeedsUI {
  board: string | null;
  list: FeedView[];
  news: Record<string, FeedNews>;
}

export const useFeeds = create<FeedsUI>(() => ({ board: null, list: [], news: {} }));

const setNews = (id: string, patch: Partial<FeedNews> | null) =>
  useFeeds.setState((s) => {
    const news = { ...s.news };
    if (patch) news[id] = { ...news[id], ...patch };
    else delete news[id];
    return { news };
  });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The feeds on the board; those whose tool answers without Claude Code are checked at once. */
export async function loadFeeds(board: string, check = true) {
  const list = await feedsDb.list(board).catch(() => null);
  if (!list || (useFeeds.getState().board && useFeeds.getState().board !== board)) return;
  useFeeds.setState({ board, list });
  if (check) for (const f of list) if (f.direct && f.status === "on" && useFeeds.getState().news[f.id]?.fresh === undefined) void checkFeed(f.id);
}

/** What's new for it, by its search (no tokens). */
export async function checkFeed(id: string) {
  setNews(id, { checking: true, error: undefined });
  try {
    const r = await feedsDb.check(id);
    setNews(id, { checking: false, fresh: r.fresh });
  } catch (e) {
    setNews(id, { checking: false, error: message(e) });
  }
}

/** Take what's new in: proposals for the cards it's wired to wait on the board and open for review. */
export async function refreshFeed(id: string) {
  const board = useFeeds.getState().board;
  setNews(id, { activity: "Starting", error: undefined });
  try {
    const r = await feedsDb.refresh(id, (label) => setNews(id, { activity: label }));
    setNews(id, { activity: undefined, fresh: r.left });
    const here = r.placed.find((p) => p.board === board)?.count ?? 0;
    feedback(r.added.length ? `${r.added.length === 1 ? "1 item" : `${r.added.length} items`} brought in${here ? ` · ${here} ${here === 1 ? "proposal" : "proposals"} for this board` : ""}` : r.skipped.length ? "Nothing new: it was all in already" : "Nothing new came in", { kind: "success", id: "discovery.feed" });
    if (board) {
      await loadPlacements(board);
      await loadFeeds(board, false);
    }
  } catch (e) {
    setNews(id, { activity: undefined, error: message(e) });
  }
}

/** What a feed is wired to on this board: its cards, and the outcome cards of its goals. */
export function wiredCards(f: Pick<FeedView, "targets">, board: string): string[] {
  const goals = useGoals.getState().goals;
  return [
    ...new Set(
      f.targets.flatMap((t) => {
        if ("card" in t) return t.board === board ? [t.card] : [];
        const on = goals.find((g) => g.id === t.goal)?.on;
        return on?.board === board ? [on.card] : [];
      }),
    ),
  ];
}

/** The target a card is on this board: its goal when it's an outcome that is one, else the card. */
function targetOf(board: string, card: string): FeedTarget {
  const goal = useGoals.getState().goals.find((g) => g.on?.board === board && g.on.card === card);
  return goal ? { goal: goal.id } : { board, card };
}

async function change(id: string, patch: Parameters<typeof feedsDb.change>[1]) {
  const board = useFeeds.getState().board;
  try {
    await feedsDb.change(id, patch);
    if (board) await loadFeeds(board, false);
  } catch (e) {
    feedback(`Couldn't change the feed: ${message(e)}`, { kind: "error", id: "discovery.feed" });
  }
}

export const wireFeed = (id: string, card: string) => {
  const board = useFeeds.getState().board;
  return board ? change(id, { wire: [targetOf(board, card)] }) : Promise.resolve();
};
export const unwireFeed = (id: string, card: string) => {
  const board = useFeeds.getState().board;
  return board ? change(id, { unwire: [targetOf(board, card), { board, card }] }) : Promise.resolve();
};
export const stopFeed = (id: string, on: boolean) => change(id, { status: on ? "on" : "off" });

/** A new feed on this board, wired to the selected card (else the first tree's outcome). */
export async function addFeed(connector: string, query: string): Promise<boolean> {
  const board = useFeeds.getState().board;
  const doc = studio().doc;
  const card = studio().selection.find((id) => doc.nodes[id]?.meta.ost) ?? doc.roots.find((id) => doc.nodes[id]?.meta.ost?.kind === "outcome");
  if (!board || !card) {
    feedback("Name the outcome you want to move first: a feed watches for its cards.", { id: "discovery.feed" });
    return false;
  }
  try {
    const f = await feedsDb.add({ connector, query, targets: [targetOf(board, card)] });
    await loadFeeds(board, false);
    void checkFeed(f.id);
    return true;
  } catch (e) {
    feedback(`Couldn't keep the feed: ${message(e)}`, { kind: "error", id: "discovery.feed" });
    return false;
  }
}
