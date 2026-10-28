import { useEffect, useState } from "react";
import type { Bearing } from "@/goals/bearings";
import { orgJson } from "@/org/client";
import { onOrgChange } from "@/org/live";

/** Which problems bear on which goals (hub/bearings.jsonl, as they are now), kept current. Null while loading. */
export function useBearings(): Bearing[] | null {
  const [links, setLinks] = useState<Bearing[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void orgJson<Bearing[]>("/bearings").then((l) => alive && setLinks(l), () => alive && setLinks([]));
    load();
    const off = onOrgChange((c) => c.kind === "bearing" && load());
    return () => {
      alive = false;
      off();
    };
  }, []);
  return links;
}
