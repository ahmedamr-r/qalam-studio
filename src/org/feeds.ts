import { callAI } from "@/ai/client";
import type { Hit } from "@/connectors/recipes";
import type { Feed, FeedTarget } from "@/feeds/feeds";
import type { LinkedNow } from "./capture";
import type { ImportResult } from "./connectors";
import { orgJson, orgPath } from "./client";

/*
 * Feeds in the window (server/org/feeds.ts): those on a board, adding one, wiring and unwiring it,
 * what's new for it (its search, no tokens), and Refresh: what's new taken in and proposed only
 * under the cards it's wired to.
 */

/** A feed as the window shows it: its tool's name, and whether it's reached without Claude Code (checked as the board opens). */
export type FeedView = Feed & { label: string; direct: boolean };

export interface FeedRefreshed extends ImportResult {
  placed: { board: string; count: number }[];
  linked: LinkedNow | null;
  left: number;
}

const at = (id: string, rest = "") => `/feeds/${encodeURIComponent(id)}${rest}`;

export const feedsDb = {
  /** The feeds on a board (wired to its cards, or to the goals its outcomes are); all of them with none. */
  list: (board?: string) => orgJson<FeedView[]>(`/feeds${board ? `?board=${encodeURIComponent(board)}` : ""}`),
  add: (input: { connector: string; query: string; title?: string; targets: FeedTarget[] }) => orgJson<Feed>("/feeds", { method: "POST", json: input }),
  change: (id: string, patch: { query?: string; title?: string; status?: "on" | "off"; wire?: FeedTarget[]; unwire?: FeedTarget[] }) => orgJson<Feed>(at(id), { method: "PATCH", json: patch }),
  /** What its search finds that it hasn't read. */
  check: (id: string) => orgJson<{ fresh: number; hits: Hit[] }>(at(id, "/check"), { method: "POST", json: {} }),
  /** Take what's new in; `onActivity` hears how it's going. */
  refresh: async (id: string, onActivity: (label: string) => void) =>
    (
      await callAI<FeedRefreshed>(await orgPath(at(id, "/refresh")), {}, undefined, undefined, (e) => {
        if (e.type === "activity") onActivity(e.label);
      })
    ).data,
};
