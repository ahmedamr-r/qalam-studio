import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { create } from "zustand";
import { AIError, callAI } from "@/ai/client";
import { feedback } from "@/commands/feedback";
import { studio, useStudio } from "@/doc/store";
import { compareMaterial, compareUnder, RATING_KEYS, RATING_LABEL, RATING_STEPS, sanitizeCompare, type CompareAdvice, type Compared, type RatingKey } from "@/discovery/compare";
import { stageLabel } from "@/discovery/kinds";
import { cardOf, setTargetIn, updateCardIn } from "@/discovery/ops";
import type { OstCard } from "@/discovery/types";
import { STRENGTH_LABEL, shareText, type Strength } from "@/hub/strength";
import { contextFor, useOrgContext } from "@/org/context";
import { goalServed, statedGoals } from "@/org/goals";
import { useProject } from "@/projects/session";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { Button, IconBtn, Spinner } from "../controls";
import { r } from "../recipes";
import { useVoices } from "./strength";

/*
 * The needs under an outcome (or a broad need), side by side, to choose the one to target. Code
 * counts what it can for each (src/discovery/compare.ts): how strong its evidence is, who it's
 * from, how recent, what's against it, what's under it. The team rates what it can't. Qalam AI
 * can argue for one, citing what it was sent; code shows its argument only when it holds.
 */

const useCompare = create<{ parent: string | null }>(() => ({ parent: null }));
export const openCompare = (parent: string) => useCompare.setState({ parent });
const close = () => useCompare.setState({ parent: null });

const SMALL = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const TONE: Record<Strength["level"], string> = { none: "bg-warning-subtle", team: "bg-warning-subtle", thin: "bg-warning-subtle", some: "bg-muted", strong: "bg-success-subtle" };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ago = (at: number) => {
  const d = Math.floor((Date.now() - at) / 86_400_000);
  return d < 1 ? "today" : d < 14 ? `${d} days ago` : d < 60 ? `${Math.floor(d / 7)} weeks ago` : `${Math.floor(d / 30)} months ago`;
};

export default function CompareView() {
  const parent = useCompare((s) => s.parent);
  const doc = useStudio((s) => s.doc);
  if (!parent || !cardOf(doc, parent)) return null;
  return <Compare key={parent} parent={parent} />;
}

