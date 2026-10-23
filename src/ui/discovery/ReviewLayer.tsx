import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { Check, ChevronDown, Quote, X } from "lucide-react";
import { useStudio } from "@/doc/store";
import { useGhosts } from "@/doc/ghosts";
import { worldBounds } from "@/doc/geometry";
import type { Proposal, QuoteRef } from "@/discovery/synthesis";
import { Button, IconBtn, Spinner } from "../controls";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { toScreenBox } from "../ai/anchor";
import { REVIEW_TURN, acceptAll, acceptProposals, discardAll, discardProposals, evidenceOf } from "./review";
import { stopSources } from "./import";
import { useSources } from "./sources";

const SMALL = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;
/** A card narrower than this on screen gets no bar of its own (the pill covers it until you zoom in). */
const MIN_CARD_W = 150;
/** Never wider than its card (siblings sit close), and no wider than this. */
const MAX_BAR_W = 280;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Qalam AI's proposals on the canvas: under each card a proposal adds or changes (drawn faded, over
 * the real tree), a small bar to accept or discard it; at the top, a pill for all of them. While
 * Qalam AI reads sources or maps their quotes, the pill says so, with Stop.
 */
export default function ReviewLayer({ vp }: { vp: { w: number; h: number } }) {
  const proposals = useSources((s) => s.proposals);
  const mapping = useSources((s) => !!s.mapping);
  const quoting = useSources((s) => Object.values(s.jobs).some((j) => j.phase === "quoting"));
  const ghosts = useGhosts((s) => s.list);
  const cam = useStudio((s) => s.camera);
  if (!proposals.length)
    return mapping || quoting ? (
      <Pill>
        <QalamAIGlyph size={14} />
        <span className="q-shimmer-text">{mapping ? "Qalam AI is mapping quotes to your tree" : "Qalam AI is picking out what customers said"}</span>
        <Spinner size={12} />
        <Button size="sm" variant="secondary" onClick={stopSources}>
          Stop
        </Button>
      </Pill>
    ) : null;

  // One bar per card a proposal adds or changes, on the ghost where it's drawn.
  const bars: { id: string; box: { x: number; y: number; w: number; h: number }; list: Proposal[] }[] = [];
  for (const g of ghosts) {
    if (g.turnId !== REVIEW_TURN) continue;
    for (const id of new Set(proposals.map((p) => p.cardId))) {
      if (!g.doc.nodes[id]) continue;
      const box = toScreenBox(worldBounds(g.doc, id), cam);
      // Zoomed far out the cards are specks: the pill speaks for them until you zoom in.
      if (box.w < MIN_CARD_W || box.x + box.w < 0 || box.x > vp.w || box.y + box.h < 0 || box.y > vp.h) continue;
      bars.push({ id, box, list: proposals.filter((p) => p.cardId === id) });
    }
  }
  return (
    <>
      <Pill>
        <QalamAIGlyph size={14} />
        <span className="min-w-0 truncate" title={`Qalam AI proposes ${plural(proposals.length, "change")} from your sources`}>
          {plural(proposals.length, "change")} from your sources
        </span>
        <Button size="sm" onClick={acceptAll}>
          Accept all
        </Button>
        <Button size="sm" variant="secondary" onClick={discardAll}>
          Discard all
        </Button>
      </Pill>
      {bars.map((b) => (
        <ProposalBar key={b.id} box={b.box} list={b.list} />
      ))}
    </>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-auto absolute top-[12px] left-1/2 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-[10px] rounded-lg bg-elevated py-[6px] pr-[6px] pl-[10px] text-caption font-medium whitespace-nowrap text-fg shadow-popover q-fade [&>button]:shrink-0" role="status">
      {children}
    </div>
  );
}

/** One quote in a card's proposals. */
type Row = { key: string; p: Proposal; q: QuoteRef; against: boolean };

