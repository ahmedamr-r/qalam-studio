import clsx from "clsx";
import { MousePointer2, PaintBucket, PenTool, Scissors, Spline, type LucideIcon } from "lucide-react";
import { exitEdit, setEditTool } from "@/engine/vector-edit";
import { useVectorEdit, type VectorSubTool } from "@/engine/vector-state";
import { kb, registerCommands, useCommand } from "@/commands/registry";
import { useStudio } from "@/doc/store";
import { vectorOf } from "@/doc/vector";
import { Tip } from "./controls";
import { r } from "./recipes";
import { useSlidingIndicator } from "./motion";

/*
 * Vector edit mode's sub-toolbar (Figma UI3): it takes the main tool bar's place while a vector
 * is being edited. Move, Pen, Bend, Paint bucket, Cut, then Done. Same shell, key and sliding
 * indicator as the main toolbar; keys come from the registry.
 */

// The edit-mode keys E1's capture handler consumes, registered for display (tooltips and the
// shortcuts panel). They never dispatch: the "vector-edit" context doesn't run from the canvas.
registerCommands([
  { id: "vector.cut", label: "Cut", category: "vector", keys: [kb("X")], context: "vector-edit", hidden: true, run: () => setEditTool("cut") },
  { id: "vector.exit-edit", label: "Done editing", category: "vector", keys: [kb("Esc"), kb("↵")], context: "vector-edit", hidden: true, run: () => exitEdit() },
]);

const TOOLS: { tool: VectorSubTool; icon: LucideIcon; command: string; label: string }[] = [
  { tool: "move", icon: MousePointer2, command: "tool.select", label: "Move" },
  { tool: "pen", icon: PenTool, command: "tool.pen", label: "Pen" },
  { tool: "bend", icon: Spline, command: "vector.bend", label: "Bend" },
  { tool: "paint", icon: PaintBucket, command: "vector.paint", label: "Paint bucket" },
  { tool: "cut", icon: Scissors, command: "vector.cut", label: "Cut" },
];

export default function VectorToolbar() {
  const nodeId = useVectorEdit((s) => s.nodeId);
  const tool = useVectorEdit((s) => s.tool);
  const selected = useVectorEdit((s) => s.points.length);
  const total = useStudio((s) => {
    const n = nodeId ? s.doc.nodes[nodeId] : undefined;
    return n?.type === "path" ? vectorOf(n).paths.reduce((sum, p) => sum + p.points.length, 0) : 0;
  });
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLElement, HTMLSpanElement>(tool);
  if (!nodeId) return null;
  return (
    <nav
      ref={containerRef}
      aria-label="Vector edit tools"
      data-region="toolbar"
      className={clsx(r.toolbar, "select-none transition-[opacity,translate] duration-fast ease-out-quint starting:translate-y-[6px] starting:opacity-0")}
    >
      <span ref={indicatorRef} aria-hidden className={clsx(r.toolIndicator, "data-[hidden]:opacity-0")} />
      {TOOLS.map((t) => (
        <ToolKey key={t.tool} {...t} active={tool === t.tool} />
      ))}
      <span aria-hidden className={r.toolSep} />
      {/* A status line, not a label: what the edit holds, then what is picked. */}
      <span className="min-w-[72px] px-[4px] text-center text-caption text-fg-subtle tnum" aria-live="polite">
        {selected ? `${selected} of ${total} selected` : `${total} ${total === 1 ? "point" : "points"}`}
      </span>
      <DoneButton />
    </nav>
  );
}

function ToolKey({ tool, icon: Icon, command, label, active }: { tool: VectorSubTool; icon: LucideIcon; command: string; label: string; active: boolean }) {
  // Keycaps from the registry; Bend is a held key ("Hold ⌘"), shown as its gesture caps.
  return (
    <Tip label={label} command={command} side="top">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        data-indicator-active={active || undefined}
        onClick={() => setEditTool(tool)}
        className={clsx(r.toolKey, "w-[36px]")}
      >
        <Icon size={16} absoluteStrokeWidth strokeWidth={1.25} />
      </button>
    </Tip>
  );
}

function DoneButton() {
  const keys = useCommand("vector.exit-edit")?.keys;
  return (
    <Tip label="Done" keys={keys?.[0]} side="top">
      <button type="button" onClick={() => exitEdit()} className={clsx(r.buttonBase, r.buttonPrimary, "mr-[2px] ml-[2px] h-[32px] gap-[6px] rounded-md px-[12px] text-body")}>
        Done
      </button>
    </Tip>
  );
}
