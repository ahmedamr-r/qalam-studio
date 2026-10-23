import clsx from "clsx";
import { ChevronRight, FileText, StickyNote, Type, Image as ImageIcon, Shapes } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import type { Doc } from "@/doc/schema";
import { isNote, isOstCard } from "@/doc/board";
import { stageLabel } from "@/discovery/kinds";
import { isAssumed } from "@/discovery/evidence";
import { placeholderTitle } from "@/discovery/metrics";
import { revealCard, toggleCollapsed } from "@/discovery/ops";
import { r } from "../recipes";
import { getController } from "../CanvasView";
import KindMark from "./KindMark";

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/**
 * The Layers panel on a Discovery board: each tree as an outline (a card's children indented
 * under it, folded branches folded here too), then the free notes. Click selects; double-click
 * brings it into view. Rows carry `data-layer-id`, so the canvas's context menu works on them.
 */
export default function OutlinePanel() {
  const doc = useStudio((s) => s.doc);
  const trees = doc.roots.filter((id) => isOstCard(doc.nodes[id]));
  const notes = doc.roots.filter((id) => !isOstCard(doc.nodes[id]) && doc.nodes[id]);
  return (
    <div role="tree" aria-label="Outline" className="flex flex-col gap-[2px] px-[8px] pt-[4px] pb-[16px]">
      {!trees.length && <p className="px-[8px] py-[8px] text-caption text-fg-muted">No tree yet. Start from the interview, or pick the Card tool and click the board.</p>}
      {trees.map((id) => (
        <CardRow key={id} doc={doc} id={id} depth={0} />
      ))}
      {notes.length > 0 && (
        <>
          <div className="mt-[12px] px-[8px] pb-[4px] text-micro font-medium text-fg-subtle">On the board</div>
          {notes.map((id) => (
            <NoteRow key={id} doc={doc} id={id} />
          ))}
        </>
      )}
    </div>
  );
}

function select(id: string, additive: boolean) {
  const s = studio();
  revealCard(id);
  s.select(additive ? (s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id]) : [id]);
}

function CardRow({ doc, id, depth }: { doc: Doc; id: string; depth: number }) {
  const n = doc.nodes[id];
  const selected = useStudio((s) => s.selection.includes(id));
  if (!isOstCard(n)) return null;
  const card = n.meta.ost;
  const kids = n.children.filter((c) => isOstCard(doc.nodes[c]));
  const folded = !!card.collapsed;
  return (
    <>
      <div
        role="treeitem"
        aria-selected={selected}
        aria-expanded={kids.length ? !folded : undefined}
        data-layer-id={id}
        tabIndex={-1}
        onClick={(e) => select(id, e.shiftKey || e.metaKey)}
        onDoubleClick={() => getController()?.glideToFit([id])}
        className={clsx(r.layerRow, "min-h-[28px] cursor-default", selected && r.layerRowSelected)}
        style={r.indent(depth)}
      >
        <button
          type="button"
          aria-label={folded ? "Unfold" : "Fold"}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            toggleCollapsed([id]);
          }}
          className={clsx(r.layerTwisty, !kids.length && "invisible")}
          data-open={!folded || undefined}
        >
          <ChevronRight size={12} absoluteStrokeWidth strokeWidth={1.25} className={clsx("transition-transform duration-fast", !folded && "rotate-90")} />
        </button>
        <KindMark kind={card.kind} className={clsx("shrink-0", card.kind === "outcome" ? "text-fg" : "text-fg-subtle")} />
        <span className={clsx("min-w-0 flex-1 truncate", !card.title.trim() && "text-fg-subtle", card.kind === "outcome" && "font-medium text-fg")} dir="auto">
          {card.title.trim() || placeholderTitle(card.kind)}
        </span>
        {isAssumed(card) && <span title="Assumed: needs evidence" className="size-[8px] shrink-0 rounded-full shadow-[inset_0_0_0_1px_var(--color-warning)] [border:1px_dashed_var(--color-warning)]" />}
        <span className="shrink-0 pr-[4px] text-micro text-fg-subtle">{stageLabel(card.kind, card.stage)}</span>
      </div>
      {!folded && kids.map((c) => <CardRow key={c} doc={doc} id={c} depth={depth + 1} />)}
    </>
  );
}

function NoteRow({ doc, id }: { doc: Doc; id: string }) {
  const n = doc.nodes[id];
  const selected = useStudio((s) => s.selection.includes(id));
  if (!n) return null;
  const sticky = isNote(n) && n.meta.note.kind === "sticky";
  const source = isNote(n) && n.meta.note.kind === "source";
  const text = sticky ? (doc.nodes[n.children[0]] as { text?: { content: string } } | undefined)?.text?.content : undefined;
  const Icon = sticky ? StickyNote : source ? FileText : n.type === "text" ? Type : n.type === "image" ? ImageIcon : Shapes;
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      data-layer-id={id}
      tabIndex={-1}
      onClick={(e) => select(id, e.shiftKey || e.metaKey)}
      onDoubleClick={() => getController()?.glideToFit([id])}
      className={clsx(r.layerRow, "cursor-default pl-[22px]", selected && r.layerRowSelected)}
    >
      <Icon {...ICON} className={r.layerIcon} />
      <span className="min-w-0 flex-1 truncate" dir="auto">
        {(text?.trim() || n.name).slice(0, 80)}
      </span>
    </div>
  );
}
