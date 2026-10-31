import { useState } from "react";
import clsx from "clsx";
import { ArrowRight, ExternalLink, FileText, Globe, PenLine, Star, Target, X } from "lucide-react";
import { connectorDef } from "@/connectors/catalog";
import { evidenceSummary } from "@/discovery/evidence";
import { KIND_LABEL, stageLabel } from "@/discovery/kinds";
import type { Lane, LaneItem } from "@/discovery/lane";
import { metricProgress } from "@/discovery/metric";
import type { OstCard } from "@/discovery/types";
import type { Doc } from "@/doc/schema";
import type { GoalsNow } from "@/goals/client";
import { metricLine } from "@/goals/goals-md";
import type { Job } from "@/goals/jobs";
import type { MapThing } from "@/goals/map";
import { goalById } from "@/goals/tree";
import type { RankedNeed } from "@/hub/needs";
import { goalHref, projectHref, topicHref } from "@/projects/model";
import { ConnectorLogo } from "../brand/ConnectorLogo";
import { Button, IconBtn } from "../controls";
import { EvidenceStrip } from "../discovery/EvidenceStrip";
import { r } from "../recipes";
import { startBoardForGoal, startBoardForNeed } from "../topics/start-board";
import { Meter } from "../viz";

/*
 * The map's panel when a card is picked: what it is, where it stands and what backs it, its
 * sources (each opens the reader), and where to go next: its board (where it's edited, and where
 * Qalam AI drafts what comes under it), its page, or a board to start. Picking nothing gives the
 * panel back to the space's own (Ask, Needs a look).
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** A card on its board, opened on it; `then` runs Qalam AI's next step there (draft solutions or tests). */
export const cardHref = (board: string, card: string, then?: "solutions" | "tests") => `${projectHref({ id: board, type: "discovery" })}?card=${encodeURIComponent(card)}${then ? `&then=${then}` : ""}`;

/** Where a card on the map opens: its card on its board, else its goal's or problem's page. */
export function hrefOf(thing: MapThing): string {
  if (thing.type === "problem") return topicHref(thing.topic);
  if (thing.type === "goal") return thing.board && thing.card ? cardHref(thing.board, thing.card) : goalHref(thing.goal);
  return cardHref(thing.board, thing.card);
}

