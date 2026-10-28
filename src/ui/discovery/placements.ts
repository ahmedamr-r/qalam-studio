import { create } from "zustand";
import type { Proposal } from "@/discovery/proposals";
import { orgJson } from "@/org/client";
import { startReview, useReview } from "./review";
import { visitSources } from "./sources";

/**
 * What Qalam AI proposed for this board from material added to the organization (its home, its
 * inbox; server/capture.ts): kept on each source until the board reviews it. The review is the
 * board's own (accept, discard, one by one or all), its quotes' sources visiting until accepted.
 */

export interface Placement {
  sourceId: string;
  title: string;
  at: number;
  proposals: Proposal[];
}

export const usePlacements = create<{ board: string | null; list: Placement[] }>(() => ({ board: null, list: [] }));

export async function loadPlacements(board: string) {
  const list = await orgJson<Placement[]>(`/placements?board=${encodeURIComponent(board)}`).catch(() => [] as Placement[]);
  usePlacements.setState({ board, list });
}

/** Open what's waiting as a review (false when another review is open). */
export async function reviewPlacements(): Promise<boolean> {
  const { list } = usePlacements.getState();
  if (!list.length || useReview.getState().proposals.length) return false;
  await visitSources(list.map((p) => p.sourceId));
  const ok = startReview({ kind: "placed", sourceIds: list.map((p) => p.sourceId) }, list.flatMap((p) => p.proposals));
  // Under review now: what's left when it closes is kept on the sources, and read again from there.
  if (ok) usePlacements.setState({ list: [] });
  return ok;
}
