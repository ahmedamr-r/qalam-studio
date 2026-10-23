import type { DecisionKind, Group, NodeKind, Origin } from "@/knowledge/types";

/** Words for the hub's groups, kinds and origins (the designer's words, not the code's). */

export const GROUP_LABEL: Record<Group, string> = {
  you: "You told it",
  system: "Design system",
  learned: "Learned",
  research: "Research",
  decision: "Decisions",
  anchor: "Screens, tokens & components",
};

export const GROUP_HINT: Record<Group, string> = {
  you: "Your answers, screen goals and interview",
  system: "The system's written rules and guides",
  learned: "What Qalam AI concluded or was taught",
  research: "What it looked up, and the sources",
  decision: "Screens it made, verdicts, changes",
  anchor: "What the knowledge is about",
};

export const KIND_LABEL: Record<NodeKind, string> = {
  summary: "Project summary",
  answer: "Your answer",
  "screen-goal": "Screen goal",
  verdict: "Critique verdict",
  language: "Design language",
  principle: "Principle",
  do: "Do",
  dont: "Don't",
  layout: "Layout",
  template: "Screen template",
  rule: "Layout rule",
  structure: "Component structure",
  guide: "Component guide",
  gap: "Catalog gap",
  pattern: "System component",
  tokens: "Token values",
  inferred: "Inferred colours",
  naming: "Naming choice",
  research: "Research notes",
  source: "Source",
  chat: "Chat turn",
  decision: "Decision",
  token: "Token",
  component: "Component",
  screen: "Screen",
  system: "Design system",
};

export const ORIGIN_LABEL: Record<Origin, string> = {
  you: "You",
  interview: "Your interview",
  discovery: "A Discovery board",
  extraction: "Extracted from screenshots",
  "built-in": "Built into Qalam",
  imported: "Imported",
  tune: "Tune system",
  critique: "Qalam AI's critique",
  detective: "Token Detective",
  ai: "Qalam AI",
  web: "Web research",
};

export const DECISION_LABEL: Record<DecisionKind, string> = {
  generate: "Generate",
  section: "Section edit",
  critique: "Critique",
  fix: "Fix",
  tune: "Tune system",
  extract: "Extract system",
  plan: "Plan",
  detective: "Token Detective",
  component: "Add component",
  audit: "Audit",
  direction: "Direction",
  discovery: "Discovery",
};

export const when = (at: number) => (at ? new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(at).getFullYear() === new Date().getFullYear() ? undefined : "numeric" }) : "Built in");
