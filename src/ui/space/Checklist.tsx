import { useEffect, useMemo } from "react";
import clsx from "clsx";
import { Check, ChevronDown, X } from "lucide-react";
import { isOstCard, visibleCards } from "@/doc/board";
import { studio, useStudio } from "@/doc/store";
import { sameTopic } from "@/hub/topics";
import { CHECKLIST, checklistRows, checklistStates, checklistTargets, type ChecklistCard, type ChecklistItem, type ChecklistRow } from "@/onboarding/checklist";
import { useSpaceInputs } from "@/space/session";
import { useSpaceView } from "@/space/view";
import { useWide } from "../chat/Panels";
import { IconBtn } from "../controls";
import { useBriefs } from "../discovery/briefs";
import { useBusy } from "../discovery/busy";
import { glideToLayer, onCanvasReady } from "../discovery/canvas";
import { useDump } from "../discovery/dump";
import { useReview } from "../discovery/review";
import { useSources } from "../discovery/sources";
import { toggleChat } from "../frame/store";
import { useHealth } from "../frame/useHealth";
import { briefFor, focusWith, goalForProblem, goalWith, useCanvasChat } from "./chat/store";
import { closeChecklist, foldChecklist, tickChecklist, useChecklist } from "./checklist-state";
import { tourSeen, useTour } from "./tour-state";

/*
 * What to try first on a canvas, in its corner once the walkthrough is over: finding a goal for a
 * problem, finding problems for a goal, writing a PRD. Each row runs what the card's next steps run,
 * in the chat, on the card picked or the likeliest one, and ticks once it's really happened
 * (src/onboarding/checklist.ts).
 */

