import { Waypoints } from "lucide-react";
import clsx from "clsx";
import { ref } from "@/knowledge/refs";
import { decisionByFrame, traceByTurn, useKnowledge } from "@/knowledge/store";
import type { DecisionTrace } from "@/knowledge/types";
import type { ChatTurn } from "../ai/chatTypes";
import { useChats } from "../ai/chats";
import { openWorkspace } from "../workspace/store";

/**
 * "Why?": from a chat turn, a screen or a verdict to the Knowledge hub, with the decision behind
 * it selected and its trace lit (what it relied on, what else it was given, what it made).
 */

/** Open the hub on a node; `asOf` moves the timeline back when the decision is older than the graph's window. */
export function openWhy(nodeRef: string, asOf?: number) {
  openWorkspace("knowledge", { focus: { ref: nodeRef, at: Date.now(), ...(asOf ? { asOf } : {}) } });
}

const TOOLS_WITH_WHY = new Set<ChatTurn["tool"]>(["generate", "critique", "tune", "detective", "extract", "component", "audit", "direction"]);

/** A turn's decision, as the hub names it. */
export function turnDecision(t: ChatTurn): { ref: string; at: number } {
  const trace = traceByTurn(t.id);
  return trace ? { ref: ref.decision(trace.id), at: trace.at } : { ref: ref.decision(`turn:${t.id}`), at: t.at };
}

/** The latest decision that made a screen: its trace, else the Generate turn that placed it. */
export function screenDecision(frameId: string): { ref: string; at: number } | null {
  const trace = decisionByFrame(frameId);
  if (trace) return { ref: ref.decision(trace.id), at: trace.at };
  let hit: { ref: string; at: number } | null = null;
  for (const c of useChats.getState().chats)
    for (const t of c.turns) if (t.outcome?.kind === "generate" && t.outcome.frameIds.includes(frameId) && (!hit || t.at > hit.at)) hit = { ref: ref.decision(`turn:${t.id}`), at: t.at };
  return hit;
}

/** The latest critique of a screen: its trace, else the verdict fact. */
export function verdictDecision(frameId: string, traces: DecisionTrace[] = useKnowledge.getState().traces): { ref: string; at?: number } {
  let hit: DecisionTrace | null = null;
  for (const t of traces) if (t.kind === "critique" && t.about?.includes(frameId) && (!hit || t.at > hit.at)) hit = t;
  return hit ? { ref: ref.decision(hit.id), at: hit.at } : { ref: ref.verdict(frameId) };
}

export function WhyLink({ t, className }: { t: ChatTurn; className?: string }) {
  // Re-render when the turn's trace arrives.
  useKnowledge((s) => s.traces.length);
  if (t.status !== "done" || !t.outcome || !TOOLS_WITH_WHY.has(t.tool)) return null;
  const d = turnDecision(t);
  return (
    <button
      type="button"
      onClick={() => openWhy(d.ref, d.at)}
      title="See what Qalam AI relied on for this, in the Knowledge hub"
      className={clsx("inline-flex items-center gap-[4px] self-start rounded-sm text-micro text-fg-subtle underline-offset-2 hover:text-fg hover:underline", className)}
    >
      <Waypoints size={11} absoluteStrokeWidth strokeWidth={1.25} aria-hidden />
      Why?
    </button>
  );
}
