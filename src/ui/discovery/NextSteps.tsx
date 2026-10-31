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
import { strengthOf } from "@/hub/needs";
import { sameTopic } from "@/hub/topics";
import { useSpaceInputs } from "@/space/session";
import { useSpaceView } from "@/space/view";
import { placeCard, toScreenBox } from "../ai/anchor";
import { QalamAIGlyph } from "../brand";
import { Button, CommandKbd, IconBtn, Spinner } from "../controls";
import { useHealth } from "../frame/useHealth";
import { useJobs } from "../goals/useJobs";
import { stopBusy, useBusy, type Busy } from "./busy";
import { useDump } from "./dump";
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
const FOLDED_W = 76;
/** The card bar's height and gap over a card (./CardBar.tsx). */
const BAR = 46;
const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

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
  return useMemo(() => {
    if (!id || !isOstCard(node)) return null;
    const card = node.meta.ost;
    const kids = node.children.flatMap((k) => (isOstCard(doc.nodes[k]) ? [doc.nodes[k].meta.ost.kind] : []));
    const needs = inputs?.needs ?? [];
    const need = card.kind === "opportunity" ? (needs.find((n) => n.boards.some((b) => b.card === id)) ?? needs.find((n) => sameTopic(n.title, card.title))) : undefined;
    const goal = thing?.type === "goal" && inputs ? goalById(inputs.tree, thing.goal) : undefined;
    return {
      kind: card.kind,
      evidence: evidenceSummary(card),
      page: need ? { topic: need.topic, strength: strengthOf(need), quotes: need.quotes, sources: need.sources } : null,
      under: { solutions: kids.filter((k) => k === "solution").length, tests: kids.filter((k) => k === "test").length },
      ...(goal && inputs
        ? {
            goal: {
              id: goal.id,
              number: (goal.metric && metricLine(goal.metric)) || null,
              behind: rankForGoal(goal.id, { tree: inputs.tree, links: [...inputs.links], needs: [...needs] }).length,
              job: jobs?.find((j) => j.goal === goal.id)?.title ?? null,
            },
          }
        : {}),
      suggested: card.kind === "test" && !!card.test?.suggested && !card.test.criterion,
      ai: !rows?.some((r) => r.id === "engine"),
      reviewing,
      busyElsewhere: !!busy && busy.card !== id,
    };
  }, [id, node, doc, inputs, thing, busy, reviewing, rows, jobs]);
}

export default function NextSteps({ vp }: { vp: { w: number; h: number } }) {
  const sel = useStudio((s) => (s.selection.length === 1 ? s.selection[0] : null));
  const node = useStudio((s) => (sel ? s.doc.nodes[sel] : undefined));
  const cam = useStudio((s) => s.camera);
  const tool = useStudio((s) => s.tool);
  const editing = useDiscovery((s) => s.editing);
  const dragging = useDiscovery((s) => s.dragging);
  const designFor = useDiscovery((s) => s.designFor);
  const dump = useDump((s) => !!s.open && !s.minimised);
  const reviewing = useReview((s) => s.proposals.length > 0);
  // A problem's page not on a board yet keeps the card bar's "Work on it".
  const faint = useSpaceView((s) => !!sel && s.faint.has(sel));
  const facts = useCardFacts(sel);
  const busy = useBusy((s) => s.busy);
  const folded = useNextSteps((s) => s.folded);
  const [more, setMore] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(120);
  const inset = useDiscovery((s) => s.inset);
  // The canvas it can sit on: less a panel lying over its right side.
  const room = { w: Math.max(0, vp.w - inset), h: vp.h };
  const show = !!sel && isOstCard(node) && !!facts && !editing && !dragging && !designFor && !dump && !reviewing && !faint && tool === "select";
  const world = show ? worldBounds(studio().doc, sel) : null;
  const box = world && toScreenBox(world, cam);
  const onScreen = !!box && box.x + box.w >= 0 && box.x <= room.w && box.y + box.h >= 0 && box.y <= room.h;
  const mine = sel && busy?.card === sel ? busy : null;
  const steps = show && facts ? nextSteps(facts) : [];
  // ⌘↵ runs the step drawn first.
  const first = onScreen && !folded && !mine && steps[0] && !steps[0].blocked ? steps[0] : null;
  useEffect(() => {
    useNextSteps.setState({ first: first && sel && facts ? { card: sel, run: () => void runStep(sel, first, facts) } : null });
  }, [first, sel, facts]);
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
  const at = beside(box, world, cam, room, { w: folded ? FOLDED_W : W, h: folded ? 28 : h });
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
    <div ref={ref} role="group" aria-label="Next steps" className="pointer-events-auto absolute flex flex-col gap-[2px] rounded-lg bg-elevated p-[4px] shadow-popover q-fade" style={{ left: at.left, top: at.top, width: W }} onPointerDown={stop}>
      <div className="flex min-h-[28px] items-center gap-[6px] pr-[2px] pl-[8px]">
        <span className="min-w-0 flex-1 text-caption text-fg-muted" dir="auto">
          {line || "Next"}
        </span>
        <IconBtn size="sm" label="Fold the next steps" onClick={() => foldNextSteps(true)}>
          <X {...ICON} />
        </IconBtn>
      </div>
      {mine ? (
        <Running busy={mine} />
      ) : (
        <>
          {shown.map((s, i) => (
            <StepRow key={s.id} step={s} main={i === 0} onRun={() => void runStep(sel, s, facts)} />
          ))}
          {rest > 0 && (
            <button type="button" aria-expanded={more} className="q-item flex h-[26px] items-center gap-[4px] rounded-md px-[8px] text-caption text-fg-muted hover:bg-hover hover:text-fg" onClick={() => setMore(!more)}>
              {more ? "Fewer" : `More (${rest})`}
              <ChevronDown size={12} absoluteStrokeWidth strokeWidth={1.25} className={clsx("q-chevron text-fg-subtle", more && "rotate-180")} />
            </button>
          )}
        </>
      )}
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
