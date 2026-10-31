import { useState } from "react";
import clsx from "clsx";
import { ArrowRight, ExternalLink, LucideProvider, Star, Target, X } from "lucide-react";
import { studio } from "@/doc/store";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import { metricProgress } from "@/discovery/metric";
import type { GoalsNow } from "@/goals/client";
import { metricLine } from "@/goals/goals-md";
import type { Job } from "@/goals/jobs";
import { goalById } from "@/goals/tree";
import type { RankedNeed } from "@/hub/needs";
import { sameTopic } from "@/hub/topics";
import { goalHref, topicHref } from "@/projects/model";
import type { SpaceThing } from "@/space/compose";
import { Button, IconBtn } from "../controls";
import CardPanel from "../discovery/CardPanel";
import { glideToLayer, onCanvasReady } from "../discovery/canvas";
import { r } from "../recipes";
import { problemCard } from "../topics/start-board";
import { Meter } from "../viz";

/*
 * The home's panel for what's picked on the space's canvas: a goal's number and where it sits
 * over the board's own card panel (its words, stage, notes, number, evidence, history), and for a
 * problem no board has yet, what's behind it and "Work on it", which puts it on the canvas where
 * it shows (starting the goal's board when it has none).
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function SpaceCardPanel({ ids, things, tree, jobs, needs }: { ids: string[]; things: ReadonlyMap<string, SpaceThing>; tree: GoalsNow; jobs: Job[]; needs: RankedNeed[] | null }) {
  const thing = ids.length === 1 ? things.get(ids[0]) : undefined;
  const close = (
    <IconBtn size="sm" label="Back to the space" onClick={() => studio().select([])}>
      <X size={14} absoluteStrokeWidth strokeWidth={1.5} />
    </IconBtn>
  );
  if (thing?.type === "problem") return <ProblemPanel id={ids[0]} thing={thing} need={needs?.find((n) => n.topic === thing.topic)} tree={tree} close={close} />;
  return (
    <LucideProvider strokeWidth={1.25} absoluteStrokeWidth>
      <div aria-label="Card" data-region="design" className="flex flex-col pb-[24px]">
        {thing?.type === "goal" && <GoalSummary goal={thing.goal} tree={tree} jobs={jobs} close={close} />}
        <CardPanel ids={ids.filter((id) => things.get(id)?.type !== "problem")} />
      </div>
    </LucideProvider>
  );
}

/** A goal's number, the goal it feeds, its next job, and its page. */
function GoalSummary({ goal, tree, jobs, close }: { goal: string; tree: GoalsNow; jobs: Job[]; close: React.ReactNode }) {
  const g = goalById(tree, goal);
  if (!g) return null;
  const above = goalById(tree, g.parent);
  const progress = metricProgress(g.metric);
  const next = jobs.find((j) => j.goal === g.id);
  return (
    <section className={clsx(r.section, "gap-[8px]")}>
      <div className="flex h-[32px] items-center gap-[8px]">
        <h3 className={r.sectionTitle}>{g.id === tree.north ? "North Star" : g.parent ? "Sub-goal" : "Goal"}</h3>
        <span className="flex-1" />
        <a href={goalHref(g.id)} className="text-caption text-fg-muted hover:text-fg">
          Its page
        </a>
        {close}
      </div>
      <span className="text-body text-fg tnum">{g.metric ? metricLine(g.metric) : <span className="text-fg-muted">No number yet</span>}</span>
      {progress !== null && <Meter value={progress} label={`${Math.round(progress * 100)}% of the way to the target`} />}
      {above && (
        <a href={goalHref(above.id)} className="flex min-w-0 items-center gap-[6px] text-caption text-fg-muted hover:text-fg">
          <span className="shrink-0 text-fg-subtle">{above.id === tree.north ? <Star {...ICON} size={12} /> : <Target {...ICON} size={12} />}</span>
          <span className="truncate">Feeds {above.title}</span>
        </a>
      )}
      {next && (
        <a href={`${goalHref(g.id)}#unknowns`} className="flex min-w-0 items-center gap-[6px] text-caption text-fg-muted hover:text-fg">
          <ArrowRight {...ICON} size={12} className="shrink-0 text-fg-subtle" />
          <span className="truncate">Next: {next.title}</span>
        </a>
      )}
      {!g.on && <p className="text-caption text-fg-subtle">No board yet: add a problem under it and it starts one.</p>}
    </section>
  );
}

/** A problem no board has: what's behind it, and putting it on the canvas. */
function ProblemPanel({ id, thing, need, tree, close }: { id: string; thing: Extract<SpaceThing, { type: "problem" }>; need?: RankedNeed; tree: GoalsNow; close: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const g = goalById(tree, thing.goal);
  const title = studio().doc.nodes[id]?.meta.ost?.title ?? need?.title ?? "";
  return (
    <div className="flex flex-col gap-[14px] px-[16px] py-[14px]">
      <div className="flex items-start gap-[8px]">
        <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <span className="text-caption text-fg-subtle">Problem · not on a board yet</span>
          <h2 className="text-title font-medium text-fg" dir="auto">
            {title || "Untitled"}
          </h2>
        </div>
        {close}
      </div>
      <p className="text-caption text-fg-muted">
        {g ? `Behind ${g.title}.` : "Customers keep raising it, and no goal is linked to it yet."}
        {need && (
          <>
            {" "}
            {need.quotes ? `${plural(need.quotes, "quote")} from ${plural(need.sources, "source")}` : "No customer words yet"}
            {need.against ? `, ${need.against} against` : ""}.
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-[6px]">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void workOnProblem(thing.topic, id).finally(() => setBusy(false));
          }}
        >
          {busy ? "Adding…" : "Work on it"}
        </Button>
        <a href={topicHref(thing.topic)} className={clsx(r.buttonSm, r.buttonSecondary)}>
          Its page
          <ExternalLink size={12} absoluteStrokeWidth strokeWidth={1.25} className="ml-[4px] opacity-60" />
        </a>
      </div>
    </div>
  );
}

/**
 * A problem's page put on the canvas where it shows: under its goal's card (or on its own, when no
 * goal has it), resting on what customers said, as one edit (undo takes it back). One already on
 * the canvas under the same name is just shown.
 */
export async function workOnProblem(topic: string, faint: string): Promise<string | null> {
  const c = await problemCard(topic);
  if (!c) return null;
  const doc = studio().doc;
  const under = doc.nodes[faint]?.parentId ?? null;
  const there = (under ? doc.nodes[under].children : doc.roots).find((k) => doc.nodes[k]?.meta.ost?.kind === "opportunity" && !k.startsWith("topic:") && sameTopic(doc.nodes[k].meta.ost!.title, c.title));
  let id = there;
  if (!id) {
    const node = makeCardNode(newCard("opportunity", { title: c.title, evidence: c.evidence }));
    // In the page's place: the page itself goes (it was never saved; it's this card now).
    studio().mutate((d) => {
      const list = under ? d.nodes[under].children : d.roots;
      const at = list.indexOf(faint);
      if (at >= 0) list.splice(at, 1);
      delete d.nodes[faint];
      addCardIn(d, node, under, Math.max(0, at));
    });
    id = node.id;
  }
  studio().select([id]);
  onCanvasReady((cv) => glideToLayer(cv, id!));
  return id;
}
