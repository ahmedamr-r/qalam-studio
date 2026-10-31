import { create } from "zustand";
import { studio } from "@/doc/store";
import { feedback } from "@/commands/feedback";
import type { FeedTarget } from "@/feeds/feeds";
import { useGoals } from "@/goals/client";
import { feedsDb, type FeedView } from "@/org/feeds";
import { loadPlacements } from "./placements";
import { boardOfCard, canvasBoards, onSpaceCanvas } from "@/space/view";
import { flushSpace } from "@/space/session";

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
  /** The board's page they're listed for; "space" on a space's canvas (every feed, wired to its cards on any board). */
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
export const SPACE = "space";

/** The feeds on the board (on a space's canvas, `board` "space": all of them); those whose tool answers without Claude Code are checked at once. */
export async function loadFeeds(board: string, check = true) {
  const list = await feedsDb.list(board === SPACE ? undefined : board).catch(() => null);
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
    const here = board === SPACE ? r.placed.filter((p) => canvasBoards().includes(p.board)).reduce((n, p) => n + p.count, 0) : (r.placed.find((p) => p.board === board)?.count ?? 0);
    feedback(r.added.length ? `${r.added.length === 1 ? "1 item" : `${r.added.length} items`} brought in${here ? ` · ${here} ${here === 1 ? "proposal" : "proposals"} for this board` : ""}` : r.skipped.length ? "Nothing new: it was all in already" : "Nothing new came in", { kind: "success", id: "discovery.feed" });
    if (board) {
      for (const b of board === SPACE ? canvasBoards() : [board]) await loadPlacements(b);
      await loadFeeds(board, false);
    }
  } catch (e) {
    setNews(id, { activity: undefined, error: message(e) });
  }
}

/** What a feed is wired to on this board: its cards, and the outcome cards of its goals. */
export function wiredCards(f: Pick<FeedView, "targets">, board: string): string[] {
  const goals = useGoals.getState().goals;
  // A space's canvas: wherever the cards are (a goal with no board yet is its own card).
  const doc = studio().doc;
  const here = (b: string, card: string) => (board === SPACE ? !!doc.nodes[card] && boardOfCard(card) === b : b === board);
  return [
    ...new Set(
      f.targets.flatMap((t) => {
        if ("card" in t) return here(t.board, t.card) ? [t.card] : [];
        const on = goals.find((g) => g.id === t.goal)?.on;
        if (board === SPACE && !on && doc.nodes[t.goal]) return [t.goal];
        return on && here(on.board, on.card) ? [on.card] : [];
      }),
    ),
  ];
}

/** The target a card is on this board: its goal when it's an outcome that is one, else the card. */
function targetOf(board: string, card: string): FeedTarget | null {
  const goals = useGoals.getState().goals;
  if (board === SPACE) {
    // A goal's card (with a board or not) is the goal; any other card is on its own board.
    const goal = goals.find((g) => (g.on ? g.on.card === card : g.id === card));
    const b = boardOfCard(card);
    return goal ? { goal: goal.id } : b ? { board: b, card } : null;
  }
  const goal = goals.find((g) => g.on?.board === board && g.on.card === card);
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
  const t = board ? targetOf(board, card) : null;
  return t ? change(id, { wire: [t] }) : Promise.resolve();
};
export const unwireFeed = (id: string, card: string) => {
  const board = useFeeds.getState().board;
  const t = board ? targetOf(board, card) : null;
  const own = board === SPACE ? boardOfCard(card) : board;
  return t ? change(id, { unwire: [t, ...(own ? [{ board: own, card }] : [])] }) : Promise.resolve();
};
export const stopFeed = (id: string, on: boolean) => change(id, { status: on ? "on" : "off" });

/**
 * A new feed on this board, wired to `card` (else the selected card, else the first tree's outcome),
 * and checked at once. Its id, or null. On a space's canvas a card whose board isn't made yet is
 * saved first, so the feed can name it.
 */
export async function addFeed(connector: string, query: string, o: { card?: string } = {}): Promise<string | null> {
  const board = useFeeds.getState().board;
  const doc = studio().doc;
  const card = o.card ?? studio().selection.find((id) => doc.nodes[id]?.meta.ost) ?? doc.roots.find((id) => doc.nodes[id]?.meta.ost?.kind === "outcome");
  if (board === SPACE && card && !targetOf(board, card)) await flushSpace();
  const target = board && card ? targetOf(board, card) : null;
  if (!board || !target) {
    feedback(onSpaceCanvas() ? "Pick the goal or card a feed watches for first." : "Name the outcome you want to move first: a feed watches for its cards.", { id: "discovery.feed" });
    return null;
  }
  try {
    const f = await feedsDb.add({ connector, query, targets: [target] });
    await loadFeeds(board, false);
    void checkFeed(f.id);
    return f.id;
  } catch (e) {
    feedback(`Couldn't keep the feed: ${message(e)}`, { kind: "error", id: "discovery.feed" });
    return null;
  }
}
