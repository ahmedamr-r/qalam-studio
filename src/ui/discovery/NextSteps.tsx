import { useBriefs } from "./briefs";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowRight, ChevronDown, X } from "lucide-react";
import { isOstCard } from "@/doc/board";
import { worldBounds, type Box } from "@/doc/geometry";
import { studio, useStudio, type Camera } from "@/doc/store";
import { evidenceSummary } from "@/discovery/evidence";
import { backingLine, nextSteps, SHOWN, type CardFacts, type NextStep } from "@/discovery/next";
import { metricLine } from "@/goals/goals-md";
import { rankForGoal } from "@/goals/problems";
import { goalById } from "@/goals/tree";
import { GOAL_LEVERS, LEVER_LABEL, type GoalLever } from "@/goals/types";
import { goalWork } from "@/org/goal-work";
import { strengthOf } from "@/hub/needs";
import { sameTopic } from "@/hub/topics";
import { isProblemPage } from "@/space/compose";
import { useSpaceInputs } from "@/space/session";
import { boardOfCard, useSpaceView } from "@/space/view";
import type { FeedView } from "@/org/feeds";
import { lab } from "@/lab";
import { placeCard, toScreenBox } from "../ai/anchor";
import { QalamAIGlyph } from "../brand";
import { Button, CommandKbd, IconBtn, Select, Spinner } from "../controls";
import { useHealth } from "../frame/useHealth";
import { useJobs } from "../goals/useJobs";
import { r } from "../recipes";
import { OPEN_ID } from "@/discovery/questions";
import { toQuestion } from "../ai/plan";
import { Questionnaire } from "../ai/Questionnaire";
import { answerRound, cancelAsk, changeRound, draftNow, skipQuestions, startAsk, useAsk, type Ask } from "./ask";
import { stopBusy, useBusy, type Busy, type Done } from "./busy";
import { SPACE, addFeed, checkFeed, refreshFeed, useFeeds, wiredCards, type FeedNews } from "./feeds";
import { ACCEPT } from "./ingest";
import { useSources } from "./sources";
import { useTools, type Tool } from "./tools";
import { foldNextSteps, runStep, useNextSteps } from "./next";
import { useReview } from "./review";
import { useDiscovery } from "./store";

/*
 * Beside the picked card, what to do next with it: one line on what it rests on, then the steps
 * that fit, best first (src/discovery/next.ts; showing them costs nothing, Qalam AI runs only
 * when one is picked). While Qalam AI works on the card it says what it's doing, with Stop. Folds
 * to a small "Next" for this tab.
 */

