/**
 * The hub's timeline (pure): the moments the memory changed — a fact learned, a decision made —
 * in order, so the scrubber can step through them and replay how the knowledge grew.
 */
import type { KnowledgeGraph } from "./types";

export interface TimelineEvent {
  at: number;
  ref: string;
  kind: "decision" | "fact";
  label: string;
}

/** Every dated moment in a graph built with no window and no moment (built-in facts have none). */
export function timelineEvents(full: KnowledgeGraph): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const n of full.nodes) {
    if (!n.at || n.group === "anchor") continue;
    out.push({ at: n.at, ref: n.ref, kind: n.kind === "decision" ? "decision" : "fact", label: n.label });
  }
  return out.sort((a, b) => a.at - b.at || (a.ref < b.ref ? -1 : 1));
}

/** Distinct moments to step through (several facts learned in one turn are one step). */
export function steps(events: TimelineEvent[]): number[] {
  const out: number[] = [];
  for (const e of events) if (out[out.length - 1] !== e.at) out.push(e.at);
  return out;
}

/** Where a moment sits on the track, 0–1, between the first event and now. */
export function trackPos(at: number, first: number, last: number): number {
  if (last <= first) return 1;
  return Math.min(1, Math.max(0, (at - first) / (last - first)));
}

/** The step at or before a moment (−1: before every event). */
export function stepAt(stepList: number[], asOf: number | null): number {
  if (asOf === null) return stepList.length;
  let i = -1;
  for (let j = 0; j < stepList.length; j++) if (stepList[j] <= asOf) i = j;
  return i;
}
