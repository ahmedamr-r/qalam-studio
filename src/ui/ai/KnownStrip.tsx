import { History } from "lucide-react";
import { knownLine, type KnownAnswer } from "@/memory/known";
import { r } from "../recipes";

/*
 * What was said before to a question like this one (src/memory/known.ts), under the question: whose,
 * where and when, with Use it, so they answer with a press instead of from memory, or Still don't know.
 * Nothing goes in the answer until they press it. `use`: the press, where it can be this question's answer.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export function KnownStrip({ known, use, onDontKnow }: { known: KnownAnswer[]; use: (k: KnownAnswer) => (() => void) | null; onDontKnow?: () => void }) {
  return (
    <div className="flex flex-col gap-[6px] rounded-lg px-[10px] py-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <p className="flex items-center gap-[6px] text-micro font-medium text-fg-muted">
        <History size={12} {...ICON} /> Said before
      </p>
      {known.map((k) => {
        const l = knownLine(k);
        const press = k.how === "unknown" ? null : use(k);
        return (
          <div key={k.id} className="flex items-start gap-[8px]">
            <p className="min-w-0 flex-1 text-caption leading-[18px] text-fg" dir="auto">
              <span className="font-medium">{l.who}</span> {l.said}
              <span className="text-fg-subtle"> · {l.where}</span>
            </p>
            {k.how === "unknown" ? (
              onDontKnow && (
                <button type="button" className={r.replyChip} onClick={onDontKnow}>
                  Still don&apos;t know
                </button>
              )
            ) : (
              press && (
                <button type="button" className={r.replyChip} onClick={press}>
                  Use it
                </button>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
