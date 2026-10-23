import { GENERATOR_VERSION, GROUP_KNOBS, type Direction, type KnobGroup, type KnobId, type Knobs, type ReadBack } from "@/design-system/interview/knobs";
import { withComponentChoice } from "@/design-system/interview/components";
import type { FollowUp, KnobDelta, ReviewResult } from "@/design-system/interview/sanitize";
import type { FlowState } from "@/ui/ai/questionFlow";

/**
 * The brand interview of a design-system project, saved on the project record so an unfinished
 * one can be resumed from the home. Only answers and choices are kept: tokens are always derived
 * from the knobs again (the saved system keeps its full tree).
 */

export type InterviewStage = "brief" | "read" | "directions" | "refine" | "components" | "saved";

export interface HistoryEntry {
  knobs: Knobs;
  cause: "direction" | "change" | "mix" | "nudge" | "review" | "component";
  /** What changed, in a few words ("Corners: large"). */
  note: string;
  at: number;
}

export interface InterviewState {
  v: 1;
  stage: InterviewStage;
  /** The generator the knobs were last shown with (a newer one may draw them a little differently). */
  generatorVersion?: number;
  brief?: { flow: FlowState; followUps?: { questions: FollowUp[]; flow: FlowState } };
  read?: ReadBack;
  /** Answered with the recorded sample (no AI). */
  sample?: boolean;
  directions?: { list: Direction[]; recommended: number; picked?: number };
  knobs?: Knobs;
  locks?: KnobId[];
  history?: { entries: HistoryEntry[]; index: number };
  nudges?: { text: string; reply: string; applied: KnobDelta[]; at: number }[];
  /**
   * The components step: shape them one by one (the pyramid, from the keystone down) or keep them
   * following the system together. The choices themselves live in the knobs (`knobs.components`).
   */
  components?: { mode?: "individual" | "together"; focus?: string; reviewed: string[] };
  /** Qalam AI's last review: what it saw, and the knobs it would change (applied only if the designer says so). */
  review?: Omit<ReviewResult, "knobs"> & { suggested: Knobs; knobHash: string; scenario: string; at: number };
}

export const HISTORY_LIMIT = 200;

const commit = (s: InterviewState, knobs: Knobs, cause: HistoryEntry["cause"], note: string, now: number): InterviewState => {
  const h = s.history ?? { entries: [], index: -1 };
  const entries = [...h.entries.slice(0, h.index + 1), { knobs, cause, note, at: now }].slice(-HISTORY_LIMIT);
  return { ...s, knobs, history: { entries, index: entries.length - 1 }, generatorVersion: GENERATOR_VERSION };
};

/** Start refining from a direction (history starts over). */
export function pickDirection(s: InterviewState, i: number, now = Date.now()): InterviewState {
  const d = s.directions?.list[i];
  if (!d) return s;
  const next: InterviewState = { ...s, stage: "refine", directions: { ...s.directions!, picked: i }, locks: s.locks ?? [], history: { entries: [], index: -1 } };
  return commit(next, d.knobs, "direction", d.name, now);
}

/** Set one knob (a locked knob stays). */
export function setKnob<K extends KnobId>(s: InterviewState, id: K, value: Knobs[K], note: string, now = Date.now()): InterviewState {
  if (!s.knobs || s.knobs[id] === value || s.locks?.includes(id)) return s;
  return commit(s, { ...s.knobs, [id]: value }, "change", note, now);
}

/** Several knobs at once, from a nudge or a review (already bounded by the sanitizer). */
export function applyKnobs(s: InterviewState, knobs: Knobs, cause: "nudge" | "review", note: string, now = Date.now()): InterviewState {
  if (!s.knobs || JSON.stringify(knobs) === JSON.stringify(s.knobs)) return s;
  return commit(s, knobs, cause, note, now);
}

/** Take one group (colour, type or shape) from another direction; locked knobs keep their value. */
export function mix(s: InterviewState, from: number, group: KnobGroup, now = Date.now()): InterviewState {
  const d = s.directions?.list[from];
  if (!d || !s.knobs) return s;
  const next = { ...s.knobs };
  for (const id of GROUP_KNOBS[group]) if (!s.locks?.includes(id)) (next as unknown as Record<string, unknown>)[id] = d.knobs[id];
  if (group === "colour" && !s.locks?.includes("hue")) next.brandHex = d.knobs.brandHex;
  if (JSON.stringify(next) === JSON.stringify(s.knobs)) return s;
  return commit(s, next, "mix", `${group[0].toUpperCase()}${group.slice(1)} from ${d.name}`, now);
}

/** One component's option (applies over the system; "system" goes back to following it). */
export function setComponentChoice(s: InterviewState, name: string, option: string, value: string, note: string, now = Date.now()): InterviewState {
  if (!s.knobs) return s;
  const next = withComponentChoice(s.knobs, name, option, value);
  if ((next.components?.[name]?.[option] ?? "system") === (s.knobs.components?.[name]?.[option] ?? "system")) return s;
  return commit(s, next, "component", note, now);
}

/** Every option of a component back to the system's. */
export function resetComponent(s: InterviewState, name: string, now = Date.now()): InterviewState {
  if (!s.knobs?.components?.[name]) return s;
  const components = { ...s.knobs.components };
  delete components[name];
  const next: Knobs = { ...s.knobs, components };
  if (!Object.keys(components).length) delete next.components;
  return commit(s, next, "component", `${name}: back to the system`, now);
}

export function setComponentsMode(s: InterviewState, mode: "individual" | "together"): InterviewState {
  return { ...s, components: { reviewed: [], ...s.components, mode } };
}

export function focusComponent(s: InterviewState, name: string): InterviewState {
  return { ...s, components: { reviewed: [], ...s.components, focus: name } };
}

/** The designer is happy with a component (it shows as done in the pyramid). */
export function markReviewed(s: InterviewState, name: string): InterviewState {
  const c = { reviewed: [] as string[], ...s.components };
  return c.reviewed.includes(name) ? s : { ...s, components: { ...c, reviewed: [...c.reviewed, name] } };
}

export function toggleLock(s: InterviewState, id: KnobId): InterviewState {
  const locks = s.locks ?? [];
  return { ...s, locks: locks.includes(id) ? locks.filter((x) => x !== id) : [...locks, id] };
}

export const canUndo = (s: InterviewState) => (s.history?.index ?? 0) > 0;
export const canRedo = (s: InterviewState) => !!s.history && s.history.index < s.history.entries.length - 1;

export function undo(s: InterviewState): InterviewState {
  if (!canUndo(s)) return s;
  const index = s.history!.index - 1;
  return { ...s, knobs: s.history!.entries[index].knobs, history: { ...s.history!, index } };
}

export function redo(s: InterviewState): InterviewState {
  if (!canRedo(s)) return s;
  const index = s.history!.index + 1;
  return { ...s, knobs: s.history!.entries[index].knobs, history: { ...s.history!, index } };
}

/** The knobs before the current ones (for the A/B flip). */
export const previousKnobs = (s: InterviewState): Knobs | null => (s.history && s.history.index > 0 ? s.history.entries[s.history.index - 1].knobs : null);

/** A saved state from an older version of the app, made current (unknown shapes start over). */
export function migrateInterview(raw: unknown): InterviewState {
  const s = raw as Partial<InterviewState> | null;
  if (!s || s.v !== 1 || typeof s.stage !== "string") return { v: 1, stage: "brief" };
  // A refine step without knobs (cut short) goes back to the directions.
  if (s.stage === "refine" && !s.knobs) return { ...(s as InterviewState), stage: s.directions ? "directions" : "brief" };
  return s as InterviewState;
}