const WIDE = 900;
const ICON = { size: 13, absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;

/** The canvas's cards as the rows need them. */
function useCards(): ChecklistCard[] {
  const doc = useStudio((s) => s.doc);
  const things = useSpaceView((s) => s.things);
  const needs = useSpaceInputs((s) => s.inputs?.needs);
  const briefs = useBriefs((s) => s.list);
  return useMemo(() => {
    const out: ChecklistCard[] = [];
    for (const id of doc.roots.flatMap((r) => visibleCards(doc, r))) {
      const n = doc.nodes[id];
      if (!isOstCard(n)) continue;
      const card = n.meta.ost;
      const thing = things.get(id);
      const page = thing?.type === "problem" ? thing.topic : card.kind === "opportunity" ? (needs?.find((x) => x.boards.some((b) => b.card === id)) ?? needs?.find((x) => sameTopic(x.title, card.title)))?.topic : undefined;
      let underGoal = false;
      for (let p = n.parentId; p && !underGoal; p = doc.nodes[p]?.parentId ?? null) {
        const above = doc.nodes[p];
        underGoal = isOstCard(above) && above.meta.ost.kind === "outcome";
      }
      out.push({
        id,
        kind: card.kind,
        title: card.title,
        faint: thing?.type === "problem",
        ...(page ? { topic: page } : {}),
        ...(thing?.type === "goal" ? { goal: thing.goal } : {}),
        underGoal,
        problems: n.children.filter((k) => {
          const c = doc.nodes[k];
          return isOstCard(c) && c.meta.ost.kind === "opportunity";
        }).length,
        brief: briefs.some((b) => b.card === id),
      });
    }
    return out;
  }, [doc, things, needs, briefs]);
}

/** Why Qalam AI can't start something now, in the card's next steps' words. */
function useBlocked(): string | null {
  const { rows } = useHealth();
  const reviewing = useReview((s) => s.proposals.length > 0);
  const busy = useBusy((s) => !!s.busy);
  const dumping = useDump((s) => !!s.busy);
  if (rows?.some((r) => r.id === "engine")) return "Qalam AI isn't ready here";
  if (reviewing) return "Accept or discard the proposals first";
  if (busy || dumping) return "Qalam AI is on something else";
  return null;
}

function pick(id: string) {
  studio().select([id]);
  onCanvasReady((c) => glideToLayer(c, id));
}

async function run(item: ChecklistItem, card: ChecklistCard) {
  if (item === "goal") {
    if (card.faint && card.topic) return goalForProblem(card.topic);
    pick(card.id);
    return goalWith(card.id, card.topic);
  }
  if (item === "problems") {
    pick(card.id);
    return focusWith(card.id, card.goal!);
  }
  const id = card.faint && card.topic ? await import("./SpacePanel").then((m) => m.workOnNeed(card.topic!)) : card.id;
  if (!id) return;
  pick(id);
  briefFor(id);
}

export function CanvasChecklist() {
  const closed = useChecklist((s) => s.closed);
  const folded = useChecklist((s) => s.folded);
  const done = useChecklist((s) => s.done);
  const touring = useTour((s) => s.open);
  const hasCards = useStudio((s) => s.doc.roots.length > 0);
  const picked = useStudio((s) => (s.selection.length === 1 ? s.selection[0] : null));
  const loaded = useCanvasChat((s) => s.loaded);
  const turns = useCanvasChat((s) => s.chat.turns);
  const sources = useSources((s) => s.list);
  const wide = useWide(WIDE);
  const cards = useCards();
  const blocked = useBlocked();

  const states = useMemo(
    () =>
      checklistStates(turns, (id) => {
        const d = sources.find((s) => s.id === id)?.dump;
        return { phase: d?.phase, added: d?.placed?.counts.added ?? 0 };
      }),
    [turns, sources],
  );
  // Kept once it's happened: a new chat clears the turns, not what they've tried.
  useEffect(() => tickChecklist(CHECKLIST.filter((i) => states[i] === "done")), [states]);

  if (closed || touring || !tourSeen() || !hasCards || !loaded || !wide) return null;

  const targets = checklistTargets(cards, picked);
  const rows = checklistRows({ targets, states, done, blocked, anyProblem: cards.some((c) => c.kind === "opportunity") });
  const count = rows.filter((r) => r.state === "done").length;
  const press = (r: ChecklistRow) => {
    if (r.state === "going") return toggleChat(true);
    const card = targets[r.item];
    if (card) void run(r.item, card);
  };

  if (folded)
    return (
      <button type="button" onClick={() => foldChecklist(false)} className="q-item absolute right-[12px] bottom-[12px] z-[8] @max-[620px]:bottom-[48px] flex h-[28px] items-center gap-[6px] rounded-lg bg-raised px-[10px] text-caption text-fg-muted shadow-floating hover:text-fg">
        Get started
        <span className="tnum text-fg-subtle">
          {count}/{rows.length}
        </span>
      </button>
    );

  return (
    <section aria-labelledby="checklist-title" className="q-fade absolute right-[12px] bottom-[12px] z-[8] @max-[800px]:bottom-[48px] flex w-[296px] max-w-[calc(100%-24px)] flex-col rounded-lg bg-raised p-[4px] shadow-floating">
      <div className="flex items-center gap-[6px] py-[2px] pr-[2px] pl-[8px]">
        <h2 id="checklist-title" className="text-caption font-medium text-fg">
          {count === rows.length ? "All done" : "Get started"}
        </h2>
        <span className="tnum flex-1 text-caption text-fg-subtle">
          {count}/{rows.length}
        </span>
        <IconBtn size="sm" label="Fold" onClick={() => foldChecklist(true)}>
          <ChevronDown {...ICON} />
        </IconBtn>
        <IconBtn size="sm" label="Close. ⌘K brings it back" onClick={closeChecklist}>
          <X {...ICON} />
        </IconBtn>
      </div>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.item}>
            <button type="button" disabled={!r.can} onClick={() => press(r)} className={clsx("flex w-full items-start gap-[8px] rounded-md px-[8px] py-[6px] text-left", r.can && "q-item hover:bg-hover")}>
              <span aria-hidden className={clsx("mt-[2px] grid size-[14px] shrink-0 place-items-center rounded-full", r.state === "done" ? "bg-selection-subtle text-selection-label" : "border border-line")}>
                {r.state === "done" && <Check {...ICON} size={10} />}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className={clsx("text-caption", r.state === "done" ? "text-fg-subtle" : r.can ? "text-fg" : "text-fg-muted")}>
                  {r.state === "done" && <span className="sr-only">Done: </span>}
                  {r.label}
                </span>
                {r.hint && <span className="truncate text-caption text-fg-subtle">{r.hint}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
