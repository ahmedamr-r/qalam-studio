import type { ComponentType, SVGProps } from "react";
import clsx from "clsx";
import {
  BookOpen,
  CircleCheck,
  CircleHelp,
  CircleX,
  ClipboardCheck,
  Compass,
  Component,
  FileText,
  Globe,
  Hexagon,
  Layers3,
  LayoutTemplate,
  Lightbulb,
  Link,
  ListTree,
  MessageCircle,
  MessageSquareText,
  Palette,
  Puzzle,
  RefreshCw,
  Ruler,
  Shapes,
  SlidersHorizontal,
  Smartphone,
  Tag,
  Target,
  Wand2,
  Waypoints,
} from "lucide-react";
import type { DecisionKind, Group, NodeKind } from "@/knowledge/types";
import { NUQTA_PATH, PENCIL_PATH } from "../brand/pencil";

/**
 * One icon per kind of knowledge (what it is), coloured by its group (where it came from). Used by
 * the map's nodes, the story, the lists and the key, so the same fact looks the same everywhere.
 */

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string; absoluteStrokeWidth?: boolean }>;

/** Qalam AI's pencil, for decisions (the studio's AI mark; never a sparkle). */
export const PencilIcon: Icon = ({ size = 24, strokeWidth: _s, absoluteStrokeWidth: _a, ...rest }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden {...rest}>
    <path d={PENCIL_PATH} />
    <path d={NUQTA_PATH} />
  </svg>
);

export const KIND_ICON: Record<NodeKind, Icon> = {
  summary: FileText,
  answer: MessageCircle,
  "screen-goal": Target,
  verdict: ClipboardCheck,
  language: Palette,
  principle: Compass,
  do: CircleCheck,
  dont: CircleX,
  layout: Ruler,
  template: LayoutTemplate,
  rule: Ruler,
  structure: Layers3,
  guide: Component,
  gap: Puzzle,
  pattern: Shapes,
  tokens: Hexagon,
  inferred: Palette,
  naming: Tag,
  research: Globe,
  source: Link,
  chat: MessageSquareText,
  decision: PencilIcon,
  token: Hexagon,
  component: Shapes,
  screen: Smartphone,
  system: BookOpen,
};

export const DECISION_ICON: Record<DecisionKind, Icon> = {
  generate: Wand2,
  section: Wand2,
  critique: ClipboardCheck,
  fix: RefreshCw,
  tune: SlidersHorizontal,
  extract: BookOpen,
  plan: Compass,
  detective: Tag,
  component: Component,
  audit: CircleHelp,
  direction: Waypoints,
  discovery: ListTree,
};

/** The icon that stands for a whole group (the key, the group list). */
export const GROUP_ICON: Record<Group, Icon> = {
  you: MessageCircle,
  system: Ruler,
  learned: Lightbulb,
  research: Globe,
  decision: PencilIcon,
  anchor: Smartphone,
};

export const GROUP_TINT: Record<Group, string> = {
  you: "var(--color-kh-you)",
  system: "var(--color-kh-system)",
  learned: "var(--color-kh-learned)",
  research: "var(--color-kh-research)",
  decision: "var(--color-ai)",
  anchor: "var(--color-fg-subtle)",
};

/** A rounded chip with the icon in its group's colour on a faint wash of it (lists, the story, the key). */
export function IconChip({ group, icon: I, size = 24, className, muted }: { group: Group; icon: Icon; size?: number; className?: string; muted?: boolean }) {
  const tint = GROUP_TINT[group];
  return (
    <span
      aria-hidden
      className={clsx("grid shrink-0 place-items-center rounded-md", muted && "opacity-60", className)}
      style={{ width: size, height: size, color: tint, background: `color-mix(in oklab, ${tint} 16%, transparent)` }}
    >
      <I size={Math.round(size * 0.58)} strokeWidth={1.5} absoluteStrokeWidth />
    </span>
  );
}
