import type { Doc } from "@/doc/schema";
import { create } from "zustand";
import type { Box } from "@/doc/geometry";
import { studio } from "@/doc/store";
import { currentProject, useProject } from "@/projects/session";
import type { SpaceTag, SpaceThing } from "./compose";

/*
 * What the board's editing needs to know about a space's canvas while one is open (the home): the
 * cards that aren't on a board, what's drawn faint or tagged, the board each card is on. Board
 * code asks `boardOfCard` instead of the open project, so the same code works on a board's page
 * and on the space's canvas.
 */

/** A canvas laid out: its cards, and each goal's sources lane and where it goes. */
export interface SpacePreview {
  doc: Doc;
  groups: readonly { head: string; cards: string[] }[];
  slots: ReadonlyMap<string, Box>;
}

export interface SpaceView {
  /** A space's canvas is what the studio holds (not a board's page). */
  active: boolean;
  space: string | null;
  things: ReadonlyMap<string, SpaceThing>;
  /** The board each card is on, as last composed or saved. */
  boardOf: ReadonlyMap<string, string>;
  /** Cards on no board: goals with no board yet, problems' pages. */
  virtual: ReadonlySet<string>;
  faint: ReadonlySet<string>;
  fainter: ReadonlySet<string>;
  tags: ReadonlyMap<string, SpaceTag>;
  noticed: ReadonlySet<string>;
  /** Each goal's own cards, for its sources lane; `slots` says where its lane goes. */
  groups: readonly { head: string; cards: string[] }[];
  slots: ReadonlyMap<string, Box>;
  /** While a review is open: the canvas as accepting would leave it, which its ghosts draw and the lane follows. */
  preview: SpacePreview | null;
  /** The boards it holds: their names and products. */
  boards: ReadonlyMap<string, { name: string; product: string | null }>;
}

const EMPTY: SpaceView = { preview: null, active: false, space: null, things: new Map(), boardOf: new Map(), virtual: new Set(), faint: new Set(), fainter: new Set(), tags: new Map(), noticed: new Set(), groups: [], slots: new Map(), boards: new Map() };

export const useSpaceView = create<SpaceView>(() => EMPTY);
export const resetSpaceView = () => useSpaceView.setState(EMPTY, true);

/** Whether the studio holds a space's canvas. */
export const onSpaceCanvas = () => useSpaceView.getState().active;

/**
 * The board a card is on: on a board's page, that board; on a space's canvas, the card's own (a new
 * card's is the card above it's; null under a goal with no board yet, until the save starts one).
 */
export function boardOfCard(id: string | null | undefined): string | null {
  const v = useSpaceView.getState();
  if (!v.active) return currentProject()?.id ?? null;
  const doc = studio().doc;
  let at = id ?? null;
  while (at) {
    if (v.virtual.has(at)) return null;
    const b = v.boardOf.get(at);
    if (b) return b;
    at = doc.nodes[at]?.parentId ?? null;
  }
  return null;
}

/** The product a card's board is for (on a board's page, the board's). */
export function productOfCard(id: string | null | undefined): string | null {
  const v = useSpaceView.getState();
  if (!v.active) return currentProject()?.product ?? null;
  const b = boardOfCard(id);
  return (b ? v.boards.get(b)?.product : null) ?? v.space;
}

/** The boards the canvas holds: the open board, or the space's. */
export function canvasBoards(): string[] {
  const v = useSpaceView.getState();
  if (!v.active) {
    const p = currentProject();
    return p ? [p.id] : [];
  }
  return [...v.boards.keys()];
}

/** The board a card is on, as a hook (a board's page: that board). */
export function useCardBoard(id: string | null | undefined): string | null {
  const space = useSpaceView((s) => (s.active ? (id ? (s.boardOf.get(id) ?? null) : null) : undefined));
  const project = useProject((s) => s.project?.id ?? null);
  return space === undefined ? project : space;
}

/** The board a whole-canvas action goes to (a brain dump, sources added): the open board, or the selected card's, else the space's first. */
export function canvasBoard(): string | null {
  if (!useSpaceView.getState().active) return currentProject()?.id ?? null;
  return boardOfCard(studio().selection[0]) ?? canvasBoards()[0] ?? null;
}

/** The product a whole-canvas action is for: the open board's, or the selected card's, else the space's. */
export function canvasProduct(): string | null {
  if (!useSpaceView.getState().active) return currentProject()?.product ?? null;
  return productOfCard(studio().selection[0]);
}