/** What a card's proposals amount to: "New opportunity · 2 quotes", "+2 quotes · 1 against". */
function summary(list: Proposal[]): string {
  const added = list.find((p) => p.kind === "opportunity");
  if (added && added.kind === "opportunity") return "New opportunity";
  const backs = list.filter((p) => p.kind === "attach").length;
  const against = list.filter((p) => p.kind === "against").length;
  return [backs && `+${plural(backs, "quote")}`, against && `${against} against`].filter(Boolean).join(" · ");
}

/** Under a card a proposal adds or changes, in the gap above its children: what it is, accept, discard. */
function ProposalBar({ box, list }: { box: { x: number; y: number; w: number; h: number }; list: Proposal[] }) {
  const [open, setOpen] = useState(false);
  const w = Math.min(MAX_BAR_W, box.w);
  const roomy = w >= 200;
  const ids = list.map((p) => p.id);
  const label = summary(list);
  return (
    <div className={clsx("pointer-events-auto absolute flex flex-col gap-[4px] q-fade", open && "z-10")} style={{ left: box.x + box.w / 2 - w / 2, top: box.y + box.h + 4, width: w, minWidth: open ? 240 : undefined }} onPointerDown={(e) => e.stopPropagation()}>
      <div role="group" aria-label="Qalam AI's proposal" className="flex h-[26px] items-center rounded-lg bg-elevated p-[1px] pl-[8px] shadow-popover">
        <button type="button" aria-expanded={open} title={open ? "Hide the quotes" : `${label}: show the quotes`} className="q-item flex h-[24px] min-w-0 flex-1 items-center gap-[6px] rounded-md pr-[4px] text-left text-caption font-medium text-fg" onClick={() => setOpen(!open)}>
          <QalamAIGlyph size={12} />
          <span className="min-w-0 truncate">{label}</span>
          {roomy && <ChevronDown size={12} absoluteStrokeWidth strokeWidth={1.25} className={clsx("q-chevron shrink-0 text-fg-subtle", open && "rotate-180")} />}
        </button>
        <IconBtn size="sm" label={list.length > 1 ? "Accept these" : "Accept"} onClick={() => acceptProposals(ids)}>
          <Check {...SMALL} />
        </IconBtn>
        <IconBtn size="sm" label={list.length > 1 ? "Discard these" : "Discard"} onClick={() => discardProposals(ids)}>
          <X {...SMALL} />
        </IconBtn>
      </div>
      {open && (
        <div className="flex max-h-[280px] flex-col gap-[6px] overflow-y-auto rounded-lg bg-elevated p-[8px] shadow-popover">
          {list.flatMap((p): Row[] => (p.kind === "opportunity" ? p.quotes.map((q, i) => ({ key: `${p.id}:${i}`, p, q, against: false })) : [{ key: p.id, p, q: p.quote, against: p.kind === "against" }])).map(({ key, p, q, against }) => {
            const ev = evidenceOf(q, against);
            if (!ev) return null;
            return (
              <figure key={key} className="flex flex-col gap-[4px]">
                <blockquote className="flex gap-[6px] text-caption leading-[18px] text-fg" dir="auto">
                  <Quote size={12} className="mt-[3px] shrink-0 text-fg-subtle" />
                  <span className="line-clamp-4">{ev.text}</span>
                </blockquote>
                <figcaption className="flex items-center gap-[6px] pl-[18px] text-micro text-fg-subtle">
                  <span className="min-w-0 flex-1 truncate">
                    {against ? "Against · " : ""}
                    {p.why || ev.sourceTitle}
                  </span>
                  {p.kind !== "opportunity" && (
                    <>
                      <IconBtn size="sm" label="Accept this one" onClick={() => acceptProposals([p.id])}>
                        <Check {...SMALL} />
                      </IconBtn>
                      <IconBtn size="sm" label="Discard this one" onClick={() => discardProposals([p.id])}>
                        <X {...SMALL} />
                      </IconBtn>
                    </>
                  )}
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </div>
  );
}