export function PickedPanel({
  id,
  thing,
  doc,
  tree,
  jobs,
  needs,
  lane,
  boardName,
  onClose,
  onRead,
}: {
  id: string;
  thing: MapThing;
  doc: Doc;
  tree: GoalsNow;
  jobs: Job[];
  needs: RankedNeed[] | null;
  lane: Lane;
  boardName: (id: string) => string | undefined;
  onClose: () => void;
  onRead: (item: LaneItem) => void;
}) {
  const card = doc.nodes[id]?.meta.ost as OstCard | undefined;
  if (!card) return null;
  const sources = lane.items.filter((i) => i.cards.includes(id));
  const head = thing.type === "goal" ? (thing.goal === tree.north ? "North Star" : goalById(tree, thing.goal)?.parent ? "Sub-goal" : "Goal") : thing.type === "problem" ? "Problem" : KIND_LABEL[card.kind];
  return (
    <div className="flex flex-col gap-[14px] px-[16px] py-[14px]">
      <div className="flex items-start gap-[8px]">
        <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <span className="text-caption text-fg-subtle">
            {head}
            {thing.type !== "problem" && <> · {stageLabel(card.kind, card.stage)}</>}
            {thing.type === "card" && boardName(thing.board) && <> · {boardName(thing.board)}</>}
          </span>
          <h2 className="text-title font-medium text-fg" dir="auto">
            {card.title || "Untitled"}
          </h2>
        </div>
        <IconBtn size="sm" label="Back to the space" onClick={onClose}>
          <X size={14} absoluteStrokeWidth strokeWidth={1.5} />
        </IconBtn>
      </div>
      {card.description?.trim() && (
        <p className="text-body text-fg-muted" dir="auto">
          {card.description}
        </p>
      )}
      {thing.type === "goal" && <GoalPart goal={thing.goal} board={thing.board} card={thing.card} tree={tree} jobs={jobs} />}
      {thing.type === "card" && <CardPart thing={thing} card={card} />}
      {thing.type === "problem" && <ProblemPart thing={thing} need={needs?.find((n) => n.topic === thing.topic)} tree={tree} />}
      {thing.type !== "problem" && card.kind !== "outcome" && <EvidenceStrip s={evidenceSummary(card)} />}
      {sources.length > 0 && (
        <section aria-labelledby="map-sources" className="flex flex-col gap-[6px]">
          <h3 id="map-sources" className="text-caption font-medium text-fg-muted">
            Sources <span className="font-normal text-fg-subtle">{sources.length}</span>
          </h3>
          <ul className="flex flex-col gap-[2px]">
            {sources.map((s) => (
              <li key={s.key}>
                <button type="button" onClick={() => onRead(s)} className="q-item flex w-full min-w-0 items-center gap-[8px] rounded-md px-[6px] py-[5px] text-left hover:bg-hover">
                  <SourceMark mark={s.mark} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body text-fg">{s.title}</span>
                    <span className="truncate text-caption text-fg-subtle">
                      {s.line} · {plural(s.quotes.length, "quote")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** A source's mark: its connector's logo, else what it is (their words, a page, a file). */
function SourceMark({ mark }: { mark: string }) {
  if (connectorDef(mark)) return <ConnectorLogo id={mark} size={16} decorative />;
  const Icon = mark === "said" || mark === "dump" ? PenLine : mark === "page" || mark === "url" ? Globe : FileText;
  return (
    <span className="grid size-[16px] shrink-0 place-items-center rounded-[3px] bg-kh-research/15 text-kh-research">
      <Icon size={11} absoluteStrokeWidth strokeWidth={1.5} />
    </span>
  );
}

function GoalPart({ goal, board, card, tree, jobs }: { goal: string; board?: string; card?: string; tree: GoalsNow; jobs: Job[] }) {
  const g = goalById(tree, goal);
  const [busy, setBusy] = useState(false);
  if (!g) return null;
  const above = goalById(tree, g.parent);
  const progress = metricProgress(g.metric);
  const next = jobs.find((j) => j.goal === g.id);
  return (
    <>
      <div className="flex flex-col gap-[6px]">
        <span className="text-body text-fg tnum">{g.metric ? metricLine(g.metric) : <span className="text-fg-muted">No number yet</span>}</span>
        {progress !== null && <Meter value={progress} label={`${Math.round(progress * 100)}% of the way to the target`} />}
        {above && (
          <a href={goalHref(above.id)} className="flex min-w-0 items-center gap-[6px] text-caption text-fg-muted hover:text-fg">
            <span className="shrink-0 text-fg-subtle">{above.id === tree.north ? <Star {...ICON} /> : <Target {...ICON} />}</span>
            <span className="truncate">Feeds {above.title}</span>
          </a>
        )}
        {next && (
          <a href={`${goalHref(g.id)}#unknowns`} className="flex min-w-0 items-center gap-[6px] text-caption text-fg-muted hover:text-fg">
            <ArrowRight {...ICON} className="shrink-0 text-fg-subtle" />
            <span className="truncate">Next: {next.title}</span>
          </a>
        )}
      </div>
      <div className="flex flex-wrap gap-[6px]">
        {board && card ? (
          <a href={cardHref(board, card)} className={clsx(r.buttonSm, r.buttonPrimary)}>
            Open its board
          </a>
        ) : (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void startBoardForGoal(g).finally(() => setBusy(false));
            }}
          >
            {busy ? "Starting…" : "Start a board"}
          </Button>
        )}
        <a href={goalHref(g.id)} className={clsx(r.buttonSm, r.buttonSecondary)}>
          Its page
        </a>
      </div>
    </>
  );
}

function CardPart({ thing, card }: { thing: Extract<MapThing, { type: "card" }>; card: OstCard }) {
  const then = card.kind === "opportunity" ? "solutions" : card.kind === "solution" ? "tests" : undefined;
  return (
    <div className="flex flex-wrap gap-[6px]">
      <a href={cardHref(thing.board, thing.card)} className={clsx(r.buttonSm, then ? r.buttonSecondary : r.buttonPrimary)}>
        Open on its board
      </a>
      {then && (
        <a href={cardHref(thing.board, thing.card, then)} className={clsx(r.buttonSm, r.buttonPrimary)}>
          {then === "solutions" ? "Draft solutions" : "Draft its tests"}
        </a>
      )}
    </div>
  );
}

function ProblemPart({ thing, need, tree }: { thing: Extract<MapThing, { type: "problem" }>; need?: RankedNeed; tree: GoalsNow }) {
  const [busy, setBusy] = useState(false);
  const g = goalById(tree, thing.goal);
  return (
    <>
      <p className="text-caption text-fg-muted">
        {g ? (g.on ? "Behind this goal, and not on its board yet." : "Behind this goal, which has no board yet.") : "Customers keep raising it, and no goal is linked to it yet."}
        {need && (
          <>
            {" "}
            {need.quotes ? `${plural(need.quotes, "quote")} from ${plural(need.sources, "source")}` : "No customer words yet"}
            {need.against ? `, ${need.against} against` : ""}.
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-[6px]">
        {g?.on ? (
          <a href={`${projectHref({ id: g.on.board, type: "discovery" })}?problem=${encodeURIComponent(thing.topic)}&under=${encodeURIComponent(g.on.card)}`} className={clsx(r.buttonSm, r.buttonPrimary)}>
            Work on it
          </a>
        ) : (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void (g ? startBoardForGoal(g, thing.topic) : startBoardForNeed(thing.topic)).finally(() => setBusy(false));
            }}
          >
            {busy ? "Starting…" : "Start a board"}
          </Button>
        )}
        <a href={topicHref(thing.topic)} className={clsx(r.buttonSm, r.buttonSecondary)}>
          Its page
          <ExternalLink {...ICON} className="ml-[4px] opacity-60" />
        </a>
      </div>
    </>
  );
}
