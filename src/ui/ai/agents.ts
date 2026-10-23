import { create } from "zustand";
import type { Box } from "@/doc/geometry";

/**
 * Qalam AI at work on the canvas, one entry per running request: where its cursor points, what
 * it's thinking or doing (the cursor's bubble), what it has built so far (the chat's "Creating…"
 * chips) and the glow on each new element. Lives only while the request runs; the chat keeps the
 * outcome. Each agent is named for its job, like a collaborator in Figma, and shows in the top
 * bar, where clicking it follows its cursor.
 */

export type AgentPhase = "thinking" | "building" | "checking";

/** The kind of job, which gives the agent its name. */
export type AgentKind = "designer" | "systems" | "critic" | "strategist";

export const AGENT_PROFILE: Record<AgentKind, { name: string; role: string; color: number }> = {
  designer: { name: "Designer", role: "Designs and edits screens", color: 2 },
  systems: { name: "System builder", role: "Builds design systems from screenshots", color: 0 },
  critic: { name: "Critic", role: "Reviews screens against their goal", color: 1 },
  strategist: { name: "Strategist", role: "Drafts the opportunity tree", color: 3 },
};

export interface AgentCreated {
  /** Which screen of the answer. */
  variant: number;
  specPath: string;
  name: string;
  component: string;
}

/** A paragraph of the agent's running commentary and what it built under it. */
export interface AgentStep {
  key: string;
  /** e.g. the screen's name, shown in bold before the text. */
  title?: string;
  text: string;
  /** The text is still being written. */
  writing: boolean;
  created: AgentCreated[];
}

export interface Glow {
  id: number;
  at: number;
  box: Box;
}

export interface Agent {
  turnId: string;
  chatId: string;
  kind: AgentKind;
  /** The cursor's name tag, e.g. "Designer" (or "Designer 2" while another one works). */
  name: string;
  /** What it's working on (the chat's title), for the top bar's tooltip. */
  task: string;
  /** Held canvas space with this owner is this agent's work, so it gets no second, parked cursor. */
  claims?: string;
  /** Index into the agent colours (--color-agent-1…4). */
  color: number;
  phase: AgentPhase;
  /** One word for the status line, e.g. "Building". */
  activity: string;
  /** World box the cursor points at. */
  target: Box | null;
  /** The model's own (summarized) thinking, latest part. */
  thought: string;
  thoughtAt: number;
  /** What it's doing, from what it's writing: the approach, a screen's rationale, "Adding …". */
  narration: string;
  narrationAt: number;
  steps: AgentStep[];
  glows: Glow[];
  started: number;
}

export const AGENT_COLORS = 4;
const THOUGHT_CHARS = 400;
const GLOW_MS = 1400;

/** `following`: the agent the camera follows (see follow.ts), until the designer moves the camera. */
export const useAgents = create<{ agents: Agent[]; following: string | null }>(() => ({ agents: [], following: null }));

const get = () => useAgents.getState().agents;
const put = (turnId: string, fn: (a: Agent) => Agent) => useAgents.setState((s) => ({ agents: s.agents.map((a) => (a.turnId === turnId ? fn(a) : a)) }));

export const agentFor = (turnId: string): Agent | undefined => get().find((a) => a.turnId === turnId);

/** The kind's own colour, else the lowest colour no running agent has, so two at once never look alike. */
function freeColor(kind: AgentKind): number {
  const used = new Set(get().map((a) => a.color));
  if (!used.has(AGENT_PROFILE[kind].color)) return AGENT_PROFILE[kind].color;
  for (let i = 0; i < AGENT_COLORS; i++) if (!used.has(i)) return i;
  return get().length % AGENT_COLORS;
}

/** The kind's name, numbered while another agent of the same kind is at work. */
function freeName(kind: AgentKind): string {
  const base = AGENT_PROFILE[kind].name;
  const used = new Set(get().map((a) => a.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function startAgent(a: { turnId: string; chatId: string; kind: AgentKind; task?: string; claims?: string; phase?: AgentPhase; activity?: string; target?: Box | null }): Agent {
  const existing = agentFor(a.turnId);
  if (existing) return existing;
  const agent: Agent = {
    turnId: a.turnId,
    chatId: a.chatId,
    kind: a.kind,
    name: freeName(a.kind),
    task: a.task ?? "",
    ...(a.claims ? { claims: a.claims } : {}),
    color: freeColor(a.kind),
    phase: a.phase ?? "thinking",
    activity: a.activity ?? "Thinking",
    target: a.target ?? null,
    thought: "",
    thoughtAt: 0,
    narration: "",
    narrationAt: 0,
    steps: [],
    glows: [],
    started: Date.now(),
  };
  useAgents.setState((s) => ({ agents: [...s.agents, agent] }));
  return agent;
}

export function updateAgent(turnId: string, patch: Partial<Agent>) {
  put(turnId, (a) => ({ ...a, ...patch }));
}

export function endAgent(turnId: string) {
  if (!agentFor(turnId)) return;
  useAgents.setState((s) => ({ agents: s.agents.filter((a) => a.turnId !== turnId), following: s.following === turnId ? null : s.following }));
}

export const isFollowing = (turnId: string) => useAgents.getState().following === turnId;

export function appendThought(turnId: string, text: string) {
  put(turnId, (a) => ({ ...a, thought: (a.thought + text).slice(-THOUGHT_CHARS), thoughtAt: Date.now() }));
}

export function narrate(turnId: string, text: string) {
  put(turnId, (a) => (a.narration === text ? a : { ...a, narration: text, narrationAt: Date.now() }));
}

/** Add or update a paragraph of commentary (keyed, e.g. "approach" or "variant-1"). */
export function setStep(turnId: string, key: string, text: string, writing: boolean, title?: string) {
  put(turnId, (a) => {
    const i = a.steps.findIndex((s) => s.key === key);
    if (i >= 0 && a.steps[i].text === text && a.steps[i].writing === writing && a.steps[i].title === title) return a;
    const steps = i < 0 ? [...a.steps, { key, title, text, writing, created: [] }] : a.steps.map((s, j) => (j === i ? { ...s, title, text, writing } : s));
    return { ...a, steps };
  });
}

let glowSeq = 0;

/** Something new on the canvas: listed under its step, glowing briefly where it landed. */
export function addCreated(turnId: string, stepKey: string, c: AgentCreated, box: Box | null) {
  const now = Date.now();
  put(turnId, (a) => ({
    ...a,
    steps: a.steps.map((s) => (s.key === stepKey ? { ...s, created: [...s.created, c] } : s)),
    glows: box ? [...a.glows.filter((g) => now - g.at < GLOW_MS), { id: ++glowSeq, at: now, box }] : a.glows,
  }));
}

/** The bubble's text: whichever of its thinking or its commentary changed last, last three lines. */
export function bubbleText(a: Pick<Agent, "thought" | "thoughtAt" | "narration" | "narrationAt" | "activity">): string {
  const text = (a.thought && a.thoughtAt >= a.narrationAt ? a.thought : a.narration) || `${a.activity}…`;
  return text.trim().split(/\n+/).slice(-3).join("\n");
}

