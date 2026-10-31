import clsx from "clsx";
import { X } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { cardOf } from "@/discovery/ops";
import type { LaneItem } from "@/discovery/lane";
import { ConnectorLogo } from "../brand/ConnectorLogo";
import { Button, IconBtn, Spinner } from "../controls";
import { r } from "../recipes";
import { ago } from "../time";
import { glideToLayer, onCanvasReady } from "./canvas";
import { checkFeed, refreshFeed, stopFeed, unwireFeed, useFeeds, wiredCards } from "./feeds";
import { useGoals } from "@/goals/client";
import { useDiscovery } from "./store";

/*
 * A feed from the board's lane, in place of the right panel: what it looks for and where, what's
 * new for it (its search: free), Refresh (what's new taken in and proposed only under the cards it
 * watches), the cards it watches with Unwire on each, and Stop watching.
 */

const ICON = { size: 13, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export default function FeedReader({ item }: { item: LaneItem }) {
  const id = item.feed!.id;
  const feed = useFeeds((s) => s.list.find((f) => f.id === id));
  const board = useFeeds((s) => s.board);
  const news = useFeeds((s) => s.news[id]);
  const doc = useStudio((s) => s.doc);
  // Its wiring as it is now (a cord just drawn, one unwired), not as the tile was when it opened.
  useGoals((g) => g.goals);
  const close = () => useDiscovery.setState({ reading: null });
  if (!feed || !board) return null;
  const cards = wiredCards(feed, board).filter((c) => doc.nodes[c]);
  const off = feed.status === "off";
  const busy = !!news?.activity || !!news?.checking;
  return (
    <aside aria-label={`Feed: ${feed.title}`} className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-line-subtle bg-panel">
      <div className={clsx(r.panelHeader, "justify-between gap-[8px] pl-[12px]")}>
        <span className="flex min-w-0 items-center gap-[8px]">
          <ConnectorLogo id={feed.connector} size={16} decorative />
          <span className="truncate text-caption font-semibold text-fg">{feed.title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-[4px]">
          <Button size="sm" variant="secondary" onClick={() => void stopFeed(id, off)}>
            {off ? "Watch again" : "Stop watching"}
          </Button>
          <IconBtn size="sm" label="Close" onClick={close}>
            <X {...ICON} />
          </IconBtn>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-[12px] py-[10px]">
        <section className="flex flex-col gap-[4px]">
          <span className="text-micro text-fg-subtle">Looks in {feed.label} for</span>
          <span className="break-words font-mono text-caption text-fg">{feed.query}</span>
          <span className="text-micro text-fg-subtle">{feed.read ? `Last read ${ago(feed.read)}` : "Nothing read yet"} · {feed.results.length === 1 ? "1 source" : `${feed.results.length} sources`} brought in</span>
        </section>
        {off ? (
          <p className="text-caption text-fg-muted">It stopped watching. What it brought stays where it is.</p>
        ) : (
          <section className="flex flex-col gap-[8px]">
            <span className="text-body text-fg" role="status">
              {news?.activity ? (
                <span className="inline-flex items-center gap-[6px]">
                  <Spinner size={11} /> {news.activity}
                </span>
              ) : news?.checking ? (
                <span className="inline-flex items-center gap-[6px]">
                  <Spinner size={11} /> Looking for what's new
                </span>
              ) : news?.fresh ? (
                `${news.fresh} new since it last read`
              ) : news?.fresh === 0 ? (
                "Nothing new since it last read"
              ) : (
                `Check ${feed.label} for what's new: its search, no Qalam AI.`
              )}
            </span>
            {news?.error && <span className="text-caption text-danger">{news.error}</span>}
            <span className="flex gap-[6px]">
              <Button size="sm" disabled={busy || !news?.fresh} onClick={() => void refreshFeed(id)}>
                {news?.fresh ? `Bring in ${Math.min(news.fresh, 10)}` : "Refresh"}
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void checkFeed(id)}>
                Check again
              </Button>
            </span>
            <span className="text-micro text-fg-subtle">Up to ten at a time: Qalam AI reads them, files them on the problem pages and proposes them only under the cards it watches.</span>
          </section>
        )}
        <section className="flex flex-col gap-[4px]">
          <span className="text-micro text-fg-subtle">Watches for</span>
          <ul className="flex flex-col gap-[2px]">
            {cards.map((card) => (
              <li key={card} className="flex items-center gap-[6px] rounded-md px-[4px] py-[3px] hover:bg-hover">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-body text-fg"
                  onClick={() => {
                    studio().select([card]);
                    onCanvasReady((c) => glideToLayer(c, card));
                  }}
                >
                  {cardOf(doc, card)?.title || "Untitled"}
                </button>
                <Button size="sm" variant="secondary" onClick={() => void unwireFeed(id, card)}>
                  Unwire
                </Button>
              </li>
            ))}
          </ul>
          <span className="text-micro text-fg-subtle">Drag from its port onto a goal or a problem to watch for it too.</span>
        </section>
      </div>
    </aside>
  );
}
