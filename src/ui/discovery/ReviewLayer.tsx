import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { ArrowRight, Check, ChevronDown, Quote, X } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { useGhosts } from "@/doc/ghosts";
import { worldBounds } from "@/doc/geometry";
import { cardOf } from "@/discovery/ops";
import { metricText } from "@/discovery/dump";
import { ASSUMPTION_LABEL } from "@/discovery/kinds";
import type { Proposal } from "@/discovery/proposals";
import { Button, IconBtn, Spinner } from "../controls";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { toScreenBox } from "../ai/anchor";
import { REVIEW_TURN, acceptAll, acceptProposals, discardAll, discardProposals, evidenceOf, useReview } from "./review";
import { stopSources } from "./import";
import { sourceOf, useSources } from "./sources";
import { stopDump, useDump } from "./dump";
import { reviewPlacements, usePlacements } from "./placements";

const SMALL = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;
/** A card narrower than this on screen gets no bar of its own (the pill covers it until you zoom in). */
const MIN_CARD_W = 150;
/** Never wider than its card (siblings sit close), and no wider than this. */
const MAX_BAR_W = 280;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Qalam AI's proposals on the canvas: under each card a proposal adds or changes (drawn faded, over
 * the real tree), a small bar to accept or discard it; at the top, a pill for all of them. While
 * Qalam AI reads sources, maps their quotes or places a brain dump, the pill says so, with Stop.
 */
