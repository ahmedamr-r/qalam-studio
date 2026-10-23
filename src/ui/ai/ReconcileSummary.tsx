import { useState, type ReactNode } from "react";
import { Check, ChevronRight, Minus, Plus } from "lucide-react";
import type { Tried } from "@/design-system/reconcile";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { r } from "../recipes";
import { ErrorNote } from "./common";
import { changeLabel, type ReconcileState } from "./reconcile";

/**
 * Under the fidelity check: what comparing the rebuild with the screenshot changed in the draft,
 * what it tried and didn't keep (the rebuild didn't get closer), and what it couldn't check, each
 * with its reason. Suggestions can be applied by hand.
 */

const icon = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export default function ReconcileSummary({ state, onApply }: { state: ReconcileState; onApply: (s: Tried) => string | null }) {
  const [error, setError] = useState<string | null>(null);
  if (state.status === "running")
    return (
      <p className="flex items-start gap-[8px] text-caption text-fg-muted" role="status">
        <QalamAIGlyph size={12} className="mt-[2px] shrink-0" />
        <span className="q-shimmer-text">Qalam AI is comparing the rebuild with the screenshot, then keeping only the changes that bring it closer…</span>
      </p>
    );
  if (state.status === "error") return <p className="text-caption text-fg-subtle">The comparison didn&apos;t finish ({state.error}). The draft stays as measured.</p>;
  const applied = state.applied ?? [];
  const rejected = state.rejected ?? [];
  const suggestions = state.suggestions ?? [];
  const closer = state.scoreBefore !== undefined && state.scoreAfter !== undefined && state.scoreBefore > 0 ? Math.round((1 - state.scoreAfter / state.scoreBefore) * 100) : null;
  return (
    <div className="flex flex-col gap-[10px] rounded-lg bg-raised p-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex items-baseline justify-between gap-[8px]">
        <span className="text-caption font-medium text-fg">Compared with the screenshot</span>
        {closer !== null && applied.length > 0 && <span className="text-micro text-success tnum">{closer}% closer on what the pixels show</span>}
      </div>
      {state.diagnosis && <p className="text-caption text-fg-muted">{state.diagnosis}</p>}
      {applied.length > 0 && (
        <Group title="Changed in the draft">
          {applied.map((a) => (
            <Row key={a.path} icon={<Check size={12} {...icon} className="text-success" />} change={a} />
          ))}
        </Group>
      )}
      {!applied.length && !suggestions.length && <p className="text-caption text-fg-muted">Nothing to change: the rebuild already matches what the pixels show.</p>}
      {suggestions.length > 0 && (
        <Group title="Couldn't check (nothing on screen shows it)">
          {suggestions.map((s) => (
            <Row
              key={s.path}
              icon={<Plus size={12} {...icon} className="text-fg-subtle" />}
              change={s}
              action={
                <button
                  type="button"
                  className="q-item q-press -my-[2px] inline-flex h-[24px] shrink-0 items-center rounded-md px-[8px] text-caption font-medium text-fg shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-hover"
                  onClick={() => setError(onApply(s))}
                >
                  Apply
                </button>
              }
            />
          ))}
        </Group>
      )}
      {rejected.length > 0 && (
        <details className="group/tried text-caption text-fg-muted">
          <summary className="flex h-[24px] cursor-pointer list-none items-center gap-[6px] font-medium hover:text-fg [&::-webkit-details-marker]:hidden">
            <ChevronRight size={12} {...icon} className="shrink-0 text-fg-subtle transition-transform duration-fast group-open/tried:rotate-90" />
            Tried and kept as is <span className="font-normal text-fg-subtle tnum">({rejected.length})</span>
          </summary>
          <div className="mt-[4px] flex flex-col gap-[6px]">
            {rejected.map((x) => (
              <Row key={x.path} icon={<Minus size={12} {...icon} className="text-fg-subtle" />} change={x} note={x.why} />
            ))}
          </div>
        </details>
      )}
      {!!state.rebuildIssues?.length && (
        <p className="text-caption text-fg-subtle">
          <span className="font-medium text-fg-muted">From the rebuild, not the system:</span> {state.rebuildIssues.map((i) => `${i.element} (${i.note})`).join("; ")}
        </p>
      )}
      {error && <ErrorNote message={error} />}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <span className={r.eyebrow}>{title}</span>
      {children}
    </div>
  );
}

function Row({ change, icon: mark, action, note }: { change: Tried; icon: ReactNode; action?: ReactNode; note?: string }) {
  return (
    <div className="flex items-start gap-[8px]">
      <span className="mt-[2px] shrink-0">{mark}</span>
      <div className="min-w-0 flex-1 text-caption">
        <span className="font-medium text-fg">{changeLabel(change.path)}</span>{" "}
        <span className="font-mono text-micro text-fg-subtle">
          {change.from || "—"} → <span className="text-fg">{change.to}</span>
        </span>
        {(note || change.reason) && <div className="text-fg-subtle">{note ?? change.reason}</div>}
      </div>
      {action}
    </div>
  );
}
