import { useEffect, useRef, useState, type MouseEvent } from "react";
import clsx from "clsx";
import { ChartLine, ExternalLink, X } from "lucide-react";
import type { InsightNumbers } from "@/connectors/numbers";
import type { Hit } from "@/connectors/recipes";
import type { OstMetric } from "@/discovery/types";
import { numbersDb } from "@/org/connectors";
import { placeHref } from "@/projects/model";
import { Button, IconBtn } from "../controls";
import { r } from "../recipes";
import { ago } from "../time";

const ICON = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/**
 * Where a number comes from: a saved PostHog insight, read through Claude Code's PostHog server
 * (an outcome card's, a goal's). Code reads the number from PostHog's own answer; reading it isn't
 * a decision. Each read takes about a minute (Claude Code starts its servers first). `query` and
 * `open` start it searching for that insight at once (a job that reads the number).
 */
export function MetricSource({ m, onChange, onLeave, query: first = "", open = false }: { m: OstMetric; onChange: (next: OstMetric) => void; onLeave?: (e: MouseEvent<HTMLAnchorElement>) => void; query?: string; open?: boolean }) {
  const [step, setStep] = useState<"idle" | "pick" | "series">(open ? "pick" : "idle");
  const [query, setQuery] = useState(first);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [series, setSeries] = useState<{ hit: Hit; read: InsightNumbers } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const find = (q: string) => run("Asking PostHog through Claude Code…", async () => setHits((await numbersDb.insights(q)).hits));
  // Once, when it opens on a job's query (a ref, as development runs effects twice).
  const started = useRef(false);
  useEffect(() => {
    if (open && first.trim() && !started.current) {
      started.current = true;
      void find(first);
    }
  }, []);
  const apply = (hit: Pick<Hit, "id" | "title" | "url">, s: { label: string; value: number }, url?: string) => {
    onChange({ ...m, current: s.value, source: { connector: "posthog", ref: hit.id, ...(url ?? hit.url ? { url: url ?? hit.url } : {}), label: hit.title, series: s.label }, readAt: Date.now() });
    setStep("idle");
    setSeries(null);
  };
  /** Read it, and use the series asked for, the only one, or ask which. */
  const read = (hit: Pick<Hit, "id" | "title" | "url">, want?: string) =>
    run("Reading it through Claude Code…", async () => {
      const r = await numbersDb.read(hit.id);
      if (!r.series.length) throw new Error("This insight has no one number to read. Pick another, or type the number.");
      const s = want ? r.series.find((x) => x.label === want) : r.series.length === 1 ? r.series[0] : undefined;
      if (s) return apply({ ...hit, title: r.name ?? hit.title }, s, r.url);
      setSeries({ hit: { ...hit, title: r.name ?? hit.title }, read: r });
      setStep("series");
    });
  const src = m.source?.connector === "posthog" ? m.source : null;
  return (
    <div className="flex flex-col gap-[6px] pt-[4px]">
      {src && step === "idle" ? (
        <div className="flex items-center gap-[6px] text-caption text-fg-muted">
          <ChartLine {...ICON} />
          <span className="min-w-0 flex-1 truncate">
            PostHog · {src.label ?? src.ref}
            {src.series && src.series !== src.label ? ` · ${src.series}` : ""}
            {m.readAt ? ` · read ${ago(m.readAt)}` : ""}
          </span>
          {src.url && (
            <a href={src.url} target="_blank" rel="noreferrer" aria-label="Open it in PostHog" className={r.iconButtonSm}>
              <ExternalLink {...ICON} />
            </a>
          )}
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void read({ id: src.ref, title: src.label ?? src.ref, url: src.url }, src.series)}>
            Read again
          </Button>
          <IconBtn size="sm" label="Stop reading it from PostHog" onClick={() => onChange({ ...m, source: undefined, readAt: undefined })}>
            <X {...ICON} />
          </IconBtn>
        </div>
      ) : step === "idle" ? (
        <Button size="sm" variant="secondary" className="self-start" onClick={() => setStep("pick")}>
          <ChartLine {...ICON} />
          Read it from PostHog…
        </Button>
      ) : null}
      {step === "pick" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void find(query);
          }}
          className="flex flex-col gap-[6px]"
        >
          <span className="flex items-center gap-[6px]">
            <span className={clsx(r.field, "flex-1")}>
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A saved insight's name" aria-label="Search PostHog's insights" className={r.fieldInput} />
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
          {hits && !hits.length && <p className="text-micro text-fg-subtle">No saved insight by that name.</p>}
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
      {busy && <p className="q-shimmer-text text-micro text-fg-muted">{busy} about a minute</p>}
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
