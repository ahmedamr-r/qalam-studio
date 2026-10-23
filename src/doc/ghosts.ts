import { create } from "zustand";
import type { Doc, SceneNode } from "./schema";

/**
 * Screens the AI is still writing, drawn on the canvas as they take shape. They live outside the
 * document: never selected, linted, undone or saved. When the answer is complete the real screens
 * are inserted and the ghosts cleared.
 */
export interface Ghost {
  /** Stable per screen being built, e.g. `${turnId}:${index}`. */
  key: string;
  turnId: string;
  /** Which screen of the answer, left to right. */
  index: number;
  /** The reservation whose box this screen fills, if any. */
  reservationId?: string;
  /** One root frame and its nodes, laid out in world coordinates. */
  doc: Doc;
  /** A screen in the document this ghost stands in for while it's rebuilt (hidden meanwhile). */
  covers?: string;
}

export const useGhosts = create<{ list: Ghost[] }>(() => ({ list: [] }));

export function setGhost(g: Ghost) {
  useGhosts.setState((s) => {
    const i = s.list.findIndex((x) => x.key === g.key);
    return { list: i < 0 ? [...s.list, g] : s.list.map((x, j) => (j === i ? g : x)) };
  });
}

export function clearGhosts(turnId: string) {
  if (!useGhosts.getState().list.some((g) => g.turnId === turnId)) return;
  useGhosts.setState((s) => ({ list: s.list.filter((g) => g.turnId !== turnId) }));
}

export const ghostDocs = (): Doc[] => useGhosts.getState().list.map((g) => g.doc);

/** A node of any ghost, with the ghost document it belongs to. */
export function ghostNode(id: string): { doc: Doc; node: SceneNode } | null {
  for (const g of useGhosts.getState().list) if (g.doc.nodes[id]) return { doc: g.doc, node: g.doc.nodes[id] };
  return null;
}
