import { useEffect, useState } from "react";
import { errorFix } from "../errors";
import { CircleAlert } from "lucide-react";
import { aiStatus, type AIStatus } from "@/ai/client";
import { QalamAIGlyph } from "../brand/ai-glyph";

export function useAIStatus() {
  const [s, setS] = useState<AIStatus | null>(null);
  useEffect(() => {
    aiStatus().then(setS);
  }, []);
  return s;
}

/** "0:07", "1:12": elapsed time for AI runs (tabular digits). */
export const elapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** A Qalam AI run in progress: glyph, shimmering status, elapsed timer and an indeterminate bar. */
export function Progress({ tokens, started, label }: { tokens: number; started: number; label: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col gap-[8px] rounded-lg bg-muted px-[12px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]" role="status">
      <div className="flex items-center gap-[10px] text-caption font-medium">
        <QalamAIGlyph size={14} />
        <span className="q-shimmer-text min-w-0 truncate">{label}</span>
        <span className="ml-auto font-normal text-fg-subtle tnum">{elapsed(now - started)}</span>
      </div>
      <div className="ds-shimmer h-[3px] rounded-full" />
      <div className="text-micro text-fg-subtle tnum">{tokens ? `~${tokens.toLocaleString()} tokens streamed` : "Waiting for the model…"}</div>
    </div>
  );
}

export function ErrorNote({ message, onSample }: { message: string; onSample?: () => void }) {
  // Engine problems are fixed in Connections: a few words and a link instead of the whole message.
  const fix = errorFix(message);
  return (
    <div className="q-fade flex items-start gap-[8px] rounded-lg bg-danger-subtle px-[12px] py-[8px] text-caption text-danger" role="alert">
      <CircleAlert size={14} className="mt-[1px] shrink-0" />
      <div className="min-w-0">
        {fix ? (
          <>
            {fix.word}.{" "}
            <a href={fix.href} className="font-medium underline decoration-current/40 underline-offset-2 hover:decoration-current">
              Fix in Connections
            </a>
          </>
        ) : (
          message
        )}
        {onSample && (
          <button type="button" className="ml-[4px] font-medium underline decoration-current/40 underline-offset-2 hover:decoration-current" onClick={onSample}>
            Use sample output
          </button>
        )}
      </div>
    </div>
  );
}
