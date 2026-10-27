import type { AuditResult, ExtractResult, OffSystemNeed } from "@/ai/schemas";
import type { ResearchInfo } from "@/ai/research-shared";
import type { ScreenSpec } from "@/design-system/builders";
import type { ComponentDef } from "@/design-system/docs";
import type { Section } from "@/design-system/section";
import type { Platform } from "@/design-system/platform";
import type { Finding } from "@/lint/rules";
import type { GoalVerdict } from "@/doc/schema";
import type { DetectiveRow } from "./aiStore";
import type { Dir, DirectionMode, DirectionOutcome } from "./direction";
import type { TuneOutcome } from "./tune";
import type { RepairOutcome } from "./repair";
import type { ExtractOutcome } from "./extract";
import type { PlanState } from "./plan";
import type { DesignHandoff } from "@/discovery/types";
import type { Difference, RoleMatch } from "@/design-system/component-import";

/**
 * An AI chat: every request made from the AI panel (and every critique) is a turn in the active
 * chat, and later turns see the earlier ones as context until the designer starts a new chat.
 */

export type ChatTool = "generate" | "critique" | "detective" | "audit" | "direction" | "tune" | "extract" | "discovery" | "component";

export interface ChatRequest {
  /** The brief, the focus note, or (Detective) the pasted source. */
  text: string;
  lang?: "en" | "ar" | "both";
  /** Generate: the platform the screens are for. */
  platform?: Platform;
  /** Design system the request used. */
  system?: { id: string; name: string };
  /** Screens on the canvas the request was about. */
  screens?: { id: string; name: string }[];
  /**
   * Detective or Extract input. `image` is an "asset:" reference (the first of `images`, when
   * there are several); `sample` = the bundled sample screenshot, replayed from a recording.
   */
  source?: {
    mode: "css" | "json" | "image";
    count: number;
    image?: string;
    rebuild?: boolean;
    images?: { ref: string; name: string; nodeId?: string }[];
    sample?: boolean;
  };
  /** Connectors the request could look things up with (web search, Tavily, MCP servers). */
  connectors?: string[];
  /** Generate: replay the recorded sample through the live build instead of calling the model. */
  replay?: boolean;
  /** Generate: plan first (Qalam AI asks a few questions before it draws anything). */
  plan?: boolean;
  /** Generate: only these components of one screen change (the designer selected part of it). */
  section?: Section;
  /** Tune: the catalog component the request is about (asked from the component library). */
  component?: string;
  /** Direction: in place or as a copy, which way, and whether the copy is translated to match. */
  direction?: { mode: DirectionMode; to: Dir; translate: boolean };
  /** Add component, a follow-up: the earlier turn whose component this request changes. */
  revise?: { turnId: string; name: string };
}

export interface GenerateOutcome {
  kind: "generate";
  /** The model's line for the designer on the direction taken. */
  approach?: string;
  variants: ScreenSpec[];
  offSystem: OffSystemNeed[];
  frameIds: string[];
  /** The self-check after placing the screens. */
  repair?: RepairOutcome;
  /** Stopped while streaming: the screens are what had been built so far. */
  partial?: boolean;
  /** Only part of a screen changed: what was put in (spec paths, with everything inside). */
  section?: { paths: string[]; names: string[] };
  /** The screen had hand edits, and the change reshaped it, so it was rebuilt from its spec. */
  lostEdits?: boolean;
  /** Components Qalam AI made for these screens (placed with Custom; each can be added to the system). */
  newComponents?: ComponentDef[];
  /** Made components the designer added to a system, by name. */
  adopted?: Record<string, { systemId: string; systemName: string; forkedFrom?: string }>;
  /** No design system: the look the screens are drawn with; `made` when this turn picked it (else it kept an earlier one). */
  look?: { systemId: string; name: string; rationale: string; made: boolean };
}

export interface DetectiveOutcome {
  kind: "detective";
  extract: ExtractResult;
  rows: DetectiveRow[];
  /** The editable frame rebuilt from a screenshot. */
  rebuiltId?: string;
  /** Approved suggestions added to a design system. */
  added?: { systemId: string; systemName: string; paths: string[]; skipped: { name: string; reason: string }[] };
}

