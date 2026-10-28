import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { CircleAlert, FileX, FlaskConical, Gauge, History, Inbox, Link2, TriangleAlert, Users, X } from "lucide-react";
import { NOTICE_LABEL, type Notice, type NoticeKind } from "@/hub/checks";
import { cardRef } from "@/hub/pieces";
import type { TopicInfo } from "@/hub/topics";
import { noticesDb, type NoticesNow } from "@/org/notices";
import { projectHref, topicHref, type Project } from "@/projects/model";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { Button, IconBtn, Tag } from "../controls";
import { r } from "../recipes";
import { ago } from "../time";
import { reviewNow, useReview } from "../notices/review";

/**
 * Needs a look: what the organization's checks found (code, no tokens) and what Qalam AI's last
 * review found, newest first, with what's new since this computer's last visit marked. Each says
 * why and where to look; dismissed, it doesn't come back. Two cards on different boards that are
 * the same need can be linked from here.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const KIND_ICON: Record<Exclude<NoticeKind, "review">, typeof X> = {
  disputed: CircleAlert,
  pattern: Users,
  "same-need": Link2,
  revisit: History,
  "stale-test": FlaskConical,
  untested: TriangleAlert,
  metric: Gauge,
  orphan: FileX,
  placed: Inbox,
};
const SHOWN = 5;

const cardHref = (board: string, card: string) => `${projectHref({ id: board, type: "discovery" })}?card=${encodeURIComponent(card)}`;

export function NeedsALook({ now, scope, projects, topics }: { now: NoticesNow | null; scope: (n: Notice) => boolean; projects: Project[]; topics: TopicInfo[] | null }) {
  const [all, setAll] = useState(false);
  const review = useReview();
  // "New" is against the visit before this one, for as long as the page is open.
  const since = useRef<number | null | undefined>(undefined);
  if (now && since.current === undefined) since.current = now.lastVisit;
  useEffect(() => {
    if (now) void noticesDb.visit().catch(() => {});
  }, [!!now]);
  const list = (now?.notices ?? []).filter(scope);
  const fresh = list.filter((n) => since.current !== null && since.current !== undefined && n.at > since.current).length;
  const shown = all ? list : list.slice(0, SHOWN);
  const boardName = (id?: string) => projects.find((p) => p.id === id)?.name;
  const topicTitle = (id?: string) => topics?.find((t) => t.id === id)?.title;

  const where = (n: Notice): { href: string; label: string } | null => {
    // Proposals waiting on a board: the board opens with them under review.
    if (n.kind === "placed" && n.board) return { href: `${projectHref({ id: n.board, type: "discovery" })}?review=placed`, label: boardName(n.board) ?? "The board" };
    if (n.topic && (n.kind === "disputed" || n.kind === "pattern" || n.kind === "orphan")) return { href: topicHref(n.topic), label: topicTitle(n.topic) ?? "The topic page" };
    if (n.board && n.card) return { href: cardHref(n.board, n.card), label: boardName(n.board) ?? "The board" };
    if (n.topic) return { href: topicHref(n.topic), label: topicTitle(n.topic) ?? "The topic page" };
    return null;
  };

  return (
    <section aria-labelledby="needs-a-look" className="flex flex-col gap-[8px]">
      <div className="flex items-center justify-between gap-[12px]">
        <h2 id="needs-a-look" className="text-title font-medium">
          Needs a look
          {list.length > 0 && <span className="ml-[6px] text-caption font-normal text-fg-subtle">{list.length}</span>}
          {fresh > 0 && <span className="ml-[6px] text-caption font-normal text-fg-muted">· {fresh} new since your last visit</span>}
        </h2>
        <Button variant="secondary" size="sm" disabled={review.running} onClick={() => void reviewNow()}>
          {review.running ? "Reviewing…" : "Review now"}
        </Button>
      </div>
      {review.note && <p className="text-caption text-fg-muted">{review.note}</p>}
      {now === null ? (
        <p className="text-body text-fg-muted">Looking…</p>
      ) : !list.length ? (
        <p className="text-body text-fg-muted">
          Nothing needs a look. Qalam checks your boards, decisions and topic pages as they change{now.reviewedAt ? `; Qalam AI last reviewed them ${ago(now.reviewedAt)}` : ""}.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-subtle rounded-lg bg-panel shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          {shown.map((n) => {
            const w = where(n);
            const isNew = since.current != null && n.at > since.current;
            const Icon = n.kind === "review" ? null : KIND_ICON[n.kind];
            return (
              <li key={n.key} className="flex items-start gap-[10px] px-[12px] py-[10px]">
                <span className={clsx("mt-[2px] shrink-0", n.kind === "disputed" || n.kind === "untested" ? "text-warning" : "text-fg-subtle")}>{Icon ? <Icon {...ICON} /> : <QalamAIGlyph size={14} />}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="text-body text-fg">{n.title}</span>
                  <span className="line-clamp-2 text-caption text-fg-muted">{n.why}</span>
                  <span className="flex flex-wrap items-center gap-x-[6px] gap-y-[2px] text-caption text-fg-subtle">
                    {isNew && <Tag tone="ai">New</Tag>}
                    <span>{NOTICE_LABEL[n.kind]}</span>
                    {w && (
                      <>
                        <span aria-hidden>·</span>
                        <a href={w.href} className="underline decoration-fg/20 underline-offset-2 hover:text-fg">
                          {w.label}
                        </a>
                      </>
                    )}
                    {n.other && (
                      <>
                        <span aria-hidden>·</span>
                        <a href={cardHref(n.other.board, n.other.card)} className="underline decoration-fg/20 underline-offset-2 hover:text-fg">
                          {boardName(n.other.board) ?? "The other board"}
                        </a>
                      </>
                    )}
                    <span aria-hidden>·</span>
                    <span>{ago(n.at)}</span>
                  </span>
                </div>
                <Actions n={n} />
              </li>
            );
          })}
        </ul>
      )}
      {(list.length > SHOWN || (now?.dismissed ?? 0) > 0) && (
        <p className="flex gap-[10px] text-caption text-fg-subtle">
          {list.length > SHOWN && (
            <button type="button" className={clsx(r.link, "text-caption")} onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show all ${list.length}`}
            </button>
          )}
          {(now?.dismissed ?? 0) > 0 && <span>{now!.dismissed} dismissed</span>}
        </p>
      )}
    </section>
  );
}

function Actions({ n }: { n: Notice }): ReactNode {
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    void fn().finally(() => setBusy(false));
  };
  return (
    <span className="flex shrink-0 items-center gap-[4px]">
      {n.kind === "same-need" && n.board && n.card && n.other && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => noticesDb.link(cardRef(n.board!, n.card!), cardRef(n.other!.board, n.other!.card)))}>
          Link them
        </Button>
      )}
      <IconBtn size="sm" label="Dismiss: it won't come back" disabled={busy} onClick={() => run(() => noticesDb.dismiss(n.key))}>
        <X {...ICON} />
      </IconBtn>
    </span>
  );
}
