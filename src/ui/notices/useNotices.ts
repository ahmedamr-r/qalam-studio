import { useEffect, useState } from "react";
import { onOrgChange } from "@/org/live";
import { noticesDb, onNoticesWritten, type NoticesNow } from "@/org/notices";
import { onTopicsWritten } from "@/org/topics";

const stale = new Set<() => void>();

/** This window changed something notices are made from (the server announces only other windows' changes): check again once it settles. */
export function noticesStale() {
  for (const fn of stale) fn();
}

/**
 * What needs a look (null while loading): all of it, or what's about one board's cards. Checked
 * again when anything it's made from changes, here or elsewhere (a board, a source, a page, a
 * decision, a dismissal), once things settle.
 */
export function useNotices(board?: string | null): NoticesNow | null {
  const [now, setNow] = useState<NoticesNow | null>(null);
  useEffect(() => {
    if (board === null) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      void noticesDb.list(board).then(
        (n) => alive && setNow(n),
        () => alive && setNow({ notices: [], lastVisit: null, reviewedAt: null, dismissed: 0 }),
      );
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 1200);
    };
    load();
    const offOrg = onOrgChange((c) => {
      if (c.kind === "project" || c.kind === "source" || c.kind === "topic" || c.kind === "decision" || c.kind === "notice" || c.kind === "relation") soon();
    });
    const offNotices = onNoticesWritten(load);
    const offTopics = onTopicsWritten(soon);
    stale.add(soon);
    return () => {
      alive = false;
      clearTimeout(timer);
      offOrg();
      offNotices();
      offTopics();
      stale.delete(soon);
    };
  }, [board]);
  return now;
}