export interface AuditOutcome {
  kind: "audit";
  scope: string[];
  findings: Finding[];
  ai?: AuditResult;
  /** The explanation failed but the linter findings stand. */
  aiError?: string;
}

export interface CritiqueOutcome {
  kind: "critique";
  /** Matches the critique session this turn mirrors. */
  startedAt: number;
  status: "busy" | "asking" | "done" | "error" | "closed";
  questions: number;
  summary: string;
  verdict: GoalVerdict | null;
  issues: number;
  fix: "running" | "done" | "error" | "undone" | null;
  /** Issues fixed one at a time from their own Fix button. */
  fixedIssues?: number;
}

/** Discovery: Qalam AI drafted a board's tree or read a brain dump, or (in a Screens project) a solution arrived to design. */
export interface DiscoveryOutcome {
  kind: "discovery";
  action: "draft" | "handoff" | "dump";
  /** dump: the brain dump's source (how it's going lives there). */
  sourceId?: string;
  /** draft: Qalam AI's words back to the builder. */
  summary?: string;
  counts?: { opportunities: number; solutions: number; assumed: number };
  /** draft: the tree's outcome card on the board. */
  rootId?: string;
  /** draft: stopped mid-way, the cards written so far kept. */
  partial?: boolean;
  /** handoff: the solution and its lineage. */
  handoff?: DesignHandoff;
}

/** Add component: a screenshot of one component, read into a component of a design system. */
export interface ComponentOutcome {
  kind: "component";
  /** Reading the screenshot, checking the drawing against it, or finished. */
  phase: "reading" | "checking" | "done";
  /** Qalam AI's words for the designer: what it read, or (a follow-up) what it changed. */
  read?: string;
  /** What the check against the screenshot changed, in Qalam AI's words. */
  checkNote?: string;
  def?: ComponentDef;
  /** The width at 1x it's drawn and compared at. */
  width?: number;
  /** Where the drawing can't match the screenshot. */
  differences?: Difference[];
  /** The screenshot's colours, each with the system's closest colour role. */
  colours?: RoleMatch[];
  /** Copy the kept version's drawing cuts off, and parts that stick out of their container (measured by the studio). */
  cut?: string[];
  overflow?: { name: string; by: number }[];
  /** The automatic check: fidelity scores (lower is closer) and which version was kept. */
  check?: { before: number | null; after: number | null; kept: "first" | "revised"; error?: string };
  /** In a design system under this name (a revision replaced the earlier version). */
  added?: { systemId: string; systemName: string; name: string; forkedFrom?: string; replaced?: boolean };
  /** Taken out of the system again from this turn. */
  removed?: boolean;
  /** The image was a whole screen or several components: nothing was added. */
  screen?: boolean;
  /** The screenshot read (a follow-up uses the earlier turn's). */
  source?: string;
}

export type ChatOutcome = GenerateOutcome | DetectiveOutcome | AuditOutcome | CritiqueOutcome | DirectionOutcome | TuneOutcome | ExtractOutcome | DiscoveryOutcome | ComponentOutcome;

export interface ChatTurn {
  id: string;
  tool: ChatTool;
  at: number;
  request: ChatRequest;
  status: "running" | "done" | "error" | "stopped";
  /** When the current model call started, and tokens streamed so far. */
  started: number;
  tokens: number;
  error?: string;
  model?: string;
  sample?: boolean;
  outcome?: ChatOutcome;
  /** The research step's latest lookup, while it runs. */
  activity?: string;
  /** What the research step found. */
  research?: ResearchInfo;
  /** Generate with Plan first: the plan, the designer's answers and the library search. Kept when the turn runs again. */
  plan?: PlanState;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: ChatTurn[];
  /** The project it belongs to (none: saved before projects, so the first project's). */
  projectId?: string;
  /** Moved to the chat list's Archived section. */
  archived?: boolean;
  /** A request finished while another chat was open. */
  unread?: boolean;
}

export const TOOL_LABEL: Record<ChatTool, string> = {
  generate: "Generate",
  critique: "Critique",
  detective: "Detective",
  audit: "Audit",
  direction: "Direction",
  tune: "Tune system",
  extract: "Extract system",
  discovery: "Discovery",
  component: "Add component",
};
