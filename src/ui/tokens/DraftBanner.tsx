import { MessageSquare, X } from "lucide-react";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { Button, IconBtn } from "../controls";
import { openExtractTurn, usePreviewedDraft } from "../ai/extractChat";
import { unpinPreview } from "../ai/extractPreview";

const icon = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/** The Tokens panel is showing an extraction's draft: it's reviewed and saved in the AI chat. */
export function DraftBanner() {
  const p = usePreviewedDraft();
  if (!p) return null;
  return (
    <div className="q-rise mx-[12px] mt-[4px] mb-[12px] flex flex-col gap-[10px] rounded-lg bg-ai-subtle py-[10px] pr-[6px] pl-[12px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ai)_18%,transparent)]">
      <div className="flex items-start gap-[8px]">
        <QalamAIGlyph size={14} done={p.phase !== "running"} className="mt-[3px] shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-fg">Draft from extraction: “{p.draft.name}”</div>
          <p className="mt-[2px] text-caption text-fg-muted">
            {p.phase === "running" && <span className="q-shimmer-text">Qalam AI is still writing its docs. </span>}
            Previewed below; review and save it in the AI chat.
          </p>
        </div>
        <IconBtn size="sm" label="Stop previewing the draft" className="-mt-[2px]" onClick={() => unpinPreview()}>
          <X size={14} {...icon} />
        </IconBtn>
      </div>
      <Button size="sm" variant="secondary" className="ml-[22px] self-start" onClick={() => openExtractTurn(p.chatId, p.turnId)}>
        <MessageSquare size={14} {...icon} /> Open in AI chat
      </Button>
    </div>
  );
}
