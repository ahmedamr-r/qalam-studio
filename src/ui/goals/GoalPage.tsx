import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { MoreHorizontal, X } from "lucide-react";
import { callAI } from "@/ai/client";
import { feedback } from "@/commands/feedback";
import type { Decision } from "@/decisions/model";
import { metricProgress } from "@/discovery/metric";
import type { OstMetric } from "@/discovery/types";
import { changeGoal, goalsNow, removeGoal, setMine, setNorth, useGoals } from "@/goals/client";
import { stepRef, type MapFlow, type ProductMap } from "@/code/map";
import type { StepView } from "@/code/steps";
import type { GoalWork } from "@/goals/breakdown";
import type { Gap } from "@/goals/gaps";
import { metricLine } from "@/goals/goals-md";
import type { Job } from "@/goals/jobs";
import type { GoalProblem } from "@/goals/problems";
import { underOf } from "@/goals/tree";
import type { Goal } from "@/goals/types";
import { strengthFill, strengthOf } from "@/hub/needs";
import { orgFetch, orgJson, orgPath } from "@/org/client";
import { useOrgContext } from "@/org/context";
import { onOrgChange } from "@/org/live";
import { goalHref, projectHref, spaceHref, topicHref } from "@/projects/model";
import { Button, Tip } from "../controls";
import DecisionRow from "../decisions/DecisionRow";
import { PageFrame } from "../frame/PageFrame";
import { useCurrentOrg, useWords } from "../frame/store";
import { useItemSpace } from "../frame/useSpace";
import { Menu, MenuItem, MenuSeparator, SubMenu } from "../menu";
import { QalamAIGlyph } from "../brand";
import { r } from "../recipes";
import { confirmDialog, promptDialog } from "../surfaces/dialog";
import { startBoardForGoal } from "../topics/start-board";
import { Meter, StatusDot } from "../viz";
import { GoalsUnder, OtherAims } from "./Breakdown";
import { Funnel } from "./Funnel";
import { Unknowns } from "./Unknowns";
import { FlowsToward } from "../seen/SeenSection";
import { navigate } from "../nav";

/**
 * A goal's page: the number and how far there is to go, the goal it feeds and the goals under it,
 * the board working on it, and the problems behind it, the ones that bear directly on its number
 * first, each with one line on how it would move it. "Find problems" has Qalam AI read the
 * organization's problem pages against the goal (code keeps only links it can stand behind);
 * "Work on it" puts a problem on the goal's board. Then what isn't known yet and the jobs that would
 * find it out (./Unknowns.tsx), what others aim for and the goals it breaks into (./Breakdown.tsx),
 * and what was decided about it.
 */

interface PageData {
  goal: Goal;
  north: string | null;
  chain: Goal[];
  children: Goal[];
  boards: { goal: string; board: string; name: string; card: string }[];
  problems: GoalProblem[];
  gaps: Gap[];
  jobs: Job[];
  work: GoalWork;
  funnel: { map: ProductMap; flow: MapFlow } | null;
  steps: StepView | null;
  unlinked: { id: string; title: string; sources: number; quotes: number }[];
  decisions: Decision[];
  indexed: boolean;
}

interface Linked {
  added: number;
  kept: number;
  removed: number;
  none: string;
}

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const STATUS: Record<Goal["status"], string> = { active: "Active", achieved: "Achieved", paused: "Paused" };

