import { useEffect, useRef, useState, type MouseEvent } from "react";
import clsx from "clsx";
import { ChartLine, ExternalLink, X } from "lucide-react";
import { countsEvents } from "@/connectors/analytics";
import type { InsightNumbers } from "@/connectors/numbers";
import type { Hit } from "@/connectors/recipes";
import { toolConnected } from "@/connectors/suggest";
import type { OstMetric } from "@/discovery/types";
import { numbersDb } from "@/org/connectors";
import { placeHref } from "@/projects/model";
import { useConnectorView } from "../chat/SourcePicker";
import { Button, IconBtn } from "../controls";
import { r } from "../recipes";
import { ago } from "../time";
import { EventPicker } from "./EventPicker";

const ICON = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/**
 * Where a number comes from: a saved chart in an analytics tool (an outcome card's, a goal's). Code
 * reads the number from the tool's own answer; reading it isn't a decision. Through Claude Code
 * each read takes about a minute (it starts its servers first). `query` and `open` start it searching
 * for that chart at once (a job that reads the number).
 */
export function MetricSource({ m, onChange, onLeave, query: first = "", open = false }: { m: OstMetric; onChange: (next: OstMetric) => void; onLeave?: (e: MouseEvent<HTMLAnchorElement>) => void; query?: string; open?: boolean }) {
  const { view } = useConnectorView();
  const tools = (view?.connectors ?? []).filter((c) => c.numbers && toolConnected(c));
  const [picked, setPicked] = useState<string | null>(null);
  const toolId = picked ?? m.source?.connector ?? tools[0]?.id ?? "posthog";
  const label = view?.connectors.find((c) => c.id === toolId)?.label ?? toolId;
  const [step, setStep] = useState<"idle" | "pick" | "series">(open ? "pick" : "idle");
  const [query, setQuery] = useState(first);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [series, setSeries] = useState<{ hit: Hit; read: InsightNumbers } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const viaClaude = view?.connectors.find((c) => c.id === toolId)?.via === "claude-code";
  const run = async (say: string, fn: () => Promise<void>) => {
    setBusy(say);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  /** Counting one of its events instead: where it has no saved chart that fits, or they asked. */
  const [events, setEvents] = useState(false);
  const canCount = countsEvents(toolId);
  const find = (q: string, id = toolId) =>
    run(`Looking in ${label}…`, async () => {
      const found = (await numbersDb.insights(q, id)).hits;
      setHits(found);
      if (!found.length && countsEvents(id)) setEvents(true);
    });
  // Once, when it opens on a job's query (a ref, as development runs effects twice).
  const started = useRef(false);
  useEffect(() => {
    if (open && first.trim() && !started.current) {
      started.current = true;
      void find(first);
    }
  }, []);
  const apply = (hit: Pick<Hit, "id" | "title" | "url">, s: { label: string; value: number }, url?: string) => {
    onChange({ ...m, current: s.value, source: { connector: toolId, ref: hit.id, ...(url ?? hit.url ? { url: url ?? hit.url } : {}), label: hit.title, series: s.label }, readAt: Date.now() });
    setStep("idle");
    setSeries(null);
  };
  /** Read it, and use the series asked for, the only one, or ask which. */
  const read = (hit: Pick<Hit, "id" | "title" | "url">, want?: string) =>
    run(`Reading it from ${label}…`, async () => {
      const r = await numbersDb.read(hit.id, toolId);
      if (!r.series.length) throw new Error("This chart has no one number to read. Pick another, or type the number.");
      const s = want ? r.series.find((x) => x.label === want) : r.series.length === 1 ? r.series[0] : undefined;
      if (s) return apply({ ...hit, title: r.name ?? hit.title }, s, r.url);
      setSeries({ hit: { ...hit, title: r.name ?? hit.title }, read: r });
      setStep("series");
    });
  const src = m.source;
  return (
    <div className="flex flex-col gap-[6px] pt-[4px]">
      {src && step === "idle" ? (
        <div className="flex items-center gap-[6px] text-caption text-fg-muted">
          <ChartLine {...ICON} />
          <span className="min-w-0 flex-1 truncate">
            {label} · {src.label ?? src.ref}
            {src.series && src.series !== src.label ? ` · ${src.series}` : ""}
            {m.readAt ? ` · read ${ago(m.readAt)}` : ""}
          </span>
          {src.url && (
            <a href={src.url} target="_blank" rel="noreferrer" aria-label={`Open it in ${label}`} className={r.iconButtonSm}>
              <ExternalLink {...ICON} />
            </a>
          )}
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void read({ id: src.ref, title: src.label ?? src.ref, url: src.url }, src.series)}>
            Read again
          </Button>
          <IconBtn size="sm" label={`Stop reading it from ${label}`} onClick={() => onChange({ ...m, source: undefined, readAt: undefined })}>
            <X {...ICON} />
          </IconBtn>
        </div>
      ) : step === "idle" ? (
        tools.length ? (
          <span className="flex flex-wrap gap-[6px]">
            {tools.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant="secondary"
                onClick={() => {
                  setPicked(c.id);
                  setHits(null);
                  setEvents(false);
                  setStep("pick");
                  void find("", c.id);
                }}
              >
                <ChartLine {...ICON} />
                Read it from {c.label}…
              </Button>
            ))}
          </span>
        ) : (
          <a href={placeHref("connections")} onClick={onLeave} className={clsx(r.buttonSm, r.buttonSecondary, "self-start")}>
            <ChartLine {...ICON} />
            Read it from your analytics…
          </a>
        )
      ) : null}
      {step === "pick" && events && (
        <div className="flex flex-col gap-[4px]">
          <span className="flex items-center gap-[6px]">
            <span className="min-w-0 flex-1 text-micro text-fg-subtle">{hits && !hits.length ? `No saved chart ${query.trim() ? "by that name" : `in ${label} yet`}, so count an event instead.` : `Count an event in ${label}.`}</span>
            <IconBtn size="sm" label="Cancel" onClick={() => (setStep("idle"), setHits(null), setEvents(false))}>
              <X {...ICON} />
            </IconBtn>
          </span>
          <EventPicker tool={{ id: toolId, label, via: viaClaude ? "claude-code" : null }} onCharts={() => setEvents(false)} onPick={(picked, count) => (apply(picked, count, picked.url), setEvents(false))} />
        </div>
      )}
      {step === "pick" && !events && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void find(query);
          }}
          className="flex flex-col gap-[6px]"
        >
          <span className="flex items-center gap-[6px]">
            <span className={clsx(r.field, "flex-1")}>
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A saved chart's name" aria-label={`Search ${label}'s saved charts`} className={r.fieldInput} />
            </span>
            <Button type="submit" size="sm" variant="secondary" disabled={!!busy}>
              Find
            </Button>
            <IconBtn size="sm" label="Cancel" onClick={() => (setStep("idle"), setHits(null))}>
              <X {...ICON} />
            </IconBtn>
          </span>
          {hits?.map((h) => (
            <button key={h.id} type="button" disabled={!!busy} onClick={() => void read(h)} className="q-item flex flex-col items-start rounded-md px-[6px] py-[4px] text-left hover:bg-hover">
              <span className="truncate text-caption text-fg">{h.title}</span>
              {h.snippet && <span className="truncate text-micro text-fg-subtle">{h.snippet}</span>}
            </button>
          ))}
          {hits && !hits.length && <p className="text-micro text-fg-subtle">No saved chart by that name.</p>}
          {canCount && !busy && (
            <button type="button" className={clsx(r.buttonSm, r.buttonGhost, "self-start")} onClick={() => setEvents(true)}>
              Count an event instead
            </button>
          )}
        </form>
      )}
      {step === "series" && series && (
        <div className="flex flex-col gap-[2px]">
          <span className="text-micro text-fg-subtle">Which of its numbers is it?</span>
          {series.read.series.map((s) => (
            <button key={s.label} type="button" onClick={() => apply(series.hit, s, series.read.url)} className="q-item flex items-center justify-between gap-[8px] rounded-md px-[6px] py-[4px] text-left text-caption hover:bg-hover">
              <span className="truncate text-fg">{s.label}</span>
              <span className="tnum text-fg-muted">{s.value}</span>
            </button>
          ))}
        </div>
      )}
      {busy && <p className="q-shimmer-text text-micro text-fg-muted">{busy}{viaClaude ? " About a minute through Claude Code." : ""}</p>}
      {error && (
        <p className="text-micro text-danger">
          {error}{" "}
          {/Connections/.test(error) && (
            <a href={placeHref("connections")} onClick={onLeave} className="underline">
              Open Connections
            </a>
          )}
        </p>
      )}
    </div>
  );
}
