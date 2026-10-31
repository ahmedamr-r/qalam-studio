import { create } from "zustand";
import type { Proposal } from "@/discovery/proposals";
import { orgJson } from "@/org/client";
import { startReview, useReview } from "./review";
import { visitSources } from "./sources";
import { onSpaceCanvas } from "@/space/view";

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
  /** The board it waits on (a space's canvas holds several). */
  board?: string;
}

export const usePlacements = create<{ board: string | null; list: Placement[] }>(() => ({ board: null, list: [] }));

/** What waits on a board; on a space's canvas, on each of its boards (each placement says which). */
export async function loadPlacements(board: string) {
  const list = (await orgJson<Placement[]>(`/placements?board=${encodeURIComponent(board)}`).catch(() => [] as Placement[])).map((p) => ({ ...p, board }));
  if (onSpaceCanvas()) {
    usePlacements.setState((s) => ({ board: null, list: [...s.list.filter((p) => p.board !== board), ...list] }));
    return;
  }
  usePlacements.setState({ board, list });
}

/** Where what was placed waits, by source: the boards it was found for. */
let placedOn = new Map<string, string[]>();
export const boardsPlacedFor = (sourceId: string) => placedOn.get(sourceId) ?? [];

/** Open what's waiting as a review (false when another review is open). */
export async function reviewPlacements(): Promise<boolean> {
  const { list } = usePlacements.getState();
  if (!list.length || useReview.getState().proposals.length) return false;
  await visitSources(list.map((p) => p.sourceId));
  placedOn = new Map();
  for (const p of list) if (p.board) placedOn.set(p.sourceId, [...new Set([...(placedOn.get(p.sourceId) ?? []), p.board])]);
  const ok = startReview({ kind: "placed", sourceIds: list.map((p) => p.sourceId) }, list.flatMap((p) => p.proposals));
  // Under review now: what's left when it closes is kept on the sources, and read again from there.
  if (ok) usePlacements.setState({ list: [] });
  return ok;
}
