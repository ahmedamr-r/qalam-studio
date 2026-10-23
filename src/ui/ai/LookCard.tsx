import { Palette } from "lucide-react";
import { tokenSetFor, useSystems } from "@/design-system/registry";
import { lookSentence } from "@/design-system/freeform";
import { Button, Swatch, Tag } from "../controls";
import { openWorkspace } from "../workspace/store";
import type { GenerateOutcome } from "./chatTypes";

/** The colours that say most about a look, in order. */
const SWATCHES = ["bg.brand-strong", "bg.brand-subtle", "bg.canvas", "bg.surface", "text.primary"];

/**
 * Screens made without a design system: the look Qalam AI picked for them (or kept from earlier
 * screens), why, and how to keep it: edit its tokens, or save it as a design system other screens
 * and projects can use.
 */
export function LookCard({ look }: { look: NonNullable<GenerateOutcome["look"]> }) {
  const systems = useSystems((s) => s.systems);
  const freeform = useSystems((s) => s.freeform);
  const activeId = useSystems((s) => s.activeId);
  // A look that's gone (its screens deleted and the project reopened) has nothing left to act on.
  const ds = systems.find((s) => s.id === look.systemId);
  if (!ds) return null;
  const ts = tokenSetFor(ds.id);
  const colours = SWATCHES.map((p) => ts.color(p)).filter((c): c is string => !!c);
  const used = !freeform && activeId === ds.id;
  return (
    <div className="flex flex-col gap-[6px] rounded-lg bg-field px-[10px] py-[8px]">
      <div className="flex items-center gap-[6px] text-micro font-medium text-fg-subtle">
        <Palette size={12} absoluteStrokeWidth strokeWidth={1.25} />
        {look.made ? "Look Qalam AI picked" : "Kept the look of the earlier screens"}
        {ds.kept && <Tag tone="neutral">Saved as a design system</Tag>}
      </div>
      <div className="flex items-center gap-[8px]">
        <span className="flex shrink-0 -space-x-[3px]">
          {colours.map((c, i) => (
            <Swatch key={i} color={c} size={14} className="rounded-full" />
          ))}
        </span>
        <span className="min-w-0 truncate text-body font-medium text-fg">{ds.name}</span>
      </div>
      {look.made && look.rationale && <p className="text-caption text-fg-muted">{look.rationale}</p>}
      {ds.look && <p className="text-caption text-fg-subtle">{lookSentence(ds.look.knobs)}</p>}
      <div className="flex flex-wrap items-center gap-[6px] pt-[2px]">
        <Button size="sm" variant="ghost" onClick={() => openWorkspace("tokens", { systemId: ds.id })}>
          Edit tokens
        </Button>
        {!ds.kept ? (
          <Button size="sm" variant="secondary" title="List it with your design systems, so other screens and projects can use it" onClick={() => useSystems.getState().update(ds.id, { kept: true })}>
            Save as design system
          </Button>
        ) : (
          !used && (
            <Button
              size="sm"
              variant="secondary"
              title="New screens use this system instead of a look picked per brief"
              onClick={() => {
                useSystems.getState().setActive(ds.id);
                useSystems.getState().setFreeform(false);
              }}
            >
              Use for new screens
            </Button>
          )
        )}
      </div>
    </div>
  );
}
