/*
 * What an AI surface hands the chat pieces (./ChatThread.tsx, ./StepList.tsx): messages made of
 * text and named parts the surface draws itself, and the steps on the left. Plain data, so a
 * surface can work its thread out from what it keeps (and test that) without any React.
 */

/** Small values only: a part's renderer reads the rest from the surface's stores. */
export type PartData = Record<string, string | number | boolean | null>;

export type ChatPart = { type: "text"; text: string } | { type: "data"; name: string; data: PartData };

export interface ChatMessage {
  /** Steady across renders: the thread keeps its place and its scroll by it. */
  id: string;
  role: "assistant" | "user";
  parts: ChatPart[];
}

export type StepState = "done" | "now" | "next";

export interface ChatStep {
  id: string;
  label: string;
  state: StepState;
  sub?: { label: string; state: StepState }[];
}
