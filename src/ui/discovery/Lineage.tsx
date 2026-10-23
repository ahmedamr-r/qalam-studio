import type { ReactNode } from "react";
import clsx from "clsx";
import { Quote } from "lucide-react";
import { ASSUMPTION_LABEL } from "@/discovery/kinds";
import type { DesignHandoff, OstKind } from "@/discovery/types";
import KindMark from "./KindMark";

/*
 * A solution sent to design, as Design this and the Screens project's chat show it: where it sits
 * in the tree, what it rests on, and what has to be true for it to work.
 */

function Line({ kind, strong, children }: { kind: OstKind; strong?: boolean; children: ReactNode }) {
  return (
    <span className={clsx("flex items-start gap-[6px]", strong ? "font-medium text-fg" : "text-fg-muted")}>
      <KindMark kind={kind} className={clsx("mt-[2px] shrink-0", strong ? "text-fg-muted" : "text-fg-subtle")} />
      <span className="min-w-0" dir="auto">
        {children}
      </span>
    </span>
  );
}

/** ▸ the solution, ○ for the need it addresses, ◉ to move the outcome (and its metric). */
export function Lineage({ h, lead }: { h: Pick<DesignHandoff, "solution" | "path" | "outcome">; lead?: string }) {
  const need = h.path[h.path.length - 1];
  return (
    <div className="flex flex-col gap-[4px] text-caption">
      <Line kind="solution" strong>
        {lead && <span className="font-normal text-fg-muted">{lead} </span>}
        {h.solution.title}
      </Line>
      {need && <Line kind="opportunity">for {need}</Line>}
      {h.outcome.title && (
        <Line kind="outcome">
          to move {h.outcome.title}
          {h.outcome.metric && <span className="text-fg-subtle tnum"> · {h.outcome.metric}</span>}
        </Line>
      )}
    </div>
  );
}

const Caption = ({ children }: { children: ReactNode }) => <span className="text-micro text-fg-subtle">{children}</span>;

/** What the solution rests on, word for word (the first few). */
export function EvidenceList({ evidence, max = 3 }: { evidence: DesignHandoff["evidence"]; max?: number }) {
  if (!evidence.length) return null;
  return (
    <div className="flex flex-col gap-[6px]">
      <Caption>Evidence</Caption>
      <ul className="flex flex-col gap-[4px]">
        {evidence.slice(0, max).map((e) => (
          <li key={e.text} className="flex gap-[6px] text-caption text-fg-muted" dir="auto">
            <Quote size={12} absoluteStrokeWidth strokeWidth={1.25} className="mt-[2px] shrink-0 text-fg-subtle" />
            {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What has to be true for it to work, riskiest first. */
export function RiskiestAssumptions({ assumptions, max = 3 }: { assumptions: DesignHandoff["assumptions"]; max?: number }) {
  if (!assumptions.length) return null;
  return (
    <div className="flex flex-col gap-[6px]">
      <Caption>Riskiest assumptions</Caption>
      <ul className="flex flex-col gap-[4px]">
        {assumptions.slice(0, max).map((a) => (
          <li key={a.text} className="text-caption text-fg-muted" dir="auto">
            <span className="font-medium text-fg">{ASSUMPTION_LABEL[a.category]}</span> · {a.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
