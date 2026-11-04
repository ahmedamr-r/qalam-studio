import { CornerDownRight, ListPlus, Trash2 } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { isOstCard } from "@/doc/board";
import { worldBounds } from "@/doc/geometry";
import { runCommand } from "@/commands/registry";
import { Button, IconBtn } from "../controls";
import { toScreenBox } from "../ai/anchor";
import { useDiscovery } from "./store";
import { addChildCard, addSiblingCard } from "./commands";
import { useSpaceView } from "@/space/view";
import { workOnProblem } from "../space/SpacePanel";

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const BAR_H = 36;

/**
 * A small bar over the selected card (FigJam's contextual toolbar): add a card under it or next
 * to it, delete. Keys show in the tooltips. Its stage is in the card's panel and its fold toggle on
 * its edge, and what Qalam AI can do next with the card is beside it (./NextSteps.tsx).
 */
export default function CardBar({ vp }: { vp: { w: number; h: number } }) {
  const sel = useStudio((s) => (s.selection.length === 1 ? s.selection[0] : null));
  const node = useStudio((s) => (sel ? s.doc.nodes[sel] : undefined));
  const cam = useStudio((s) => s.camera);
  const tool = useStudio((s) => s.tool);
  const editing = useDiscovery((s) => s.editing);
  const dragging = useDiscovery((s) => s.dragging);
  const designFor = useDiscovery((s) => s.designFor);
  const faint = useSpaceView((s) => {
    const t = sel && s.faint.has(sel) ? s.things.get(sel) : undefined;
    return t?.type === "problem" ? t : null;
  });
  if (!sel || !isOstCard(node) || editing || dragging || designFor || tool !== "select") return null;
  const card = node.meta.ost;
  const doc = studio().doc;
  const box = toScreenBox(worldBounds(doc, sel), cam);
  const w = card.kind === "test" ? 66 : 92;
  const left = Math.max(8, Math.min(vp.w - w - 8, box.x + box.w / 2 - w / 2));
  const above = box.y - BAR_H - 10;
  const top = above >= 8 ? above : Math.min(vp.h - BAR_H - 8, box.y + box.h + 22);
  if (box.x + box.w < 0 || box.x > vp.w || box.y + box.h < 0 || box.y > vp.h) return null;
  // A problem's page on a space's canvas: not a card yet, so the one thing to do is put it on the board.
  if (faint)
    return (
      <div role="toolbar" aria-label="Problem" className="pointer-events-auto absolute flex items-center gap-[2px] rounded-lg bg-elevated p-[4px] shadow-popover q-fade" style={{ left: Math.max(8, box.x + box.w / 2 - 60), top, height: BAR_H }} onPointerDown={(e) => e.stopPropagation()}>
        <Button size="sm" onClick={() => void workOnProblem(faint.topic, sel)}>
          Work on it
        </Button>
      </div>
    );

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
      <IconBtn label="Delete the card and its branch" command="discovery.delete" size="sm" onClick={() => runCommand("discovery.delete", "toolbar")}>
        <Trash2 {...ICON} />
      </IconBtn>
    </div>
  );
}

