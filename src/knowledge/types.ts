/**
 * The Knowledge hub's model: everything Qalam AI knows about a project, as one graph. It is a view
 * rebuilt from the stores that already hold the knowledge (the brief, the design systems, naming
 * memory, chats); only decision traces, forget/pin controls and graph positions are stored anew.
 */

/** The colour groups of the graph. Anchors are the things knowledge is about (screens, tokens, components, systems). */
export type Group = "you" | "system" | "learned" | "research" | "decision" | "anchor";

/** Where a fact came from. */
export type Origin = "you" | "interview" | "discovery" | "extraction" | "built-in" | "imported" | "tune" | "critique" | "detective" | "ai" | "web";

export type NodeKind =
  // The brief
  | "summary"
  | "answer"
  | "screen-goal"
  | "verdict"
  // A design system's written rules
  | "language"
  | "principle"
  | "do"
  | "dont"
  | "layout"
  | "template"
  | "rule"
  | "structure"
  | "guide"
  | "gap"
  | "pattern"
  | "tokens"
  | "inferred"
  // Memory and research
  | "naming"
  | "research"
  | "source"
  | "chat"
  // Decisions and anchors
  | "decision"
  | "token"
  | "component"
  | "screen"
  | "system";

export interface Provenance {
  origin: Origin;
  at: number;
  decisionId?: string;
  turnId?: string;
  /** Why it was added (Tune's reason for a rule). */
  reason?: string;
  /** The fact key this one replaced when it was edited. */
  editedFrom?: string;
}

export type NodeStatus = "active" | "forgotten" | "capped" | "ghost";

export interface KnowledgeNode {
  ref: string;
  kind: NodeKind;
  group: Group;
  /** Short name shown on the graph. */
  label: string;
  /** The fact as Qalam AI reads it. */
  text: string;
  /** A second line for the inspector (the question an answer replies to, a verdict's issues…). */
  detail?: string;
  origin: Origin;
  /** When it was learned or made (0: built in). */
  at: number;
  systemId?: string;
  /** Can't be edited in place (built-in rules fork on edit; anchors and decisions aren't facts). */
  readOnly?: boolean;
  status: NodeStatus;
  pinned?: boolean;
  provenance?: Provenance;
  /** How many decisions were given this fact, and how many relied on it. */
  usage: { given: number; relied: number };
  /** Screens: the root frame on the canvas. */
  frameId?: string;
  /** Decisions: the trace behind the node. */
  decision?: DecisionInfo;
}

export type EdgeKind =
  /** A decision relied on a fact (the model said so, and the fact was in its request). */
  | "relied"
  /** A fact was in a decision's request but it didn't rely on it. */
  | "given"
  /** A decision made a screen, a rule or a system. */
  | "produced"
  /** A fact or decision is about a screen. */
  | "about"
  /** A component guide is styled with a token. */
  | "uses"
  /** A rule names a component. */
  | "mentions"
  /** A fact belongs to a design system. */
  | "part"
  /** Research found a source. */
  | "source"
  /** A fix followed a critique. */
  | "parent"
  /** An earlier turn of the same chat (chat memory). */
  | "context";

export interface KnowledgeEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** relied: the model's words on why. */
  why?: string;
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  byRef: Map<string, KnowledgeNode>;
  /** Decisions older than the window, folded into the timeline. */
  earlier: number;
}

// ---------------------------------------------------------------------------
// Decision traces: what a request was given, and what the model relied on.

export type DecisionKind = "generate" | "section" | "critique" | "fix" | "tune" | "extract" | "plan" | "detective" | "component" | "audit" | "direction" | "discovery";

export interface ReliedOn {
  ref: string;
  /** The model's words: why this fact shaped the result. */
  why: string;
  /** The fact as it was read (so an edited or removed rule still shows what was used). */
  text: string;
}

export interface DecisionTrace {
  v: 1;
  id: string;
  projectId: string;
  kind: DecisionKind;
  at: number;
  updatedAt: number;
  title: string;
  summary?: string;
  chatId?: string;
  turnId?: string;
  /** A fix's critique. */
  parentId?: string;
  model?: string;
  sample?: boolean;
  status: "done" | "partial" | "stopped" | "proposed" | "applied" | "undone";
  /** Everything sent with the request: [ref, hash of the text sent]. */
  given: [string, string][];
  reliedOn: ReliedOn[];
  produced: { frames?: string[]; refs?: string[]; removed?: string[]; tokens?: string[]; systemId?: string };
  /** Screens the request was about. */
  about?: string[];
  /** What the model had to guess because nobody told it (checked: known topics, short, at most four). */
  assumed?: { topic: string; guess: string }[];
}

/** What a decision node carries for the inspector. */
export interface DecisionInfo {
  kind: DecisionKind;
  title: string;
  summary?: string;
  chatId?: string;
  turnId?: string;
  model?: string;
  status: DecisionTrace["status"] | "running" | "error";
  /** Recorded before tracing: only what it produced is known. */
  legacy?: boolean;
  /** A kind of request that doesn't record what it relied on (yet). */
  untraced?: boolean;
  givenCount: number;
  reliedOn: ReliedOn[];
  frames: string[];
  /** What the designer asked (the chat turn's request). */
  request?: string;
  /** Screens the request was about. */
  about?: string[];
  /** What it had to guess. */
  assumed?: { topic: string; guess: string }[];
  /** The trace behind it (none: made before tracing). */
  traceId?: string;
}

// ---------------------------------------------------------------------------
// Forget and pin (per project, kept in the document out of undo history).

export interface KnowledgeControls {
  v: 1;
  /** ref → when it was forgotten. */
  forgotten: Record<string, number>;
  /** ref → when it was pinned. */
  pinned: Record<string, number>;
}

export const emptyControls = (): KnowledgeControls => ({ v: 1, forgotten: {}, pinned: {} });
