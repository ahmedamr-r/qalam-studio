import { useEffect, useRef, useState, type FormEvent } from "react";
import clsx from "clsx";
import { COUNT_DAYS, eventRef } from "@/connectors/analytics";
import type { InsightNumbers } from "@/connectors/numbers";
import type { Hit } from "@/connectors/recipes";
import { numbersDb } from "@/org/connectors";
import { Button, Segmented, Spinner } from "../controls";
import { r } from "../recipes";

/**
 * For an account with no saved chart that fits: one of its events, counted over a range, the unique
 * users who did it. Code reads the count from the tool's own answer. What's picked reads again from
 * its `ref`, as a saved chart does.
 */
export function EventPicker({ tool, onPick, onCharts }: { tool: { id: string; label: string; via?: string | null }; onPick: (picked: { id: string; title: string; url?: string }, count: InsightNumbers["series"][number]) => void; onCharts?: () => void }) {
  const [days, setDays] = useState<string>(String(COUNT_DAYS[0]));
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (say: string, fn: () => Promise<void>) => {
    const slow = tool.via === "claude-code" ? " About a minute through Claude Code." : "";
    setBusy(`${say}${slow}`);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const find = (q: string) => run(`Looking at ${tool.label}'s events…`, async () => setHits((await numbersDb.events(q, tool.id)).hits));
  // Once, as it opens (a ref, as development runs effects twice).
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) void find("");
    started.current = true;
  }, []);
  const pick = (h: Hit) =>
    run(`Counting “${h.title}”…`, async () => {
      const id = eventRef({ event: h.title, ...(h.site ? { project: h.site } : {}), days: Number(days) });
      const read = await numbersDb.read(id, tool.id);
      const count = read.series[0];
      if (!count) throw new Error(`Nobody did that in the last ${days} days. Try a longer range.`);
      onPick({ id, title: h.title, ...(read.url ? { url: read.url } : {}) }, count);
    });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void find(query);
  };
  return (
    <div className="flex flex-col gap-[4px]">
      <div className="flex items-center gap-[6px]">
        <span className="min-w-0 flex-1 text-micro text-fg-subtle">Unique users who did it, in the last</span>
        <Segmented label="Over how many days" value={days} onChange={setDays} className="w-[132px]" options={COUNT_DAYS.map((d) => ({ value: String(d), label: `${d}d` }))} />
      </div>
      <form onSubmit={submit} onSubmitCapture={(e) => e.stopPropagation()} className="flex items-center gap-[6px]">
        <span className={clsx(r.field, "flex-1")}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="An event's name" aria-label={`Search ${tool.label}'s events`} className={r.fieldInput} />
        </span>
        <Button type="submit" size="sm" variant="secondary" disabled={!!busy}>
          Find
        </Button>
      </form>
      <div className="flex max-h-[180px] flex-col overflow-y-auto">
        {hits?.map((h) => (
          <button key={h.id} type="button" disabled={!!busy} onClick={() => void pick(h)} className="q-item flex w-full flex-col items-start gap-[2px] rounded-md px-[6px] py-[4px] text-left hover:bg-hover disabled:opacity-60">
            <span className="w-full truncate text-caption text-fg">{h.title}</span>
            {h.snippet && <span className="w-full truncate text-micro text-fg-subtle">{h.snippet}</span>}
          </button>
        ))}
      </div>
      {hits && !hits.length && !busy && !error && <p className="px-[6px] text-micro text-fg-subtle">{query.trim() ? "No event by that name." : `${tool.label} has no events yet.`}</p>}
      {busy && (
        <p className="inline-flex items-center gap-[6px] text-micro text-fg-muted">
          <Spinner size={12} /> <span className="q-shimmer-text">{busy}</span>
        </p>
      )}
      {error && <p className="text-micro text-danger">{error}</p>}
      {onCharts && (
        <button type="button" className={clsx(r.buttonSm, r.buttonGhost, "self-start")} onClick={onCharts}>
          Saved charts instead
        </button>
      )}
    </div>
  );
}