function Compare({ parent }: { parent: string }) {
  const doc = useStudio((s) => s.doc);
  const voices = useVoices();
  const product = useProject((s) => s.project?.product ?? null);
  const { about, products } = useOrgContext();
  const rows = useMemo(() => compareUnder(doc, parent, { now: Date.now(), voices }), [doc, parent, voices]);
  const card = cardOf(doc, parent)!;
  const [advice, setAdvice] = useState<CompareAdvice | null | "none">(null);
  const [asking, setAsking] = useState(false);
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);

  // The outcome above (or the card itself), and the goal it serves.
  let outcome: OstCard | null = null;
  for (let id: string | null | undefined = parent; id; id = doc.nodes[id]?.parentId) {
    const c = cardOf(doc, id);
    if (c?.kind === "outcome") {
      outcome = c;
      break;
    }
  }
  let top: OstCard | null = outcome;
  for (let id = doc.nodes[parent]?.parentId; id; id = doc.nodes[id]?.parentId) {
    const c = cardOf(doc, id);
    if (c?.kind === "outcome") top = c;
  }
  const goal = goalServed(top?.serves, statedGoals(about, products))?.goal.text;

  const ask = async () => {
    const m = compareMaterial({ parent: card, outcome, goal, context: contextFor(product), rows, voices });
    stop.current?.abort();
    stop.current = new AbortController();
    setAsking(true);
    setAdvice(null);
    try {
      const { data } = await callAI<unknown>("/api/compare", { text: m.text, needs: [...m.needs.keys()], ids: [...m.cited.keys()] }, undefined, stop.current.signal);
      setAdvice(sanitizeCompare(data, m) ?? "none");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) feedback(e instanceof AIError ? e.message : "Qalam AI couldn't answer.", { kind: "error", id: "compare" });
    } finally {
      setAsking(false);
    }
  };

  const target = (id: string) => {
    let was: string | null = null;
    studio().mutate((d) => void (was = setTargetIn(d, id)));
    feedback(was ? `Target moved from “${was}”` : "Target set", { id: "discovery.target" });
  };
  const rate = (id: string, k: RatingKey, v: 1 | 2 | 3 | null) =>
    studio().mutate((d) =>
      updateCardIn(d, id, (c) => {
        const next = { ...c.rating };
        if (v === null) delete next[k];
        else next[k] = v;
        if (Object.keys(next).length) c.rating = next;
        else delete c.rating;
      }),
    );

  const title = (id: string) => rows.find((x) => x.id === id)?.card.title ?? "";
  const row = (label: string, cell: (x: Compared) => ReactNode, hint?: string) => (
    <tr className="border-t border-line-subtle align-top">
      <th scope="row" className="w-[148px] py-[8px] pr-[12px] text-left text-caption font-normal text-fg-subtle" title={hint}>
        {label}
      </th>
      {rows.map((x) => (
        <td key={x.id} className="min-w-[200px] py-[8px] pr-[12px] text-caption text-fg">
          {cell(x)}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="pointer-events-auto fixed inset-0 z-[60]">
      <div data-state="open" className={clsx(r.overlay, "z-[60]")} onPointerDown={close} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Compare the needs"
        data-state="open"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") close();
        }}
        className={clsx(r.modal, "fixed left-1/2 top-[5vh] z-[61] flex max-h-[90vh] w-[min(1100px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden outline-none")}
      >
        <div className="flex items-start gap-[12px] px-[20px] pt-[16px] pb-[8px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <h2 className="text-title font-semibold text-fg">Which need to target?</h2>
            <p className="text-caption text-fg-muted">
              The needs under “{card.title}”{goal ? `, for the goal “${goal}”` : ""}. Code counts what backs each; you rate what it can't count.
            </p>
          </div>
          <IconBtn size="sm" label="Close" onClick={close}>
            <X {...SMALL} />
          </IconBtn>
        </div>
        <div className="flex flex-col gap-[14px] overflow-auto px-[20px] pb-[16px]">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="w-[148px]" />
                {rows.map((x) => (
                  <th key={x.id} scope="col" className="min-w-[200px] py-[6px] pr-[12px] text-left align-bottom text-body font-semibold text-fg" dir="auto">
                    {x.card.title || "Untitled"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {row("Stage", (x) => (x.card.stage === "target" ? <span className="font-semibold">Target</span> : stageLabel("opportunity", x.card.stage)))}
              {row("How strong", (x) => (
                <span className={clsx("inline-flex flex-col rounded-md px-[8px] py-[4px]", TONE[x.strength.level])}>
                  <span className="font-semibold">{STRENGTH_LABEL[x.strength.level]}</span>
                  {x.strength.next && <span className="text-micro text-fg-muted">{x.strength.next}</span>}
                </span>
              ))}
              {row("Who says it", (x) => (x.strength.tally.voices ? `${plural(x.strength.tally.voices, "voice")}${x.strength.tally.people ? `, ${x.strength.tally.people} named` : ""}` : x.strength.team ? "Only the team" : "No one yet"), "People, not quotes: one talkative customer is one voice")}
              {row("Segments", (x) => (x.strength.tally.segments.length ? x.strength.tally.segments.map(([s, n]) => `${s} (${n})`).join(" · ") : "Not known"))}
              {row("Sources", (x) => plural(x.strength.tally.sources, "source"))}
              {rows.some((x) => x.strength.rows.length) && row("In exports", (x) => (x.strength.rows.length ? x.strength.rows.map(shareText).join("; ") : "—"), "Rows of a table source (tickets, answers, reviews) it shows up in")}
              {row("Newest", (x) => (x.strength.tally.newest ? ago(x.strength.tally.newest) : "—"))}
              {row("Against it", (x) => (x.strength.against ? plural(x.strength.against, "voice") : "Nothing"))}
              {row("Under it", (x) => `${plural(x.solutions, "solution")}${x.tests.passed || x.tests.failed ? ` · tests ${x.tests.passed} passed, ${x.tests.failed} failed` : ""}`)}
              {RATING_KEYS.map((k) => (
                <tr key={k} className="border-t border-line-subtle align-top">
                  <th scope="row" className="w-[148px] py-[8px] pr-[12px] text-left text-caption font-normal text-fg-subtle">
                    {RATING_LABEL[k]} <span className="text-micro">(your call)</span>
                  </th>
                  {rows.map((x) => (
                    <td key={x.id} className="py-[6px] pr-[12px]">
                      <div role="radiogroup" aria-label={`${RATING_LABEL[k]}: ${x.card.title}`} className={clsx(r.segmented, "w-full max-w-[220px]")}>
                        {RATING_STEPS[k].map((label, i) => {
                          const v = (i + 1) as 1 | 2 | 3;
                          const on = x.card.rating?.[k] === v;
                          return (
                            <button key={label} type="button" role="radio" aria-checked={on} onClick={() => rate(x.id, k, on ? null : v)} className={clsx(r.segmentedItem, "text-caption", on && "bg-elevated shadow-raised")}>
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
              {row("", (x) =>
                x.card.stage === "target" ? (
                  <span className="text-fg-subtle">The target</span>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => target(x.id)}>
                    Make it the target
                  </Button>
                ),
              )}
            </tbody>
          </table>

          <section aria-label="Qalam AI's view" className="flex flex-col gap-[8px] rounded-lg p-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
            <div className="flex items-center justify-between gap-[12px]">
              <p className="text-caption text-fg-muted">Qalam AI can weigh these with your goals, strategy and constraints. Code shows its view only when its quotes and numbers are in what it cites.</p>
              <Button size="sm" variant="secondary" disabled={asking} onClick={() => void ask()}>
                {asking ? <Spinner size={12} /> : <QalamAIGlyph size={12} />} {advice ? "Ask again" : "Ask Qalam AI"}
              </Button>
            </div>
            {advice === "none" && <p className="text-caption text-fg-muted">Qalam AI's answer didn't hold up against what it cited, so it isn't shown. Ask again, or rate the needs first.</p>}
            {advice && advice !== "none" && (
              <div className="flex flex-col gap-[6px]">
                <p className="text-body text-fg">{advice.pick ? <>Target <span className="font-semibold">“{title(advice.pick)}”</span> first.</> : "It can't tell them apart yet."}</p>
                <p className="text-caption text-fg">{advice.why}</p>
                {advice.others.map((o) => (
                  <p key={o.card} className="text-caption text-fg-muted">
                    <span className="font-medium text-fg">“{title(o.card)}”</span>: {o.note}
                  </p>
                ))}
                {advice.ask && <p className="text-caption text-fg-muted">To settle it: {advice.ask}</p>}
                {advice.pick && cardOf(doc, advice.pick)?.stage !== "target" && (
                  <Button size="sm" className="self-start" onClick={() => target(advice.pick!)}>
                    Make “{title(advice.pick)}” the target
                  </Button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