const W = 300;
const ASK_W = 360;
const FOLDED_W = 76;
/** The card bar's height and gap over a card (./CardBar.tsx). */
const BAR = 46;
const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/** What was proposed for a goal and waits to be decided: goals under it, problems behind it (its work file, asked again when a review or a step ends). */
function usePending(goal: string | null): { parts: number; problems: number } {
  const [n, setN] = useState<{ goal: string; parts: number; problems: number } | null>(null);
  const reviewing = useReview((s) => s.proposals.length > 0);
  const busy = useBusy((s) => !!s.busy);
  useEffect(() => {
    // A goal's extras are hidden in v0.1 (src/lab.ts): nothing is proposed for it, so nothing waits.
    if (!goal || reviewing || busy || !lab("goals")) return;
    let alive = true;
    const open = (x: { decided: Record<string, unknown> } | undefined, ids: { id: string }[] = []) => (x ? ids.filter((p) => !x.decided[p.id]).length : 0);
    void goalWork(goal).then(
      (w) => alive && setN({ goal, parts: open(w.breakdown, w.breakdown?.parts), problems: open(w.problems, w.problems?.drafts) }),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [goal, reviewing, busy]);
  return n?.goal === goal ? n : { parts: 0, problems: 0 };
}

/** What's known about the picked card, from what the canvas has loaded. */
export function useCardFacts(id: string | null): CardFacts | null {
  const node = useStudio((s) => (id ? s.doc.nodes[id] : undefined));
  const doc = useStudio((s) => s.doc);
  const inputs = useSpaceInputs((s) => s.inputs);
  const thing = useSpaceView((s) => (id ? s.things.get(id) : undefined));
  const busy = useBusy((s) => s.busy);
  const reviewing = useReview((s) => s.proposals.length > 0);
  const { rows } = useHealth();
  const jobs = useJobs();
  const pending = usePending(thing?.type === "goal" ? thing.goal : null);
  const tools = useTools();
  const material = useSources((s) => s.list.some((x) => x.quotes.length > 0));
  // Answers drafted with count as what it rests on; answers left half-way are picked up by its draft.
  const asked = useSources((s) => (!id ? null : s.list.some((x) => x.answers?.card === id && x.answers.done) ? "done" : s.list.some((x) => x.answers?.card === id) ? "half" : null));
  const feeds = useFeeds((s) => s.list);
  const brief = useBriefs((s) => (id ? s.list.find((b) => b.card === id)?.id : undefined));
  return useMemo(() => {
    if (!id || !isOstCard(node)) return null;
    const card = node.meta.ost;
    const kids = node.children.flatMap((k) => (isOstCard(doc.nodes[k]) ? [doc.nodes[k].meta.ost.kind] : []));
    const needs = inputs?.needs ?? [];
    const need = card.kind === "opportunity" ? (needs.find((n) => n.boards.some((b) => b.card === id)) ?? needs.find((n) => sameTopic(n.title, card.title))) : undefined;
    const goal = thing?.type === "goal" && inputs ? goalById(inputs.tree, thing.goal) : undefined;
    return {
      kind: card.kind,
      ...(brief ? { brief } : {}),
      evidence: evidenceSummary(card),
      page: need ? { topic: need.topic, strength: strengthOf(need), quotes: need.quotes, sources: need.sources, mix: need.mix } : null,
      under: { solutions: kids.filter((k) => k === "solution").length, tests: kids.filter((k) => k === "test").length },
      underGoal: hasGoalAbove(doc, id),
      ...(goal && inputs
        ? {
            goal: {
              id: goal.id,
              number: (goal.metric && metricLine(goal.metric)) || null,
              // The problems on its board under it, and the pages linked to it that no board has.
              behind: node.children.filter((k) => !isProblemPage(k) && isOstCard(doc.nodes[k]) && doc.nodes[k].meta.ost.kind === "opportunity").length + rankForGoal(goal.id, { tree: inputs.tree, links: [...inputs.links], needs: [...needs] }).filter((p) => !p.onBoard).length,
              job: jobs?.find((j) => j.goal === goal.id)?.title ?? null,
              pending: pending.parts,
              drafted: pending.problems,
            },
          }
        : {}),
      pages: needs.length,
      search: !rows?.some((r) => r.id === "search"),
      material,
      tools: tools?.map((t) => t.label) ?? null,
      feeds: [...new Set(watching(feeds, id).map((f) => f.label))],
      answered: asked === "done" || card.evidence.some((e) => e.answerId?.startsWith("ask:")),
      asking: asked === "half",
      suggested: card.kind === "test" && !!card.test?.suggested && !card.test.criterion,
      ai: !rows?.some((r) => r.id === "engine"),
      reviewing,
      busyElsewhere: !!busy && busy.card !== id,
    };
  }, [id, node, doc, inputs, thing, busy, reviewing, rows, jobs, pending, tools, material, feeds, asked]);
}

/** Whether a goal is above a card on the canvas. */
function hasGoalAbove(doc: ReturnType<typeof studio>["doc"], id: string): boolean {
  for (let p = doc.nodes[id]?.parentId; p; p = doc.nodes[p]?.parentId ?? null) {
    const n = doc.nodes[p];
    if (isOstCard(n) && n.meta.ost.kind === "outcome") return true;
  }
  return false;
}

/** The feeds watching for a card, on. */
const watching = (feeds: FeedView[], card: string) => feeds.filter((f) => f.status === "on" && wiredCards(f, useFeeds.getState().board ?? SPACE).includes(card));

export default function NextSteps({ vp }: { vp: { w: number; h: number } }) {
  const sel = useStudio((s) => (s.selection.length === 1 ? s.selection[0] : null));
  const node = useStudio((s) => (sel ? s.doc.nodes[sel] : undefined));
  const cam = useStudio((s) => s.camera);
  const tool = useStudio((s) => s.tool);
  const editing = useDiscovery((s) => s.editing);
  const dragging = useDiscovery((s) => s.dragging);
  const designFor = useDiscovery((s) => s.designFor);
  const reviewing = useReview((s) => s.proposals.length > 0);
  // A problem's page not on a board yet keeps the card bar's "Work on it".
  const faint = useSpaceView((s) => !!sel && s.faint.has(sel));
  const facts = useCardFacts(sel);
  const busy = useBusy((s) => s.busy);
  const done = useBusy((s) => (sel && s.done?.card === sel ? s.done : null));
  const folded = useNextSteps((s) => s.folded);
  const [more, setMore] = useState(false);
  // Break it down asks which levers to look at first; watching a tool, which and what for.
  const [asking, setAsking] = useState<{ card: string; what: "levers" | "watch" } | null>(null);
  const files = useRef<HTMLInputElement>(null);
  const tools = useTools();
  const feeds = useFeeds((s) => s.list);
  const news = useFeeds((s) => s.news);
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(120);
  const inset = useDiscovery((s) => s.inset);
  // The canvas it can sit on: less a panel lying over its right side.
  const room = { w: Math.max(0, vp.w - inset), h: vp.h };
  const show = !!sel && isOstCard(node) && !!facts && !editing && !dragging && !designFor && !reviewing && !faint && tool === "select";
  const world = show ? worldBounds(studio().doc, sel) : null;
  const box = world && toScreenBox(world, cam);
  const onScreen = !!box && box.x + box.w >= 0 && box.x <= room.w && box.y + box.h >= 0 && box.y <= room.h;
  const mine = sel && busy?.card === sel ? busy : null;
  const steps = show && facts ? nextSteps(facts) : [];
  const asked = asking?.card === sel ? asking.what : null;
  const ask = useAsk((s) => (sel && s.ask?.card === sel ? s.ask : null));
  const pick = (s: NextStep) => {
    if (!sel || !facts) return;
    if (s.id === "break-down") return setAsking({ card: sel, what: "levers" });
    if (s.id === "watch") return setAsking({ card: sel, what: "watch" });
    if (s.id === "add-file") return files.current?.click();
    // Nothing behind it yet: a few questions, then the draft.
    if (s.id === "questions" || (s.asks && s.id === "draft-solutions")) return startAsk(sel, "draft-solutions");
    if (s.asks && s.id === "draft-problems") return startAsk(sel, "draft-problems");
    void runStep(sel, s, facts);
  };
  // ⌘↵ runs the step drawn first.
  const first = onScreen && !folded && !mine && !asked && !ask && steps[0] && !steps[0].blocked ? steps[0] : null;
  useEffect(() => {
    useNextSteps.setState({ first: first && sel ? { card: sel, run: () => pick(first) } : null });
  });
  useEffect(() => () => useNextSteps.setState({ first: null }), []);
  useEffect(() => setMore(false), [sel]);
  // Placed by its height, measured once drawn.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && Math.abs(el.offsetHeight - h) > 1) setH(el.offsetHeight);
  });
  if (!sel || !facts || !world || !onScreen) return null;
  const line = backingLine(facts);
  if (!steps.length && !line && !mine) return null;
  // Wider while it asks (the questions' options sit two to a row).
  const width = ask ? ASK_W : W;
  const at = beside(box, world, cam, room, { w: folded ? FOLDED_W : width, h: folded ? 28 : h });
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  if (folded)
    return (
      <button type="button" className="pointer-events-auto absolute flex h-[28px] items-center gap-[6px] rounded-lg bg-elevated px-[10px] text-caption font-medium text-fg shadow-popover q-fade" style={{ left: at.left, top: at.top }} onPointerDown={stop} onClick={() => foldNextSteps(false)}>
        {mine ? <Spinner size={12} /> : <QalamAIGlyph size={12} />}
        Next
      </button>
    );
  const shown = more ? steps : steps.slice(0, SHOWN);
  const rest = steps.length - SHOWN;
  return (
    <div ref={ref} role="group" aria-label="Next steps" className="pointer-events-auto absolute flex flex-col gap-[2px] rounded-lg bg-elevated p-[4px] shadow-popover q-fade" style={{ left: at.left, top: at.top, width }} onPointerDown={stop}>
      <div className="flex min-h-[28px] items-center gap-[6px] pr-[2px] pl-[8px]">
        <span className="min-w-0 flex-1 text-caption text-fg-muted" dir="auto">
          {line || "Next"}
        </span>
        <IconBtn size="sm" label="Fold the next steps" onClick={() => foldNextSteps(true)}>
          <X {...ICON} />
        </IconBtn>
      </div>
      {done && !mine && <DoneLine done={done} />}
      {mine ? (
        <Running busy={mine} />
      ) : ask ? (
        <Asking ask={ask} />
      ) : asked === "levers" && facts.goal ? (
        <Levers
          onCancel={() => setAsking(null)}
          onGo={(levers) => {
            setAsking(null);
            const s = steps.find((x) => x.id === "break-down");
            // Nothing behind it yet: a few questions, then it's broken down with the levers picked.
            if (s?.asks) startAsk(sel, "break-down", levers);
            else if (s) void runStep(sel, s, facts, { levers });
          }}
        />
      ) : asked === "watch" && tools?.length ? (
        <WatchForm
          tools={tools}
          query={(isOstCard(node) && node.meta.ost.title) || ""}
          goalNoBoard={facts.kind === "outcome" && !boardOfCard(sel)}
          onCancel={() => setAsking(null)}
          onWatch={async (tool, query) => {
            if (await addFeed(tool, query, { card: sel })) setAsking(null);
          }}
        />
      ) : (
        <>
          {shown.map((s, i) => (
            <StepRow key={s.id} step={s} main={i === 0} onRun={() => pick(s)} />
          ))}
          {rest > 0 && (
            <button type="button" aria-expanded={more} className="q-item flex h-[26px] items-center gap-[4px] rounded-md px-[8px] text-caption text-fg-muted hover:bg-hover hover:text-fg" onClick={() => setMore(!more)}>
              {more ? "Fewer" : `More (${rest})`}
              <ChevronDown size={12} absoluteStrokeWidth strokeWidth={1.25} className={clsx("q-chevron text-fg-subtle", more && "rotate-180")} />
            </button>
          )}
          {watching(feeds, sel).map((f) => (
            <FeedLine key={f.id} feed={f} news={news[f.id]} />
          ))}
        </>
      )}
      <input
        ref={files}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])];
          e.target.value = "";
          // Read in the chat, against the card (what customers said as their quotes, mapped under it).
          if (picked.length) void import("../space/chat/store").then((m) => m.fileFor(sel, picked));
        }}
      />
    </div>
  );
}

