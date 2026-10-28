import { useEffect, useState } from "react";
import { onOrgChange } from "@/org/live";
import { needsDb, type NeedsNow } from "@/org/needs";
import { onTopicsWritten } from "@/org/topics";

/**
 * What to work on next (null while loading), ranked again when what it's made from changes, here or
 * elsewhere (a page, a source, a board), once things settle.
 */
export function useNeeds(): NeedsNow | null {
  const [now, setNow] = useState<NeedsNow | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      void needsDb.list().then(
        (n) => alive && setNow(n),
        () => alive && setNow({ indexed: false, needs: [] }),
      );
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 1200);
    };
    load();
    const offOrg = onOrgChange((c) => {
      if (c.kind === "project" || c.kind === "source" || c.kind === "topic") soon();
    });
    const offTopics = onTopicsWritten(soon);
    return () => {
      alive = false;
      clearTimeout(timer);
      offOrg();
      offTopics();
    };
  }, []);
  return now;
}
