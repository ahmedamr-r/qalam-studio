import { useMemo } from "react";
import clsx from "clsx";
import { useStudio } from "@/doc/store";
import type { KnowledgeGraph, KnowledgeNode } from "@/knowledge/types";
import { r } from "../recipes";
import { DECISION_ICON, IconChip } from "./icons";
import { DECISION_LABEL } from "./labels";

/**
 * The hub's left column in the Why view: what Qalam AI made, newest first. Each row is a design (or
 * a critique, a fix, a Tune) whose story opens on the right.
 */

/** Decisions worth a story, newest first. */
export function storyDecisions(graph: KnowledgeGraph): KnowledgeNode[] {
  return graph.nodes.filter((n) => n.kind === "decision" && n.decision).sort((a, b) => b.at - a.at);
}

const ago = (at: number) => {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export default function DesignsList({ graph, selected, onSelect }: { graph: KnowledgeGraph; selected: string | null; onSelect: (ref: string) => void }) {
  const nodes = useStudio((s) => s.doc.nodes);
  const list = useMemo(() => storyDecisions(graph), [graph]);
  return (
    <nav aria-label="Designs Qalam AI made" className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-r border-line-subtle bg-app pt-[4px] pb-[16px]">
      <div className="flex h-[36px] shrink-0 items-center pr-[8px] pl-[16px]">
        <span className="text-caption font-semibold text-fg">What Qalam AI made</span>
      </div>
      {list.length === 0 && <p className="px-[16px] py-[8px] text-caption text-fg-subtle">Generate or critique a screen. Each one shows here with the story of why it looks the way it does.</p>}
      {list.map((n) => {
        const d = n.decision!;
        const frame = [...d.frames, ...(d.about ?? [])].map((id) => nodes[id]).find(Boolean);
        const title = (d.kind === "generate" || d.kind === "section") && frame ? frame.name : n.label.replace(/^[^·]+· /, "");
        const again = n.label.startsWith("Generate again");
        const on = selected === n.ref;
        return (
          <button
            key={n.ref}
            type="button"
            onClick={() => onSelect(n.ref)}
            aria-current={on ? "true" : undefined}
            className={clsx("q-item mx-[8px] flex items-center gap-[10px] rounded-md px-[8px] py-[7px] text-left", on ? r.selectedRow : "text-fg-muted hover:bg-hover hover:text-fg")}
          >
            <IconChip group="decision" icon={DECISION_ICON[d.kind]} size={24} muted={d.legacy} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body text-fg" dir="auto">
                {title}
              </span>
              <span className="truncate text-micro text-fg-subtle tnum">
                {again ? "Generate again" : DECISION_LABEL[d.kind]} · {ago(n.at)}
                {!d.legacy && d.reliedOn.length ? ` · ${d.reliedOn.length} ${d.reliedOn.length === 1 ? "reason" : "reasons"}` : ""}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
