import clsx from "clsx";
import { ArrowRight, Star, Target } from "lucide-react";
import { metricProgress } from "@/discovery/metric";
import type { GoalsNow } from "@/goals/client";
import { metricLine } from "@/goals/goals-md";
import { rankForGoal } from "@/goals/problems";
import { childrenOf, rootsOf } from "@/goals/tree";
import type { Bearing } from "@/goals/bearings";
import type { Job } from "@/goals/jobs";
import type { Goal } from "@/goals/types";
import type { NeedsNow } from "@/org/needs";
import { goalHref, spaceHref, topicHref } from "@/projects/model";
import { r } from "../recipes";
import { inSpace, type Space } from "../frame/spaces";
import { Meter, StatusDot } from "../viz";

/*
 * The home's first block: the goals this person works on (the ones they marked theirs, else the
 * North Star and the goals right under it), each with its number, the problems behind it that
 * bear on it most directly, and the next job to do for it. Everything else about a goal is on its page.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const SHOWN = 6;
const PROBLEMS = 3;
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/**
 * The goals a space's home leads with: this person's in it, else the North Star and the goals right
 * under it; in a product's space, the North Star and the product's goals that feed no other of its own.
 */
export function homeGoals(t: GoalsNow, space: Space = null): { goals: Goal[]; mine: boolean } {
  const mine = t.goals.filter((g) => t.mine.includes(g.id) && (inSpace(g.product, space) || g.id === t.north));
  if (mine.length) return { goals: mine.slice(0, SHOWN), mine: true };
  const north = t.goals.find((g) => g.id === t.north);
  const own = new Set(t.goals.filter((g) => space && g.product === space).map((g) => g.id));
  const near = space ? t.goals.filter((g) => own.has(g.id) && (!g.parent || !own.has(g.parent))) : north ? childrenOf(t, north.id) : rootsOf(t);
  return { goals: [...(north ? [north] : []), ...near.filter((g) => g !== north)].slice(0, SHOWN), mine: false };
}

export function YourGoals({ tree, space, shown, mine, needs, links, jobs }: { tree: GoalsNow; space: Space; shown: Goal[]; mine: boolean; needs: NeedsNow | null; links: Bearing[]; jobs: Job[] }) {
  const all = tree.goals.filter((g) => inSpace(g.product, space)).length;
  return (
    <section aria-labelledby="your-goals" className="flex flex-col gap-[10px]">
      <div className="flex items-end justify-between gap-[12px]">
        <h2 id="your-goals" className="text-title font-medium">
          {mine ? "Your goals" : "Goals"}
        </h2>
        {all > shown.length && (
          <a href={spaceHref(space, "goals")} className={clsx(r.buttonSm, r.buttonGhost)}>
            All {all}
          </a>
        )}
      </div>
      {!tree.loaded ? (
        <div className="grid gap-[12px] sm:grid-cols-2" aria-hidden>
          {[0, 1].map((i) => (
            <div key={i} className={clsx(r.skeleton, "h-[132px] rounded-lg")} />
          ))}
        </div>
      ) : !shown.length ? (
        <div className="flex flex-wrap items-center justify-between gap-[12px] rounded-lg bg-panel px-[14px] py-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          <p className="text-body text-fg-muted">{space ? "No goals for this product yet." : "No goals yet. Start with the North Star: what the whole company is trying to move."}</p>
          <a href={spaceHref(space, "goals")} className={clsx(r.buttonSm, r.buttonSecondary)}>
            Set the goals
          </a>
        </div>
      ) : (
        <ul className="grid gap-[12px] sm:grid-cols-2">
          {shown.map((g) => (
            <GoalCard key={g.id} g={g} north={g.id === tree.north} problems={rankForGoal(g.id, { tree, links, needs: needs?.needs ?? [] })} next={jobs.find((j) => j.goal === g.id)} />
          ))}
        </ul>
      )}
      {!mine && shown.length > 0 && <p className="text-caption text-fg-subtle">Which are yours? A goal&apos;s page has “Make it yours”.</p>}
    </section>
  );
}

function GoalCard({ g, north, problems, next }: { g: Goal; north: boolean; problems: ReturnType<typeof rankForGoal>; next?: Job }) {
  const progress = metricProgress(g.metric);
  return (
    <li className="flex flex-col gap-[10px] rounded-lg bg-panel px-[14px] py-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <a href={goalHref(g.id)} className="flex min-w-0 items-start gap-[8px] hover:underline">
        <span className={clsx("mt-[3px] shrink-0", north ? "text-fg" : "text-fg-subtle")}>{north ? <Star {...ICON} /> : <Target {...ICON} />}</span>
        <span className="flex min-w-0 flex-col">
          <span className="text-body font-medium text-fg">{g.title}</span>
          <span className="text-caption text-fg-muted tnum">{[north ? "North Star" : null, g.metric ? metricLine(g.metric) : "No number yet"].filter(Boolean).join(" · ")}</span>
        </span>
      </a>
      {progress !== null && <Meter value={progress} label={`${Math.round(progress * 100)}% of the way to the target`} />}
      {problems.length ? (
        <ul className="flex flex-col gap-[4px]">
          {problems.slice(0, PROBLEMS).map((p) => (
            <li key={p.topic} className="flex min-w-0 items-center gap-[8px]">
              <StatusDot tone={p.bears === "direct" ? "ok" : "off"} hollow={p.bears !== "direct"} />
              <a href={topicHref(p.topic)} className="min-w-0 truncate text-caption text-fg hover:underline">
                {p.title}
              </a>
              <span className="ml-auto shrink-0 text-micro text-fg-subtle tnum">{p.quotes ? `${plural(p.quotes, "quote")} · ${plural(p.sources, "source")}` : "no customer words yet"}</span>
            </li>
          ))}
          {problems.length > PROBLEMS && (
            <li>
              <a href={goalHref(g.id)} className="text-micro text-fg-subtle hover:text-fg">
                {plural(problems.length - PROBLEMS, "more problem")} behind it
              </a>
            </li>
          )}
        </ul>
      ) : (
        <a href={goalHref(g.id)} className="text-caption text-fg-subtle hover:text-fg">
          No problems linked yet: find the problems behind it
        </a>
      )}
      {next && (
        <a href={`${goalHref(g.id)}#unknowns`} className="flex min-w-0 items-center gap-[6px] border-t border-line-subtle pt-[8px] text-caption text-fg-muted hover:text-fg">
          <ArrowRight {...ICON} className="shrink-0 text-fg-subtle" />
          <span className="truncate">Next: {next.title}</span>
        </a>
      )}
    </li>
  );
}
