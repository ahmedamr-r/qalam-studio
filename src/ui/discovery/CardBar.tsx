import clsx from "clsx";
import { ChevronDown, CornerDownRight, ListPlus, PanelTopClose, PanelTopOpen, Trash2 } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { isOstCard } from "@/doc/board";
import { worldBounds } from "@/doc/geometry";
import { runCommand } from "@/commands/registry";
import { setStage, setTargetIn } from "@/discovery/ops";
import { STAGES, stageLabel } from "@/discovery/kinds";
import { feedback } from "@/commands/feedback";
import { Button, IconBtn } from "../controls";
import { Menu, MenuItem } from "../menu";
import { r } from "../recipes";
import { toScreenBox } from "../ai/anchor";
import { QalamAIGlyph } from "../brand";
import { useDiscovery } from "./store";
import { addChildCard, addSiblingCard } from "./commands";
import { draftSolutionsFor, useDrafting } from "./solutions";
import { draftTestsFor, useTesting } from "./tests";

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const BAR_H = 36;

/**
 * A small bar over the selected card (FigJam's contextual toolbar): add a card under it or next
 * to it, its stage, fold its branch, Design this for a solution, delete. Keys show in the tooltips.
 */
export default function CardBar({ vp }: { vp: { w: number; h: number } }) {
  const sel = useStudio((s) => (s.selection.length === 1 ? s.selection[0] : null));
  const node = useStudio((s) => (sel ? s.doc.nodes[sel] : undefined));
  const cam = useStudio((s) => s.camera);
  const tool = useStudio((s) => s.tool);
  const editing = useDiscovery((s) => s.editing);
  const dragging = useDiscovery((s) => s.dragging);
  const designFor = useDiscovery((s) => s.designFor);
  const drafting = useDrafting((s) => s.card);
  const testing = useTesting((s) => s.card);
  if (!sel || !isOstCard(node) || editing || dragging || designFor || tool !== "select") return null;
  const card = node.meta.ost;
  const doc = studio().doc;
  const box = toScreenBox(worldBounds(doc, sel), cam);
  const hasKids = node.children.some((c) => isOstCard(doc.nodes[c]));
  const w = card.kind === "solution" ? 312 : card.kind === "opportunity" ? 340 : 216;
  const left = Math.max(8, Math.min(vp.w - w - 8, box.x + box.w / 2 - w / 2));
  const above = box.y - BAR_H - 10;
  const top = above >= 8 ? above : Math.min(vp.h - BAR_H - 8, box.y + box.h + 22);
  if (box.x + box.w < 0 || box.x > vp.w || box.y + box.h < 0 || box.y > vp.h) return null;

  return (
    <div
      role="toolbar"
      aria-label="Card"
      className="pointer-events-auto absolute flex items-center gap-[2px] rounded-lg bg-elevated p-[4px] shadow-popover q-fade"
      style={{ left, top, height: BAR_H, width: w }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {card.kind !== "test" && (
        <IconBtn label="Add a card under it" command="discovery.add-child" size="sm" onClick={() => addChildCard(sel)}>
          <CornerDownRight {...ICON} />
        </IconBtn>
      )}
      <IconBtn label="Add a card next to it" command="discovery.add-sibling" size="sm" onClick={() => addSiblingCard(sel)}>
        <ListPlus {...ICON} />
      </IconBtn>
      <span aria-hidden className="mx-[2px] h-[16px] w-px bg-line" />
      <Menu
        label="Stage"
        checks
        className="w-[180px]"
        trigger={
          <button type="button" className={clsx(r.inlineSelect, "h-[24px] min-w-0 aria-expanded:bg-active")}>
            <span className="truncate">{stageLabel(card.kind, card.stage)}</span>
            <ChevronDown size={12} absoluteStrokeWidth strokeWidth={1.25} className="q-chevron" />
          </button>
        }
      >
        {STAGES[card.kind].map((st) => (
          <MenuItem
            key={st.value}
            checked={card.stage === st.value}
            onSelect={() => {
              if (st.value !== "target") return setStage([sel], st.value);
              let was: string | null = null;
              studio().mutate((d) => void (was = setTargetIn(d, sel)));
              if (was) feedback(`Target moved from “${was}”`, { id: "discovery.target" });
            }}
          >
            {st.label}
          </MenuItem>
        ))}
      </Menu>
      <span className="flex-1" />
      {card.kind === "solution" && (
        <Button size="sm" variant="secondary" className="mr-[2px] whitespace-nowrap" disabled={!!testing} onClick={() => void draftTestsFor(sel)}>
          <QalamAIGlyph size={12} /> {testing === sel ? "Drafting…" : "Draft its tests"}
        </Button>
      )}
      {card.kind === "solution" && (
        <Button size="sm" variant="secondary" className="mr-[2px] whitespace-nowrap" onClick={() => runCommand("discovery.design-this", "toolbar")}>
          Design this
        </Button>
      )}
      {card.kind === "opportunity" && (
        <Button size="sm" variant="secondary" className="mr-[2px] whitespace-nowrap" disabled={!!drafting} onClick={() => void draftSolutionsFor(sel)}>
          <QalamAIGlyph size={12} /> {drafting === sel ? "Drafting…" : "Draft solutions"}
        </Button>
      )}
      {hasKids && (
        <IconBtn label={card.collapsed ? "Unfold the branch" : "Fold the branch"} command="discovery.collapse" size="sm" onClick={() => runCommand("discovery.collapse", "toolbar")}>
          {card.collapsed ? <PanelTopOpen {...ICON} /> : <PanelTopClose {...ICON} />}
        </IconBtn>
      )}
      <IconBtn label="Delete the card and its branch" command="discovery.delete" size="sm" onClick={() => runCommand("discovery.delete", "toolbar")}>
        <Trash2 {...ICON} />
      </IconBtn>
    </div>
  );
}

