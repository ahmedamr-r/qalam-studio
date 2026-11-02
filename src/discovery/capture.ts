import type { GoalNumber } from "./sources";
import type { BasisCounts } from "./basis";
import type { FilingTotals } from "@/hub/filing";

/** What a capture did (server/capture.ts): the source it kept, what was picked out, filed and placed. */
export interface CaptureResult {
  sourceId: string;
  title: string;
  quotes: number;
  needs: number;
  /** An interview waits until someone says who is who in it (on a board). */
  waiting?: "roles";
  /** Read as the person's own thinking: how many pieces of it, in their words. */
  own?: number;
  /** What it is, in a line, and its points by what they rest on. */
  about?: string;
  points?: BasisCounts;
  /** Numbers it measured for goals, for the person to use or not. */
  goalNumbers?: GoalNumber[];
  /** Nothing in it but the team's own thinking, and the caller said it would read that itself: nothing was kept. */
  heldOwn?: true;
  filed?: FilingTotals;
  /** Proposals waiting on each board. */
  placed: { board: string; name: string; count: number }[];
}