export default function GoalPage({ id }: { id: string }) {
  const [page, setPage] = useState<PageData | null>(null);
  const [missing, setMissing] = useState(false);
  const [finding, setFinding] = useState<string | null>(null);
  const [found, setFound] = useState<Linked | null>(null);
  const goals = useGoals();
  const { products } = useOrgContext();
  const words = useWords();
  const solo = useCurrentOrg()?.shape === "solo";

  const load = useCallback(() => {
    void orgJson<PageData>(`/goals/${encodeURIComponent(id)}/page`).then(
      (p) => setPage(p),
      () => setMissing(true),
    );
  }, [id]);
  // The tab names the goal, and gives the title back when the page goes (moving in place, src/ui/nav.ts).
  const title = page?.goal.title;
  useEffect(() => {
    if (!title) return;
    const was = document.title;
    document.title = `${title} · Qalam`;
    return () => void (document.title = was);
  }, [title]);

  useEffect(() => {
    load();
    return onOrgChange((c) => {
      if (c.kind === "goal" || c.kind === "bearing" || c.kind === "job" || c.kind === "step" || (c.kind === "goalwork" && c.goal === id) || c.kind === "map" || c.kind === "topic" || c.kind === "decision" || c.kind === "project") load();
    });
  }, [load]);
  // This window's own changes to goals come back through the goals store.
  useEffect(() => {
    if (goals.loaded) load();
  }, [goals.version, goals.loaded, load]);

  // The space it shows in: the tab's, else its product's (src/ui/frame/spaces.ts).
  const space = useItemSpace(page ? (page.goal.product ? [page.goal.product] : []) : null);
  const goalsCrumb = { label: "Goals", href: spaceHref(space, "goals") };

  if (missing)
    return (
      <PageFrame place="goals" crumbs={[goalsCrumb]} space={space}>
        <div className={clsx(r.pageMain, "max-w-[880px] items-start")}>
          <p className="text-title font-medium">This goal isn&apos;t here</p>
          <a href={spaceHref(space)} className={clsx(r.button, r.buttonSecondary)}>
            Back home
          </a>
        </div>
      </PageFrame>
    );
  if (!page)
    return (
      <PageFrame place="goals" crumbs={[goalsCrumb]} space={space}>
        {null}
      </PageFrame>
    );

  const g = page.goal;
  const north = page.north === g.id;
  const mine = goals.mine.includes(g.id);
  const product = g.product ? products.find((p) => p.id === g.product)?.name : null;
  const board = page.boards.find((b) => b.goal === g.id) ?? null;
  // The goals it could feed: any but itself and the goals under it (the North Star first).
  const below = new Set(underOf(goalsNow(), g.id).map((x) => x.id));
  const feedsInto = goals.goals.filter((x) => x.id !== g.id && !below.has(x.id)).sort((a, b) => (a.id === page.north ? -1 : b.id === page.north ? 1 : 0));

  const find = async () => {
    setFinding("Qalam AI is reading the problems against the goal");
    setFound(null);
    try {
      const { data } = await callAI<Linked>(await orgPath(`/goals/${encodeURIComponent(id)}/problems`), {}, undefined, undefined, (e) => {
        if (e.type === "activity") setFinding(e.label);
      });
      setFound(data);
      load();
    } catch (e) {
      feedback(`Qalam AI couldn't finish: ${message(e)}`, { kind: "error", id: "goal.problems" });
    } finally {
      setFinding(null);
    }
  };

  const link = async (need: string, goal: string, on: boolean) => {
    await orgFetch("/bearings", { method: "POST", json: { need, goal, on } }).catch((e) => feedback(`Couldn't change it: ${message(e)}`, { kind: "error", id: "goal.link" }));
    load();
  };

  // A problem goes to the most specific goal it bears on: the goal under this one it came through, when it did.
  const workOn = (p: GoalProblem) => {
    const target = (p.via && goals.goals.find((x) => x.id === p.via)) || g;
    const on = page.boards.find((b) => b.goal === target.id);
    if (on) return window.location.assign(`${projectHref({ id: on.board, type: "discovery" })}?problem=${encodeURIComponent(p.topic)}&under=${encodeURIComponent(on.card)}`);
    void startBoardForGoal(target, p.topic);
  };

  // The funnel's steps each problem is pinned at.
  const stepTitle = new Map(page.funnel ? page.funnel.flow.steps.map((s) => [stepRef(page.funnel!.map.key, s.key), s.title]) : []);
  const atSteps = (topic: string) => (page.steps?.pins ?? []).flatMap((p) => (p.what === "need" && p.id === topic && stepTitle.has(p.step) ? [stepTitle.get(p.step)!] : []));

  const rename = async () => {
    const title = await promptDialog({ title: "Rename the goal", label: "The change it's after", defaultValue: g.title, confirmLabel: "Rename", validate: (v) => (v.trim() ? null : "Say what it's after") });
    if (title?.trim()) await changeGoal(g.id, { title: title.trim() }).catch((e) => feedback(`Couldn't rename it: ${message(e)}`, { kind: "error", id: "goal.rename" }));
  };
  const takeOff = async () => {
    const ok = await confirmDialog({ title: `Take “${g.title}” off the goals?`, body: "The goals under it move up to the goal it feeds. What was decided about it stays in the log.", confirmLabel: "Take it off", danger: true });
    if (!ok) return;
    await removeGoal(g.id).then(
      () => navigate(spaceHref(space)),
      (e) => feedback(board ? "A board works on this goal: delete its outcome card there first." : `Couldn't take it off: ${message(e)}`, { kind: "error", id: "goal.remove" }),
    );
  };

  return (
    <PageFrame place="goals" crumbs={[goalsCrumb, ...[...page.chain].reverse().map((c) => ({ label: c.title, href: goalHref(c.id) })), { label: g.title }]} space={space}>
      <div className={clsx(r.pageMain, "max-w-[880px]")}>
        <header className="flex flex-col gap-[8px]">
          <div className="flex items-start justify-between gap-[12px]">
            <h1 className="text-display font-semibold text-fg">{g.title}</h1>
            <div className="flex shrink-0 items-center gap-[8px]">
              {/* On your own every goal is yours: nothing to pick. */}
              {!solo && (
                <Button variant={mine ? "secondary" : "ghost"} size="sm" onClick={() => void setMine(mine ? goals.mine.filter((x) => x !== g.id) : [...goals.mine, g.id])}>
                  {mine ? "Yours" : "Make it yours"}
                </Button>
              )}
              <Menu
                label="Goal actions"
                align="end"
                className="w-[220px]"
                trigger={
                  <button type="button" aria-label="Goal actions" className={r.iconButton}>
                    <MoreHorizontal {...ICON} />
                  </button>
                }
              >
                <MenuItem onSelect={() => void rename()}>Rename…</MenuItem>
                {!north && !g.parent && <MenuItem onSelect={() => void setNorth(g.id)}>Make it the North Star</MenuItem>}
                <SubMenu label="Feeds" checks>
                  {feedsInto.slice(0, 30).map((x) => (
                    <MenuItem key={x.id} checked={g.parent === x.id} onSelect={() => void changeGoal(g.id, { parent: x.id }).catch((e) => feedback(message(e), { kind: "error", id: "goal.move" }))}>
                      {x.id === page.north ? `North Star: ${x.title}` : x.title}
                    </MenuItem>
                  ))}
                  {!!feedsInto.length && <MenuSeparator />}
                  <MenuItem checked={!g.parent} onSelect={() => void changeGoal(g.id, { parent: null })}>
                    No goal yet
                  </MenuItem>
                </SubMenu>
                <SubMenu label="Where it stands">
                  {(Object.keys(STATUS) as Goal["status"][]).map((s) => (
                    <MenuItem key={s} checked={g.status === s} onSelect={() => void changeGoal(g.id, { status: s })}>
                      {STATUS[s]}
                    </MenuItem>
                  ))}
                </SubMenu>
                <MenuSeparator />
                <MenuItem danger onSelect={() => void takeOff()}>
                  Take it off the goals…
                </MenuItem>
              </Menu>
            </div>
          </div>
          <p className="text-caption text-fg-muted">
            {[north ? "North Star" : null, product ?? words.whole, g.status !== "active" ? STATUS[g.status] : null, page.chain[0] ? `feeds “${page.chain[0].title}”` : north ? null : "feeds no goal yet"].filter(Boolean).join(" · ")}
          </p>
        </header>

        <NumberBlock goal={g} />

        <Funnel goal={g} funnel={page.funnel} numbers={page.work.funnel} steps={page.steps} problems={page.problems} onWork={workOn} onChanged={load} />

        <FlowsToward goal={g.id} />

        <section aria-label="The board working on it" className="flex flex-wrap items-center justify-between gap-[12px] rounded-lg bg-panel px-[14px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          {board ? (
            <>
              <span className="text-body text-fg-muted">
                Worked on in <span className="text-fg">{board.name}</span>
              </span>
              <a href={`${projectHref({ id: board.board, type: "discovery" })}?card=${encodeURIComponent(board.card)}`} className={clsx(r.buttonSm, r.buttonSecondary)}>
                Open the board
              </a>
            </>
          ) : (
            <>
              <span className="text-body text-fg-muted">No board works on this goal yet.</span>
              <Button variant="secondary" size="sm" onClick={() => void startBoardForGoal(g)}>
                Start a board
              </Button>
            </>
          )}
        </section>

        <GoalsUnder goal={g} children={page.children} breakdown={page.work.breakdown} onChanged={load} />

        <section aria-labelledby="problems" className="flex flex-col gap-[10px]">
          <div className="flex flex-wrap items-end justify-between gap-[12px]">
            <div className="flex flex-col gap-[2px]">
              <h2 id="problems" className="text-title font-medium">
                Problems behind it
              </h2>
              <p className="text-caption text-fg-subtle">The ones that bear directly on its number first, then by what customers said.</p>
            </div>
            <div className="flex items-center gap-[8px]">
              {!!page.unlinked.length && (
                <Menu
                  label="Link a problem"
                  align="end"
                  className="max-h-[320px] w-[320px] overflow-y-auto"
                  trigger={
                    <button type="button" className={clsx(r.buttonSm, r.buttonGhost)}>
                      Link a problem…
                    </button>
                  }
                >
                  {page.unlinked.map((u) => (
                    <MenuItem key={u.id} onSelect={() => void link(u.id, g.id, true)}>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{u.title}</span>
                        <span className="text-micro text-fg-subtle">{u.quotes ? `${plural(u.quotes, "quote")} · ${plural(u.sources, "source")}` : "No customer words yet"}</span>
                      </span>
                    </MenuItem>
                  ))}
                </Menu>
              )}
              <Button variant="secondary" size="sm" disabled={!!finding} onClick={() => void find()}>
                <QalamAIGlyph size={12} /> {finding ? "Finding…" : "Find problems"}
              </Button>
            </div>
          </div>
          {finding && <p className="text-caption text-fg-muted">{finding}…</p>}
          {found && !finding && (
            <p className="text-caption text-fg-muted">
              {found.added || found.removed ? `${plural(found.kept, "problem")} bear on it${found.removed ? ` · ${found.removed} no longer` : ""}.` : found.kept ? "Nothing new: the same problems bear on it." : "Qalam AI found no problem that would move this goal."}
              {found.none && ` ${found.none}`}
            </p>
          )}
          {page.problems.length ? (
            <ul className="flex flex-col rounded-lg bg-panel py-[4px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
              {page.problems.map((p) => (
                <ProblemRow key={p.topic} p={p} via={p.via ? goals.goals.find((x) => x.id === p.via)?.title : undefined} at={atSteps(p.topic)} onWork={() => workOn(p)} onUnlink={() => void link(p.topic, p.via ?? g.id, false)} boardName={(b) => page.boards.find((x) => x.board === b)?.name} />
              ))}
            </ul>
          ) : (
            <p className="rounded-lg bg-panel px-[14px] py-[12px] text-body text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
              No problems linked yet. Find problems has Qalam AI read the problem pages against this goal; each link it keeps rests on what customers said.
            </p>
          )}
        </section>

        <Unknowns goal={g} gaps={page.gaps} jobs={page.jobs} onChanged={load} />

        <OtherAims goal={g} outside={page.work.outside} onChanged={load} />

        {!!page.decisions.length && (
          <section aria-labelledby="history" className="flex flex-col gap-[8px]">
            <h2 id="history" className="text-title font-medium">
              History
            </h2>
            <ul className="flex flex-col gap-[2px]">
              {page.decisions.map((d) => (
                <DecisionRow key={d.id} d={d} board={null} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </PageFrame>
  );
}

const STRENGTH: Record<ReturnType<typeof strengthOf>, string> = { strong: "Strong", growing: "Growing", thin: "Thin", assumed: "Assumed" };

function ProblemRow({ p, via, at, onWork, onUnlink, boardName }: { p: GoalProblem; via?: string; at: string[]; onWork: () => void; onUnlink: () => void; boardName: (board: string) => string | undefined }) {
  const strength = strengthOf(p);
  const onThis = p.onBoard ? p.boards.find((b) => boardName(b.board)) : undefined;
  return (
    <li className="group/problem grid grid-cols-[16px_minmax(0,1fr)_96px_minmax(0,240px)_28px] items-start gap-x-[12px] px-[12px] py-[8px] hover:bg-hover max-[760px]:grid-cols-[16px_minmax(0,1fr)_minmax(0,120px)_28px] max-[760px]:[&>.wide]:hidden">
      <Tip label={p.bears === "direct" ? "Bears directly on the number" : "Bears on it around the edges"}>
        <span className="pt-[3px]">
          <StatusDot tone={p.bears === "direct" ? "ok" : "off"} hollow={p.bears !== "direct"} />
        </span>
      </Tip>
      <span className="flex min-w-0 flex-col gap-[2px]">
        <a href={topicHref(p.topic)} className="truncate text-body text-fg hover:underline">
          {p.title}
        </a>
        {p.how ? (
          <span className="flex items-start gap-[6px] text-caption text-fg-muted">
            {p.by === "qalam" && <QalamAIGlyph size={12} className="mt-[2px] shrink-0" />}
            <span>{p.how}</span>
          </span>
        ) : (
          <span className="text-caption text-fg-subtle">Linked by you</span>
        )}
        {via && <span className="text-micro text-fg-subtle">Through “{via}”</span>}
        {!!at.length && (
          <a href="#funnel" className="truncate text-micro text-fg-subtle hover:text-fg">
            At {at.map((t) => `“${t}”`).join(", ")} in the funnel
          </a>
        )}
      </span>
      <span className="wide pt-[6px]">
        <Tip label={`${STRENGTH[strength]}: from ${plural(p.sources, "source")}`}>
          <span>
            <Meter value={strengthFill(p)} label={`${STRENGTH[strength]}, from ${plural(p.sources, "source")}`} />
          </span>
        </Tip>
      </span>
      <span className="flex min-w-0 flex-col items-end gap-[4px] pt-[1px]">
        <span className="max-w-full truncate text-caption text-fg-muted tnum">
          {p.quotes ? `${plural(p.quotes, "quote")} · ${plural(p.sources, "source")}` : "No customer words yet"}
          {p.against > 0 && <span className="text-warning"> · {p.against} against</span>}
        </span>
        {onThis ? (
          <a href={`${projectHref({ id: onThis.board, type: "discovery" })}?card=${encodeURIComponent(onThis.card)}`} className="truncate text-caption text-fg-muted hover:text-fg hover:underline">
            On {boardName(onThis.board)}
          </a>
        ) : (
          <button type="button" onClick={onWork} className={clsx(r.buttonSm, r.buttonSecondary)}>
            Work on it
          </button>
        )}
      </span>
      <Tip label="Not about this goal">
        <button type="button" aria-label="Not about this goal" onClick={onUnlink} className={clsx(r.iconButton, "opacity-0 group-hover/problem:opacity-100 focus-visible:opacity-100")}>
          <X {...ICON} />
        </button>
      </Tip>
    </li>
  );
}

/** The number: what it measures, where it started, where it is, where it's going and by when. Changing a target is a decision. */
function NumberBlock({ goal }: { goal: Goal }) {
  const m = goal.metric;
  const [draft, setDraft] = useState<OstMetric | null>(m ?? null);
  useEffect(() => setDraft(goal.metric ?? null), [goal.metric]);
  const progress = metricProgress(m);
  const save = (next: OstMetric) => {
    setDraft(next);
    void changeGoal(goal.id, { metric: next }).catch((e) => feedback(`Couldn't save the number: ${message(e)}`, { kind: "error", id: "goal.metric" }));
  };
  if (!draft)
    return (
      <section aria-label="Its number" className="flex flex-wrap items-center justify-between gap-[12px] rounded-lg bg-panel px-[14px] py-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
        <span className="text-body text-fg-muted">No number yet: what customer behaviour would show it moving?</span>
        <Button variant="secondary" size="sm" onClick={() => setDraft({ name: "", direction: "increase", baseline: null, current: null, target: null })}>
          Add its number
        </Button>
      </section>
    );
  const num = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const field = (label: string, value: string, commit: (v: string) => void, wide = false) => (
    <label className={clsx("flex min-w-0 flex-col gap-[4px]", wide && "col-span-2")}>
      <span className="text-micro text-fg-subtle">{label}</span>
      <span className={clsx(r.field, "h-[30px]")}>
        <input defaultValue={value} key={`${label}:${value}`} onBlur={(e) => e.target.value !== value && commit(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className={clsx(r.fieldInput, "text-body tnum")} />
      </span>
    </label>
  );
  return (
    <section aria-label="Its number" className="flex flex-col gap-[12px] rounded-lg bg-panel px-[14px] py-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex items-center justify-between gap-[12px]">
        <span className="flex items-center gap-[8px] text-body text-fg">
          {draft.name || "Its number"}
          {m && <span className="text-caption text-fg-muted tnum">{metricLine(m)}</span>}
        </span>
        {progress !== null && <Meter value={progress} label={`${Math.round(progress * 100)}% of the way to the target`} className="w-[140px]" />}
      </div>
      <div className="grid grid-cols-6 gap-[10px] max-[760px]:grid-cols-3">
        {field("What it measures", draft.name, (v) => save({ ...draft, name: v.trim() }), true)}
        {field("Unit", draft.unit ?? "", (v) => save({ ...draft, ...(v.trim() ? { unit: v.trim() } : { unit: undefined }) }))}
        {field("Started at", draft.baseline === null ? "" : String(draft.baseline), (v) => save({ ...draft, baseline: num(v) }))}
        {field("Now", draft.current === null ? "" : String(draft.current), (v) => save({ ...draft, current: num(v) }))}
        {field("Target", draft.target === null ? "" : String(draft.target), (v) => save({ ...draft, target: num(v) }))}
      </div>
      <div className="grid grid-cols-6 gap-[10px] max-[760px]:grid-cols-3">{field("By when", draft.timeframe ?? "", (v) => save({ ...draft, ...(v.trim() ? { timeframe: v.trim() } : { timeframe: undefined }) }), true)}</div>
      {m?.source?.label && <span className="text-micro text-fg-subtle">Now is read from {m.source.connector === "posthog" ? "PostHog" : m.source.connector}: {m.source.label}</span>}
    </section>
  );
}
