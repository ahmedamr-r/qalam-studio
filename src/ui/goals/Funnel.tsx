import { useState } from "react";
import clsx from "clsx";
import { ChartLine, ExternalLink, X } from "lucide-react";
import type { MapFlow, ProductMap } from "@/code/map";
import type { Hit } from "@/connectors/recipes";
import type { FunnelNumbers } from "@/goals/breakdown";
import { funnelDrops } from "@/goals/math";
import type { Goal } from "@/goals/types";
import { orgFetch } from "@/org/client";
import { numbersDb } from "@/org/connectors";
import { placeHref } from "@/projects/model";
import { Button, IconBtn } from "../controls";
import { r } from "../recipes";
import { ago } from "../time";

/**
 * A goal's funnel: the flow in the product's code whose events measure it (hub/maps, read by the
 * code reader), and how many people reach each step, counted by a saved PostHog funnel (code reads
 * the counts from PostHog's own answer). The biggest drop is code's arithmetic.
 */

const ICON = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const pct = (r: number) => `${Math.round(r * 100)}%`;

export function Funnel({ goal, funnel, numbers, onChanged }: { goal: Goal; funnel: { map: ProductMap; flow: MapFlow } | null; numbers?: FunnelNumbers; onChanged: () => void }) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState(funnel?.flow.name ?? goal.title);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!funnel && !numbers) return null;
  const find = async () => {
    setBusy("Asking PostHog through Claude Code… about a minute");
    setError(null);
    try {
      setHits((await numbersDb.insights(query)).hits);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const read = async (hit: Hit) => {
    setBusy("Reading the funnel through Claude Code… about a minute");
    setError(null);
    try {
      const got = await numbersDb.read(hit.id);
      if (!got.steps?.length) throw new Error("That insight isn't a funnel: pick a saved funnel.");
      await orgFetch(`/goals/${encodeURIComponent(goal.id)}/funnel`, { method: "PUT", json: { insight: { ref: hit.id, name: got.name ?? hit.title, ...(got.url ?? hit.url ? { url: got.url ?? hit.url } : {}) }, steps: got.steps } });
      setPicking(false);
      setHits(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const drops = numbers ? funnelDrops(numbers.steps) : [];
  const top = Math.max(1, ...drops.map((d) => d.count));
  return (
    <section aria-labelledby="funnel" className="flex flex-col gap-[8px]">
      <div className="flex flex-wrap items-end justify-between gap-[12px]">
        <div className="flex flex-col gap-[2px]">
          <h2 id="funnel" className="text-title font-medium">
            Funnel
          </h2>
          <p className="text-caption text-fg-subtle">{funnel ? `The steps in the code that measure it: ${funnel.flow.name}, from ${funnel.map.repo}${funnel.map.commit ? ` at ${funnel.map.commit.slice(0, 7)}` : ""}.` : "How many people reach each step, from PostHog."}</p>
        </div>
        {!picking && (
          <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
            <ChartLine {...ICON} /> {numbers ? "Read the counts again" : "Read the counts from PostHog"}
          </Button>
        )}
      </div>
      {funnel && !numbers && (
        <ol className="flex flex-col rounded-lg bg-panel py-[4px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          {funnel.flow.steps.map((s, i) => (
            <li key={`${s.file}:${i}`} className="grid grid-cols-[20px_minmax(0,1fr)_minmax(0,220px)] items-center gap-x-[10px] px-[14px] py-[6px]">
              <span className="text-caption text-fg-subtle tnum">{i + 1}</span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body text-fg">{s.title}</span>
                <span className="truncate font-mono text-micro text-fg-subtle">{s.file}</span>
              </span>
              <span className="truncate text-right font-mono text-micro text-fg-muted">{s.events.join(", ") || "sends no event"}</span>
            </li>
          ))}
        </ol>
      )}
      {numbers && (
        <ol className="flex flex-col rounded-lg bg-panel py-[4px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          {drops.map((d, i) => (
            <li key={`${d.label}:${i}`} className="grid grid-cols-[20px_minmax(0,1fr)_minmax(120px,240px)_88px] items-center gap-x-[10px] px-[14px] py-[6px]">
              <span className="text-caption text-fg-subtle tnum">{i + 1}</span>
              <span className="truncate text-body text-fg">{funnel?.flow.steps.find((s) => s.events.includes(d.label))?.title ?? d.label}</span>
              <span className="relative block h-[6px] overflow-hidden rounded-full bg-active" aria-hidden>
                <span className={clsx("absolute inset-y-0 left-0 rounded-full", d.biggest ? "bg-warning" : "bg-fg-muted")} style={{ width: `${(100 * d.count) / top}%` }} />
              </span>
              <span className={clsx("text-right text-caption tnum", d.biggest ? "text-warning" : "text-fg-muted")}>
                {d.count.toLocaleString("en-US")}
                {d.rate !== null && ` · ${pct(d.rate)}`}
              </span>
            </li>
          ))}
        </ol>
      )}
      {numbers && (
        <span className="flex items-center gap-[6px] text-micro text-fg-subtle">
          {drops.find((d) => d.biggest) && <span className="text-warning">The biggest drop is at “{funnel?.flow.steps.find((s) => s.events.includes(drops.find((d) => d.biggest)!.label))?.title ?? drops.find((d) => d.biggest)!.label}”.</span>}
          PostHog · {numbers.insight.name} · read {ago(numbers.at)}
          {numbers.insight.url && (
            <a href={numbers.insight.url} target="_blank" rel="noreferrer" aria-label="Open it in PostHog" className={r.iconButtonSm}>
              <ExternalLink {...ICON} />
            </a>
          )}
        </span>
      )}
      {picking && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void find();
          }}
          className="flex flex-col gap-[6px] rounded-lg bg-panel px-[14px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]"
        >
          <span className="flex items-center gap-[6px]">
            <span className={clsx(r.field, "flex-1")}>
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A saved funnel's name" aria-label="Search PostHog's insights" className={r.fieldInput} />
            </span>
            <Button type="submit" size="sm" variant="secondary" disabled={!!busy}>
              Find
            </Button>
            <IconBtn size="sm" label="Cancel" onClick={() => (setPicking(false), setHits(null))}>
              <X {...ICON} />
            </IconBtn>
          </span>
          {hits?.map((h) => (
            <button key={h.id} type="button" disabled={!!busy} onClick={() => void read(h)} className="q-item flex flex-col items-start rounded-md px-[6px] py-[4px] text-left hover:bg-hover">
              <span className="truncate text-caption text-fg">{h.title}</span>
              {h.snippet && <span className="truncate text-micro text-fg-subtle">{h.snippet}</span>}
            </button>
          ))}
          {hits && !hits.length && <p className="text-micro text-fg-subtle">No saved insight by that name.</p>}
          {busy && <p className="q-shimmer-text text-micro text-fg-muted">{busy}</p>}
          {error && (
            <p className="text-micro text-danger">
              {error}{" "}
              {/Connections/.test(error) && (
                <a href={placeHref("connections")} className="underline">
                  Open Connections
                </a>
              )}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
