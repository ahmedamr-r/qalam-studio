import { useEffect, useState } from "react";
import clsx from "clsx";
import { ASSUMPTION_LABEL } from "@/discovery/kinds";
import type { SolutionDraft } from "@/discovery/solutions";
import { feedback } from "@/commands/feedback";
import { onOrgChange } from "@/org/live";
import { decideDraft, draftSolutions, solutionsOf, type SolutionsView } from "@/org/solutions";
import { projectHref } from "@/projects/model";
import { QalamAIGlyph } from "../brand";
import { Checkbox } from "../controls";
import { r } from "../recipes";
import { startBoardForNeed } from "./start-board";

/*
 * Solutions on a problem's page: "Draft solutions" has Qalam AI propose a few ways to solve it
 * (src/discovery/solutions.ts), each with what must be true for it to work and one test of the
 * riskiest. They're drafts until taken onto a board: the page's board reviews them under the
 * problem's card, or a new board starts with the ones picked. Left ones stay left.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function Drafts({ topic, board }: { topic: string; board: { board: string; card: string; name: string } | null }) {
  const [view, setView] = useState<SolutionsView | null | undefined>(undefined);
  const [working, setWorking] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  useEffect(() => {
    const load = () => void solutionsOf(topic).then(setView, () => setView(null));
    load();
    return onOrgChange((c) => c.kind === "solutions" && c.topic === topic && load());
  }, [topic]);

  const draft = async () => {
    setWorking("Reading what the problem rests on");
    try {
      const d = await draftSolutions({ topic }, setWorking);
      setPicked(null);
      setView(await solutionsOf(topic));
      if (!d.drafts.length) feedback(d.note || "Qalam AI found no way it could stand behind.", { id: "topic.solutions" });
    } catch (e) {
      feedback(`Qalam AI couldn't draft solutions: ${message(e)}`, { kind: "error", id: "topic.solutions" });
    } finally {
      setWorking(null);
    }
  };

  const open = view?.drafts.filter((d) => !view.decided[d.id]) ?? [];
  const chosen = picked ?? new Set(open.map((d) => d.id));
  const taken = open.filter((d) => chosen.has(d.id));
  const leave = (d: SolutionDraft) => void decideDraft(topic, d.id, "discarded").catch((e: unknown) => feedback(`Couldn't leave it: ${message(e)}`, { kind: "error", id: "topic.solutions" }));

  return (
    <section aria-labelledby="solutions" className="flex flex-col gap-[8px]">
      <div className="flex items-center justify-between gap-[12px]">
        <h2 id="solutions" className="text-title font-medium">
          Solutions
          {open.length > 0 && <span className="ml-[6px] text-caption font-normal text-fg-subtle">{open.length} drafted</span>}
        </h2>
        <button type="button" disabled={!!working} onClick={() => void draft()} className={clsx(r.buttonSm, r.buttonSecondary)}>
          <QalamAIGlyph size={12} />
          {working ? "Drafting…" : view?.drafts.length ? "Draft again" : "Draft solutions"}
        </button>
      </div>
      {working && (
        <p role="status" className="text-caption text-fg-muted">
          {working}…
        </p>
      )}
      {!working && view === null && <p className="text-caption text-fg-muted">Qalam AI proposes a few ways to solve it, each with what must be true for it to work and one test to find out this week.</p>}
      {view?.note && !working && <p className="text-caption text-fg-muted">{view.note}</p>}
      {open.length > 0 && (
        <ul className="flex flex-col gap-[8px]">
          {open.map((d) => (
            <li key={d.id} className="flex flex-col gap-[8px] rounded-lg bg-panel px-[14px] py-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
              <div className="flex items-start gap-[8px]">
                <span className="min-w-0 flex-1">
                  <Checkbox
                    checked={chosen.has(d.id)}
                    onChange={(on) => {
                      const next = new Set(chosen);
                      if (on) next.add(d.id);
                      else next.delete(d.id);
                      setPicked(next);
                    }}
                    label={<span className="text-body font-medium text-fg">{d.title}</span>}
                  />
                </span>
                <span className="shrink-0 text-micro text-fg-subtle">{d.idea ? "Your idea" : `${plural(d.cites.pieces.length, "quote")} behind it`}</span>
              </div>
              <p className="text-body text-fg-muted">{d.description}</p>
              <div className="flex flex-col gap-[4px]">
                <span className="text-micro text-fg-subtle">Must be true</span>
                {d.assumptions.map((a) => (
                  <span key={a.id} className="flex items-start gap-[8px] text-caption">
                    <span className="w-[84px] shrink-0 text-fg-subtle">{ASSUMPTION_LABEL[a.category]}</span>
                    <span className={clsx("min-w-0 flex-1", d.test?.assumption === a.id ? "text-fg" : "text-fg-muted")}>{a.text}</span>
                  </span>
                ))}
              </div>
              {d.test && (
                <div className="flex flex-col gap-[2px] rounded-md bg-app px-[10px] py-[8px] text-caption">
                  <span className="text-micro text-fg-subtle">First test</span>
                  <span className="font-medium text-fg">{d.test.what}</span>
                  <span className="text-fg-muted">{d.test.how}</span>
                  {d.test.suggested && <span className="text-fg-subtle">Qalam AI suggests it passes when {d.test.suggested.replace(/^\p{Lu}/u, (c) => c.toLowerCase()).replace(/[.\s]+$/, "")}. You set the bar.</span>}
                </div>
              )}
              <div className="flex justify-end">
                <button type="button" onClick={() => leave(d)} className={clsx(r.buttonSm, r.buttonGhost)}>
                  Leave it
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open.length > 0 && (
        <div className="flex items-center justify-end gap-[8px]">
          {board ? (
            <a href={`${projectHref({ id: board.board, type: "discovery" })}?solutions=${encodeURIComponent(topic)}`} className={clsx(r.buttonSm, r.buttonPrimary)}>
              Review them on {board.name}
            </a>
          ) : (
            <button
              type="button"
              disabled={!taken.length || working === "starting"}
              onClick={() => {
                setWorking("starting");
                void startBoardForNeed(topic, { drafts: taken, quotes: view?.quotes }).finally(() => setWorking(null));
              }}
              className={clsx(r.buttonSm, r.buttonPrimary)}
            >
              {taken.length ? `Start a board with ${plural(taken.length, "solution")}` : "Pick one to start a board"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