/** Watching a tool for the card: which tool, and the words to look for there (the card's, to start). */
function WatchForm({ tools, query, goalNoBoard, onWatch, onCancel }: { tools: Tool[]; query: string; goalNoBoard: boolean; onWatch: (tool: string, query: string) => Promise<void>; onCancel: () => void }) {
  const [tool, setTool] = useState(tools[0].id);
  const [words, setWords] = useState(query.slice(0, 120));
  const [saving, setSaving] = useState(false);
  return (
    <div className="flex flex-col gap-[8px] px-[8px] pt-[2px] pb-[6px]">
      <span className="text-caption text-fg">What to look for there. What's new is counted; nothing is read until you bring it in.</span>
      {tools.length > 1 && <Select ariaLabel="Tool to watch" value={tool} options={tools.map((t) => ({ value: t.id, label: t.label }))} onChange={setTool} />}
      <label className={r.field}>
        <input className={r.fieldInput} aria-label="What to look for" value={words} onChange={(e) => setWords(e.target.value)} />
      </label>
      {goalNoBoard && <span className="text-micro text-fg-subtle">What comes in is filed and linked to this goal; it's placed once the goal has a board.</span>}
      <div className="flex items-center gap-[6px]">
        <Button
          size="sm"
          disabled={saving || words.trim().length < 2}
          onClick={() => {
            setSaving(true);
            void onWatch(tool, words.trim()).finally(() => setSaving(false));
          }}
        >
          {saving ? "Keeping it…" : `Watch ${tools.find((t) => t.id === tool)?.label ?? "it"}`}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** A tool watched for the card: what's new there, and bringing it in (placed only under what it watches). */
function FeedLine({ feed, news }: { feed: FeedView; news?: FeedNews }) {
  const fresh = news?.fresh ?? 0;
  return (
    <div className="flex min-h-[28px] items-center gap-[6px] border-t border-line-subtle px-[8px] pt-[4px] text-caption text-fg-muted">
      <span className="min-w-0 flex-1 truncate" dir="auto">
        {news?.activity ? <span className="q-shimmer-text">{news.activity}</span> : `${feed.label}: “${feed.query}” · ${news?.checking ? "looking…" : news?.error ? "couldn't look" : fresh ? `${fresh} new` : "nothing new"}`}
      </span>
      {!news?.activity && (fresh > 0 ? (
        <Button size="sm" variant="secondary" onClick={() => void refreshFeed(feed.id)}>
          Bring in
        </Button>
      ) : (
        <Button size="sm" variant="ghost" disabled={!!news?.checking} onClick={() => void checkFeed(feed.id)}>
          Check
        </Button>
      ))}
    </div>
  );
}

/** Beside the card (right, else left); with no room on either side, under it, else over its bar; else wherever it fits. */
function beside(s: Box, world: Box, cam: Camera, room: { w: number; h: number }, size: { w: number; h: number }) {
  const gap = 16;
  const m = 8;
  if (s.x + s.w + gap + size.w <= room.w - m || s.x - gap - size.w >= m) return placeCard(world, cam, room, size, gap, m);
  const left = Math.max(m, Math.min(s.x, room.w - size.w - m));
  if (s.y + s.h + gap + size.h <= room.h - m) return { left, top: s.y + s.h + gap };
  // The card bar sits over the card.
  if (s.y - BAR - gap - size.h >= m) return { left, top: s.y - BAR - gap - size.h };
  return placeCard(world, cam, room, size, gap, m);
}

function StepRow({ step, main, onRun }: { step: NextStep; main: boolean; onRun: () => void }) {
  const sub = step.blocked ?? step.hint;
  return (
    <button
      type="button"
      disabled={!!step.blocked}
      className={clsx("q-item flex min-h-[36px] w-full items-center gap-[8px] rounded-md px-[8px] py-[4px] text-left disabled:cursor-not-allowed disabled:opacity-60", main ? "bg-raised shadow-button hover:bg-elevated" : "hover:bg-hover")}
      onClick={onRun}
    >
      <span className="grid size-[16px] shrink-0 place-items-center text-fg-subtle">{step.ai ? <QalamAIGlyph size={12} /> : <ArrowRight {...ICON} size={12} />}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-medium text-fg" dir="auto">
          {step.label}
        </span>
        {sub && <span className="truncate text-micro text-fg-subtle">{sub}</span>}
      </span>
      {main && !step.blocked && <CommandKbd command="discovery.next-step" size="sm" />}
    </button>
  );
}

/** The questions before the card's draft: theirs, then Qalam AI's, with what was found on their words. */
function Asking({ ask }: { ask: Ask }) {
  const round = ask.rounds[ask.rounds.length - 1];
  const found = [ask.found.length ? `Found ${ask.found.length === 1 ? "1 quote" : `${ask.found.length} quotes`} on it` : ask.phase !== "open" ? "Nothing in your project on it yet" : "", ask.online?.running ? "looking online…" : (ask.online?.note ?? "")].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-[6px] pb-[2px]">
      {found && <span className="px-[8px] text-caption text-fg-muted">{found}</span>}
      {ask.phase === "waiting" ? (
        <div role="status" className="flex items-center gap-[8px] py-[4px] pr-[4px] pl-[8px]">
          <Spinner size={12} />
          <span className="q-shimmer-text min-w-0 flex-1 text-caption text-fg">Looking online for what people say about it</span>
          <Button size="sm" variant="secondary" onClick={draftNow}>
            Draft now
          </Button>
          <Button size="sm" variant="ghost" onClick={cancelAsk}>
            Cancel
          </Button>
        </div>
      ) : (
        <>
          <Questionnaire questions={round.questions.map(toQuestion).map((q) => (q.id === OPEN_ID ? { ...q, source: "studio" as const } : q))} state={round.form} onChange={changeRound} onSubmit={(s) => void answerRound(s)} title={ask.rounds.length === 1 ? "Before Qalam AI drafts" : "A few more"} />
          <div className="flex items-center justify-between px-[4px]">
            <button type="button" className={r.buttonGhost + " h-[24px] rounded-md px-[6px] text-caption"} onClick={() => void skipQuestions()}>
              Skip the questions
            </button>
            <button type="button" className={r.buttonGhost + " h-[24px] rounded-md px-[6px] text-caption"} onClick={cancelAsk}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Break it down's question: which levers to look at (none picked: Qalam AI chooses). */
function Levers({ onGo, onCancel }: { onGo: (levers: GoalLever[]) => void; onCancel: () => void }) {
  const [levers, setLevers] = useState<GoalLever[]>([]);
  return (
    <div className="flex flex-col gap-[8px] px-[8px] pt-[2px] pb-[6px]">
      <span className="text-caption text-fg">Which levers should it look at? Leave them all off and Qalam AI picks.</span>
      <div className="flex flex-wrap gap-[4px]" role="group" aria-label="Levers">
        {GOAL_LEVERS.map((l) => {
          const on = levers.includes(l);
          return (
            <button key={l} type="button" aria-pressed={on} onClick={() => setLevers(on ? levers.filter((x) => x !== l) : [...levers, l])} className={clsx(r.buttonSm, on ? r.buttonSecondary : r.buttonGhost, on && "shadow-[inset_0_0_0_1px_var(--color-line-strong)]")}>
              {LEVER_LABEL[l]}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-[6px]">
        <Button size="sm" onClick={() => onGo(levers)}>
          <QalamAIGlyph size={12} /> Propose goals under it
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** What the last step for this card came to, when it isn't on the canvas. */
function DoneLine({ done }: { done: Done }) {
  return (
    <div role="status" className="flex flex-col gap-[4px] px-[8px] pb-[4px] text-caption text-fg-muted" dir="auto">
      <span>{done.text}</span>
      {done.claims?.map((c) => (
        <a key={c.url + c.what} href={c.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-baseline gap-[6px] hover:text-fg">
          <span className="shrink-0 font-medium text-fg tnum">{c.value}</span>
          <span className="truncate">
            {c.what} · {c.who}
          </span>
        </a>
      ))}
    </div>
  );
}

/** What Qalam AI is doing for the card now, how long it's been, and Stop. */
function Running({ busy }: { busy: Busy }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - busy.started) / 1000));
  return (
    <div role="status" className="flex items-center gap-[8px] py-[6px] pr-[4px] pl-[8px]">
      <Spinner size={12} />
      <span className="q-shimmer-text min-w-0 flex-1 text-caption text-fg" dir="auto">
        {busy.label}
      </span>
      <span className="text-micro text-fg-subtle tnum">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</span>
      <Button size="sm" variant="secondary" onClick={stopBusy}>
        Stop
      </Button>
    </div>
  );
}
