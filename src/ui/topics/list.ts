import { useEffect, useState } from "react";
import type { TopicInfo } from "@/hub/topics";
import { onOrgChange } from "@/org/live";
import { onTopicsWritten, topicsDb } from "@/org/topics";

/** The organization's topic pages, most recently changed first (null while loading), kept current with this window's writes and others'. */
export function useTopics(): TopicInfo[] | null {
  const [list, setList] = useState<TopicInfo[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void topicsDb.list().then(
        (l) => alive && setList(l),
        () => alive && setList([]),
      );
    load();
    const offWritten = onTopicsWritten(load);
    const off = onOrgChange((c) => c.kind === "topic" && load());
    return () => {
      alive = false;
      offWritten();
      off();
    };
  }, []);
  return list;
}
