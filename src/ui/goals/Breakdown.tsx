import { useState } from "react";
import clsx from "clsx";
import { ExternalLink, Target } from "lucide-react";
import { callAI } from "@/ai/client";
import { feedback } from "@/commands/feedback";
import { loadGoals } from "@/goals/client";
import type { Breakdown as BreakdownData, BreakdownPart } from "@/goals/breakdown";
import { metricLine } from "@/goals/goals-md";
import { checkParts } from "@/goals/math";
import type { Benchmark, Outside as OutsideData } from "@/goals/outside";
import { GOAL_LEVERS, LEVER_LABEL, type Goal, type GoalLever } from "@/goals/types";
import { orgFetch, orgPath } from "@/org/client";
import { goalHref } from "@/projects/model";
import { QalamAIGlyph } from "../brand";
import { Button } from "../controls";
import { r } from "../recipes";
import { ago } from "../time";

/*
 * On a goal's page: the goals under it, and Break it down (Qalam AI proposes the goals under it,
 * each on a lever, resting on the team's own material; code does the arithmetic), and What others
 * aim for (numbers companies like theirs report, each found on its page by code). Proposals wait
 * in hub/goals/<goal>.json until each is accepted or discarded.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const SMALL = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const value = (b: Pick<Benchmark, "value" | "unit">) => (b.unit === "%" ? `${b.value}%` : `${b.value.toLocaleString("en-US")}${b.unit ? ` ${b.unit}` : ""}`);

/** A long piece of work in the core, with what it's doing as it goes. */
async function run<T>(path: string, body: unknown, onActivity: (label: string) => void): Promise<T> {
  const { data } = await callAI<T>(await orgPath(path), body, undefined, undefined, (e) => {
    if (e.type === "activity") onActivity(e.label);
  });
  return data;
}

