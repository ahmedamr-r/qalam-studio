import clsx from "clsx";
import type { EvidenceSummary } from "@/discovery/evidence";
import { strengthFill, strengthOf, type Strength } from "@/hub/needs";
import { Tip } from "../controls";
import { r } from "../recipes";
import { Meter } from "../viz";

/*
 * What backs a card, in a strip: how strong that is (as a need page's strip counts it), its quotes
 * and sources, what's against it and who said it. The card panel's, and the space map's.
 */

const STRENGTH: Record<Strength, string> = { strong: "Strong", growing: "Growing", thin: "Thin", assumed: "Assumed" };
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function EvidenceStrip({ s }: { s: EvidenceSummary }) {
  const word = s.quotes ? STRENGTH[strengthOf(s)] : s.ours ? "Your words only" : "Nothing backs it";
  return (
    <div role="group" aria-label="What backs this card" className="flex flex-col gap-[8px] rounded-lg bg-muted px-[10px] py-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex items-center gap-[12px]">
        <span className="flex w-[104px] shrink-0 flex-col gap-[6px]">
          <span className="text-caption font-medium text-fg">{word}</span>
          <Meter value={strengthFill(s)} label={s.quotes ? `${word}, from ${plural(s.sources, "source")}` : word} />
        </span>
        <span className="flex min-w-0 flex-col gap-[2px] text-caption tnum">
          {s.quotes ? (
            <Tip label={s.from.length ? s.from.join(" · ") : plural(s.sources, "source")}>
              <span tabIndex={0} className="truncate text-fg">
                {plural(s.quotes, "quote")} · {plural(s.sources, "source")}
              </span>
            </Tip>
          ) : (
            <span className="text-fg-muted">No customer words yet</span>
          )}
          <span className={s.against ? "text-warning" : "text-fg-subtle"}>{s.against ? `${s.against} against` : "Nothing against"}</span>
        </span>
      </div>
      {s.who.length > 0 && (
        <div className="flex flex-wrap items-center gap-[4px]">
          <span className="mr-[2px] text-micro text-fg-subtle">Who</span>
          {s.who.slice(0, 4).map((w) => (
            <span key={w} className={clsx(r.chip, "max-w-[120px]")}>
              <span className="truncate">{w}</span>
            </span>
          ))}
          {s.who.length > 4 && (
            <Tip label={s.who.slice(4).join(", ")}>
              <span tabIndex={0} className="text-micro text-fg-subtle tnum">
                +{s.who.length - 4}
              </span>
            </Tip>
          )}
        </div>
      )}
    </div>
  );
}
