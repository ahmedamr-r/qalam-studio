import type { RankedNeed } from "@/hub/needs";
import { orgJson } from "./client";

/** What to work on next: every need page, the best-backed first (server/org/needs.ts). */
export interface NeedsNow {
  /** False without the search index on this computer: nothing could be ranked. */
  indexed: boolean;
  needs: RankedNeed[];
}

export const needsDb = {
  list: () => orgJson<NeedsNow>("/needs"),
};