export function GoalsUnder({ goal, children, breakdown, onChanged }: { goal: Goal; children: Goal[]; breakdown?: BreakdownData; onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  const [levers, setLevers] = useState<GoalLever[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const pending = (breakdown?.parts ?? []).filter((p) => !breakdown?.decided[p.id]);
  const propose = async () => {
    setBusy("Qalam AI is breaking it down");
    setNote(null);
    try {
      const r = await run<{ parts: number; none: string }>(`/goals/${encodeURIComponent(goal.id)}/breakdown`, { levers }, setBusy);
      setAsking(false);
      if (!r.parts) setNote(r.none || "Qalam AI found nothing it could stand behind to propose.");
      onChanged();
    } catch (e) {
      feedback(`Qalam AI couldn't break it down: ${message(e)}`, { kind: "error", id: "goal.breakdown" });
    } finally {
      setBusy(null);
    }
  };
  const decide = async (p: BreakdownPart, accept: boolean) => {
    await orgFetch(`/goals/${encodeURIComponent(goal.id)}/breakdown/${encodeURIComponent(p.id)}`, { method: "POST", json: { accept } }).catch((e) => feedback(`Couldn't change it: ${message(e)}`, { kind: "error", id: "goal.part" }));
    if (accept) await loadGoals().catch(() => {});
    onChanged();
  };
  // Whether the parts (those taken, those proposed) make the goal's number: code's arithmetic.
  const check = breakdown?.relation ? checkParts(goal.metric, [...children.map((c) => c.metric), ...pending.map((p) => p.metric)], breakdown.relation) : null;

  return (
    <section aria-labelledby="under" className="flex flex-col gap-[8px]">
      <div className="flex flex-wrap items-end justify-between gap-[12px]">
        <div className="flex flex-col gap-[2px]">
          <h2 id="under" className="text-title font-medium">
            Goals under it
          </h2>
          <p className="text-caption text-fg-subtle">The parts its number is made of, each a change in what customers do.</p>
        </div>
        {!asking && !busy && (
          <Button variant="secondary" size="sm" onClick={() => setAsking(true)}>
            <QalamAIGlyph size={12} /> Break it down
          </Button>
        )}
      </div>
      {children.length > 0 && (
        <ul className="flex flex-col rounded-lg bg-panel py-[4px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          {children.map((c) => (
            <li key={c.id}>
              <a href={goalHref(c.id)} className="grid h-[36px] grid-cols-[16px_minmax(0,1fr)_minmax(0,220px)] items-center gap-x-[10px] px-[12px] hover:bg-hover">
                <Target {...ICON} className="text-fg-subtle" />
                <span className="truncate text-body text-fg">{c.title}</span>
                <span className="truncate text-right text-caption text-fg-muted tnum">{[c.lever ? LEVER_LABEL[c.lever] : null, c.metric ? metricLine(c.metric) : "No number yet"].filter(Boolean).join(" · ")}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {asking && (
        <div className="flex flex-col gap-[10px] rounded-lg bg-panel px-[14px] py-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          <span className="text-caption text-fg-muted">Which levers should it look at? Leave them all off and Qalam AI picks.</span>
          <div className="flex flex-wrap gap-[6px]" role="group" aria-label="Levers">
            {GOAL_LEVERS.map((l) => {
              const on = levers.includes(l);
              return (
                <button key={l} type="button" aria-pressed={on} onClick={() => setLevers(on ? levers.filter((x) => x !== l) : [...levers, l])} className={clsx(r.buttonSm, on ? r.buttonSecondary : r.buttonGhost, on && "shadow-[inset_0_0_0_1px_var(--color-line-strong)]")}>
                  {LEVER_LABEL[l]}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-[8px]">
            <Button size="sm" onClick={() => void propose()} disabled={!!busy}>
              <QalamAIGlyph size={12} /> Propose goals under it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)} disabled={!!busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {busy && <p className="q-shimmer-text text-caption text-fg-muted">{busy}…</p>}
      {note && !busy && <p className="text-caption text-fg-muted">{note}</p>}
      {pending.length > 0 && (
        <div className="flex flex-col gap-[6px]">
          <span className="text-micro font-medium text-fg-subtle">Qalam AI proposes · {ago(breakdown!.at)}</span>
          <ul className="flex flex-col gap-[6px]">
            {pending.map((p) => (
              <PartRow key={p.id} p={p} onDecide={(accept) => void decide(p, accept)} />
            ))}
          </ul>
          {check && <p className={clsx("text-caption", check.now?.holds === false || check.target?.reaches === false ? "text-warning" : "text-fg-muted")}>{check.line}</p>}
        </div>
      )}
      {!children.length && !pending.length && !asking && !busy && <p className="text-caption text-fg-subtle">No goals under it yet.</p>}
    </section>
  );
}

function PartRow({ p, onDecide }: { p: BreakdownPart; onDecide: (accept: boolean) => void }) {
  return (
    <li className="flex flex-col gap-[6px] rounded-lg bg-panel px-[14px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex items-start gap-[10px]">
        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-micro font-medium text-fg-subtle">{[LEVER_LABEL[p.lever], p.metric ? [p.metric.name !== p.title ? p.metric.name : null, metricLine(p.metric)].filter(Boolean).join(": ") : "No number yet"].join(" · ")}</span>
          <span className="text-body text-fg">{p.title}</span>
          <span className="flex items-start gap-[6px] text-caption text-fg-muted">
            <QalamAIGlyph size={12} className="mt-[2px] shrink-0" />
            <span>{p.why}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-[4px]">
          <Button size="sm" variant="ghost" onClick={() => onDecide(false)}>
            Discard
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onDecide(true)}>
            Accept
          </Button>
        </span>
      </div>
      {p.benchmarks.map((b) => (
        <a key={b.id + b.url} href={b.url} target="_blank" rel="noreferrer" className="flex items-start gap-[6px] text-caption text-fg-subtle hover:text-fg">
          <ExternalLink {...SMALL} className="mt-[2px] shrink-0" />
          <span>
            Others report {value(b)}, {b.what} ({b.who}): “{b.quote}”
          </span>
        </a>
      ))}
      {!p.cites.length && <span className="text-micro text-fg-subtle">Rests on the goals above it; nothing in your material yet.</span>}
    </li>
  );
}

export function OtherAims({ goal, outside, onChanged }: { goal: Goal; outside?: OutsideData; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const look = async () => {
    setBusy("Looking up what companies like yours aim for");
    setNote(null);
    try {
      const r = await run<{ kept: number; read: number; error?: string }>(`/goals/${encodeURIComponent(goal.id)}/outside`, {}, setBusy);
      setNote(r.error ?? (r.kept ? null : `Read ${plural(r.read, "page")}; no number on them held up.`));
      onChanged();
    } catch (e) {
      feedback(`Couldn't look it up: ${message(e)}`, { kind: "error", id: "goal.outside" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <section aria-labelledby="outside" className="flex flex-col gap-[8px]">
      <div className="flex flex-wrap items-end justify-between gap-[12px]">
        <div className="flex flex-col gap-[2px]">
          <h2 id="outside" className="text-title font-medium">
            What others aim for
          </h2>
          <p className="max-w-[560px] text-caption text-fg-subtle">Numbers companies like yours report publicly, each found on its page. They&apos;re theirs, never your goal&apos;s number.</p>
        </div>
        <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => void look()}>
          <QalamAIGlyph size={12} /> {outside ? "Look again" : "Look it up"}
        </Button>
      </div>
      {busy && <p className="q-shimmer-text text-caption text-fg-muted">{busy}… a minute or two</p>}
      {note && !busy && <p className="text-caption text-fg-muted">{note}</p>}
      {outside?.claims.length ? (
        <ul className="flex flex-col rounded-lg bg-panel py-[4px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          {outside.claims.map((b) => (
            <li key={b.id} className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-x-[12px] px-[14px] py-[8px]">
              <span className="pt-[1px] text-body font-medium text-fg tnum">{value(b)}</span>
              <span className="flex min-w-0 flex-col gap-[2px]">
                <span className="text-body text-fg">
                  {b.what} <span className="text-fg-muted">· {b.who}</span>
                </span>
                <span className="text-caption text-fg-subtle">“{b.quote}”</span>
                <a href={b.url} target="_blank" rel="noreferrer" className="flex items-center gap-[4px] truncate text-micro text-fg-subtle hover:text-fg hover:underline">
                  <ExternalLink {...SMALL} className="shrink-0" /> {b.title}
                </a>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        !busy && !note && <p className="text-caption text-fg-subtle">{outside ? "Nothing held up last time." : "Nothing looked up yet."}</p>
      )}
      {outside && <span className="text-micro text-fg-subtle">Looked up {ago(outside.at)} · {plural(outside.pages.length, "page")} read</span>}
    </section>
  );
}
