import type { FilingTotals } from "@/hub/filing";

/** What a capture did (server/capture.ts): the source it kept, what was picked out, filed and placed. */
export interface CaptureResult {
  sourceId: string;
  title: string;
  quotes: number;
  needs: number;
  /** An interview waits until someone says who is who in it (on a board). */
  waiting?: "roles";
  filed?: FilingTotals;
  /** Proposals waiting on each board. */
  placed: { board: string; name: string; count: number }[];
}
