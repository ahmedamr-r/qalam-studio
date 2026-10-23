import { create } from "zustand";
import type { Box } from "./geometry";
import type { Doc } from "./schema";
import type { Platform } from "@/design-system/platform";

/**
 * Canvas space held for AI work in progress, outside the document and undo history. New screens
 * reserve empty frames where they will land; in-place work (critique, extraction, restyle, fixes)
 * covers the layers it reads or rebuilds. Both shimmer on the canvas until the work finishes, and
 * covered layers are locked meanwhile: they can't be hit, selected or edited (see isBusy).
 */
/** A frame to be created: its world box and the layout sketched inside it while it waits. */
export interface ReservedBox extends Box {
  sketch?: Platform;
}

export interface Reservation {
  id: string;
  /** What's happening, e.g. "Generating" or "Restyling". */
  label: string;
  /** New frames, in world coordinates, left to right. */
  boxes: ReservedBox[];
  /** Existing layers being read or rebuilt in place: dimmed, shimmering and locked. */
  nodeIds: string[];
  /** The AI request doing the work, when it shows its own cursor (see src/ui/ai/agents.ts). */
  owner?: string;
}

export const useReservations = create<{ list: Reservation[] }>(() => ({ list: [] }));

let seq = 0;

export function reserve(label: string, boxes: ReservedBox[], nodeIds: string[] = [], owner?: string): string {
  const id = `r${++seq}`;
  useReservations.setState((s) => ({ list: [...s.list, { id, label, boxes, nodeIds, ...(owner ? { owner } : {}) }] }));
  return id;
}

/** Change what a reservation holds, e.g. room for more screens than expected. */
export function updateReservation(id: string, patch: Partial<Omit<Reservation, "id">>) {
  useReservations.setState((s) => ({ list: s.list.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
}

export function release(id: string) {
  useReservations.setState((s) => ({ list: s.list.filter((r) => r.id !== id) }));
}

/** Every reserved new frame, for placement to keep clear of. */
export const reservedBoxes = (): Box[] => useReservations.getState().list.flatMap((r) => r.boxes);

/** Layers AI is working on in place. Everything inside them is busy too (see isBusy). */
export const busyIds = (): Set<string> => new Set(useReservations.getState().list.flatMap((r) => r.nodeIds));

/** Whether AI is working on this layer or on a layer it sits in, so the designer can't edit it until the work ends or is stopped. */
export function isBusy(doc: Doc, id: string, busy = busyIds()): boolean {
  if (!busy.size) return false;
  for (let cur: string | null = id; cur && doc.nodes[cur]; cur = doc.nodes[cur].parentId) if (busy.has(cur)) return true;
  return false;
}