export default function ReviewLayer({ vp }: { vp: { w: number; h: number } }) {
  const proposals = useReview((s) => s.proposals);
  const origin = useReview((s) => s.origin);
  const mapping = useSources((s) => !!s.mapping);
  const quoting = useSources((s) => Object.values(s.jobs).some((j) => j.phase === "quoting"));
  const placing = useDump((s) => (s.busy && sourceOf(s.busy.sourceId)?.dump?.phase === "placing" ? s.busy.sourceId : null));
  const ghosts = useGhosts((s) => s.list);
  const cam = useStudio((s) => s.camera);
  const waiting = usePlacements((s) => s.list);
  if (!proposals.length && !(mapping || quoting || placing) && waiting.length)
    // What Qalam AI found for this board in material added to the organization, waiting.
    return (
      <Pill>
        <QalamAIGlyph size={14} />
        <span className="min-w-0 truncate" title={waiting.map((w) => w.title).join(", ")}>
          {plural(waiting.reduce((n, w) => n + w.proposals.length, 0), "change")} for this board from {waiting.length === 1 ? `“${waiting[0].title}”` : `${waiting.length} new sources`}
        </span>
        <Button size="sm" onClick={() => void reviewPlacements()}>
          Review
        </Button>
      </Pill>
    );
  if (!proposals.length)
    return mapping || quoting || placing ? (
      <Pill>
        <QalamAIGlyph size={14} />
        <span className="q-shimmer-text">{placing ? "Qalam AI is placing your brain dump" : mapping ? "Qalam AI is mapping quotes to your tree" : "Qalam AI is picking out what customers said"}</span>
        <Spinner size={12} />
        <Button size="sm" variant="secondary" onClick={() => (placing ? stopDump(placing) : stopSources())}>
          Stop
        </Button>
      </Pill>
    ) : null;

  // One bar per card (or note) a proposal adds or changes, on the ghost where it's drawn.
  const bars: { id: string; box: { x: number; y: number; w: number; h: number }; list: Proposal[] }[] = [];
  const seen = new Set<string>();
  for (const g of ghosts) {
    if (g.turnId !== REVIEW_TURN) continue;
    for (const id of new Set(proposals.map((p) => p.cardId))) {
      if (seen.has(id) || !g.doc.nodes[id] || !g.doc.roots.some((r) => r === id || isUnder(g.doc, id, r))) continue;
      seen.add(id);
      const box = toScreenBox(worldBounds(g.doc, id), cam);
      // Zoomed far out the cards are specks: the pill speaks for them until you zoom in.
      if (box.w < MIN_CARD_W || box.x + box.w < 0 || box.x > vp.w || box.y + box.h < 0 || box.y > vp.h) continue;
      bars.push({ id, box, list: proposals.filter((p) => p.cardId === id) });
    }
  }
  const from = origin?.kind === "dump" ? "your brain dump" : origin?.kind === "placed" ? "what was added to the organization" : "your sources";
  return (
    <>
      <Pill>
        <QalamAIGlyph size={14} />
        <span className="min-w-0 truncate" title={`Qalam AI proposes ${plural(proposals.length, "change")} from ${from}`}>
          {plural(proposals.length, "change")} from {from}
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

/** A node of a ghost under one of its roots (a ghost holds its group's other trees too). */
function isUnder(doc: { nodes: Record<string, { parentId: string | null }> }, id: string, root: string): boolean {
  for (let p = doc.nodes[id]?.parentId; p; p = doc.nodes[p]?.parentId ?? null) if (p === root) return true;
  return false;
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-auto absolute top-[12px] left-1/2 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-[10px] rounded-lg bg-elevated py-[6px] pr-[6px] pl-[10px] text-caption font-medium whitespace-nowrap text-fg shadow-popover q-fade [&>button]:shrink-0" role="status">
      {children}
    </div>
  );
}

const title = (id: string | null) => (id ? cardOf(studio().doc, id)?.title || "Untitled" : "");

/** What one proposal is, in a few words, for the bar. */
function label(p: Proposal, all: Proposal[]): string {
  switch (p.kind) {
    case "card": {
      const k = p.card.kind;
      if (k === "outcome") {
        if (!p.parentId) return "New goal tree";
        const parent = cardOf(studio().doc, p.parentId)?.kind ?? all.find((x): x is Extract<Proposal, { kind: "card" }> => x.kind === "card" && x.cardId === p.parentId)?.card.kind;
        return parent === "outcome" ? "New sub-outcome" : "New outcome";
      }
      if (k === "opportunity" && !p.backing.quotes.length && !p.backing.words.length) return "New problem · Assumed";
      return `New ${k}`;
    }
    case "attach":
      return evidenceOf(p.quote, false)?.kind === "dump" ? "Your words" : "Quote";
    case "against":
      return "Against";
    case "assumption":
      return `+${plural(p.assumptions.length, "assumption")}`;
    case "metric":
      return "New numbers";
    case "edit":
      return "Reword";
    case "move":
      return "Moved here";
    case "merge":
      return `Merge “${title(p.dropId)}” into this`;
    case "note":
      return p.color === "pink" ? "Pushback" : "Open question";
  }
}

/** What a card's proposals amount to: "New opportunity · +2 pieces of yours", "+2 quotes · 1 against". */
function summary(list: Proposal[], all: Proposal[]): string {
  const words = list.filter((p) => p.kind === "attach" && evidenceOf(p.quote, false)?.kind === "dump").length;
  const quotes = list.filter((p) => p.kind === "attach").length - words;
  const against = list.filter((p) => p.kind === "against").length;
  const rest = list.filter((p) => p.kind !== "attach" && p.kind !== "against").map((p) => label(p, all));
  return [...rest, words && `+${plural(words, "piece")} of yours`, quotes && `+${plural(quotes, "quote")}`, against && `${against} against`].filter(Boolean).join(" · ");
}

function Words({ text }: { text: string }) {
  return (
    <blockquote className="flex gap-[6px] text-caption leading-[18px] text-fg" dir="auto">
      <Quote size={12} className="mt-[3px] shrink-0 text-fg-subtle" />
      <span className="line-clamp-4">{text}</span>
    </blockquote>
  );
}

/** One proposal in an opened bar: what it would do. */
function Detail({ p }: { p: Proposal }) {
  switch (p.kind) {
    case "attach":
    case "against": {
      const ev = evidenceOf(p.quote, p.kind === "against");
      return ev ? <Words text={ev.text} /> : null;
    }
    case "card":
      return (
        <div className="flex flex-col gap-[4px]">
          {[...p.backing.quotes.map((q) => evidenceOf(q, false)?.text).filter((t): t is string => !!t), ...p.backing.words.map((w) => w.text)].map((t, i) => (
            <Words key={i} text={t} />
          ))}
          {metricText(p.card.metric) && <span className="text-caption text-fg-muted tnum">{metricText(p.card.metric)}</span>}
          {p.card.assumptions?.map((a) => (
            <span key={a.id} className="text-caption text-fg-muted" dir="auto">
              {ASSUMPTION_LABEL[a.category]}: {a.text}
            </span>
          ))}
        </div>
      );
    case "assumption":
      return (
        <div className="flex flex-col gap-[2px]">
          {p.assumptions.map((a) => (
            <span key={a.id} className="text-caption text-fg" dir="auto">
              {ASSUMPTION_LABEL[a.category]}: {a.text}
            </span>
          ))}
        </div>
      );
    case "metric":
      return (
        <span className="text-caption text-fg tnum">
          {Object.entries(p.metric)
            .map(([k, v]) => `${k} ${v}`)
            .join(" · ")}
        </span>
      );
    case "edit":
      return (
        <span className="flex flex-wrap items-center gap-[4px] text-caption" dir="auto">
          {p.title && (
            <>
              <span className="text-fg-subtle line-through">{p.from}</span>
              <ArrowRight {...SMALL} className="shrink-0 text-fg-subtle" />
              <span className="text-fg">{p.title}</span>
            </>
          )}
          {p.description && <span className="w-full text-fg-muted">{p.description}</span>}
        </span>
      );
    case "move":
      return <span className="text-caption text-fg-muted">From {p.fromParent ? `under “${title(p.fromParent)}”` : "the board"}</span>;
    case "merge": {
      const drop = cardOf(studio().doc, p.dropId);
      const kids = studio().doc.nodes[p.dropId]?.children.length ?? 0;
      const ev = drop?.evidence.length ?? 0;
      return (
        <span className="text-caption text-fg-muted" dir="auto">
          “{drop?.title}” folds in{ev ? ` with ${plural(ev, "piece")} of evidence` : ""}
          {kids ? `${ev ? " and" : " with"} ${plural(kids, "card")} under it` : ""}
          {p.title ? `, as “${p.title}”` : ""}.
        </span>
      );
    }
    case "note":
      return <Words text={p.text} />;
  }
}

/** Under a card a proposal adds or changes, in the gap above its children: what it is, accept, discard. */
function ProposalBar({ box, list }: { box: { x: number; y: number; w: number; h: number }; list: Proposal[] }) {
  const [open, setOpen] = useState(false);
  const all = useReview((s) => s.proposals);
  const w = Math.min(MAX_BAR_W, box.w);
  const roomy = w >= 200;
  const ids = list.map((p) => p.id);
  const text = summary(list, all);
  return (
    <div className={clsx("pointer-events-auto absolute flex flex-col gap-[4px] q-fade", open && "z-10")} style={{ left: box.x + box.w / 2 - w / 2, top: box.y + box.h + 4, width: w, minWidth: open ? 260 : undefined }} onPointerDown={(e) => e.stopPropagation()}>
      <div role="group" aria-label="Qalam AI's proposal" className="flex h-[26px] items-center rounded-lg bg-elevated p-[1px] pl-[8px] shadow-popover">
        <button type="button" aria-expanded={open} title={open ? "Hide the details" : `${text}: show the details`} className="q-item flex h-[24px] min-w-0 flex-1 items-center gap-[6px] rounded-md pr-[4px] text-left text-caption font-medium text-fg" onClick={() => setOpen(!open)}>
          <QalamAIGlyph size={12} />
          <span className="min-w-0 truncate">{text}</span>
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
        <div className="flex max-h-[300px] flex-col gap-[8px] overflow-y-auto rounded-lg bg-elevated p-[8px] shadow-popover">
          {list.map((p) => (
            <figure key={p.id} className="flex flex-col gap-[4px]">
              {list.length > 1 && <span className="text-micro font-medium text-fg-subtle">{label(p, all)}</span>}
              <Detail p={p} />
              <figcaption className="flex items-center gap-[6px] text-micro text-fg-subtle">
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {p.kind === "against" ? "Against · " : ""}
                  {p.why}
                </span>
                {list.length > 1 && (
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
          ))}
        </div>
      )}
    </div>
  );
}
