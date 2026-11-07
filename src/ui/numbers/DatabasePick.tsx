import { useEffect, useState } from "react";
import clsx from "clsx";
import { Database as DatabaseIcon, X } from "lucide-react";
import { formatValue } from "@/database/format";
import { nearestMetrics } from "@/database/near";
import type { MetricView } from "@/database/view";
import { databaseDb, loadDatabase, useDatabase } from "@/org/database";
import { placeHref } from "@/projects/model";
import { IconBtn, Spinner } from "../controls";
import { r } from "../recipes";

/*
 * A goal's number from the team's database: its confirmed numbers, the nearest the goal's metric
 * first. One that reads on this computer is read fresh by its fixed query when picked; one that
 * doesn't yet says why, with the way to Connections. No model is called.
 */

const ICON = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const WHY: Record<MetricView["state"], string> = {
  ready: "",
  check: "check it in Connections first",
  elsewhere: "checked on another database",
  dialect: "for another kind of database",
  unconnected: "connect your database first",
};

/** The project's numbers in its database, loaded once when `on` (the database switch): none when it's off. */
export function useDatabaseNumbers(on = true): MetricView[] {
  const metrics = useDatabase((s) => s.view?.metrics);
  const loaded = useDatabase((s) => s.loaded);
  useEffect(() => {
    if (on && !loaded) void loadDatabase();
  }, [on, loaded]);
  return on ? (metrics ?? []) : [];
}

export function DatabasePick({ words, goal, onPick, onCancel }: { words: string; goal?: string; onPick: (m: MetricView, value: number | null, at: number) => void; onCancel: () => void }) {
  const metrics = useDatabaseNumbers();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = nearestMetrics(metrics, words, { goal });
  const pick = async (m: MetricView) => {
    setBusy(m.metric.id);
    setError(null);
    try {
      const got = (await databaseDb.read([m.metric.id], true))[m.metric.id];
      if (!got || "error" in got) throw new Error(got?.error ?? "It didn't read.");
      onPick(m, got.value, got.at);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-[4px]">
      <span className="flex items-center gap-[6px]">
        <span className="min-w-0 flex-1 text-micro text-fg-subtle">Your team's numbers, read from your database by the query each was checked with.</span>
        <IconBtn size="sm" label="Cancel" onClick={onCancel}>
          <X {...ICON} />
        </IconBtn>
      </span>
      {list.map((m) => (
        <button key={m.metric.id} type="button" disabled={!!busy || m.state !== "ready"} onClick={() => void pick(m)} className={clsx("q-item flex flex-col items-start rounded-md px-[6px] py-[4px] text-left hover:bg-hover disabled:hover:bg-transparent")}>
          <span className="flex w-full items-center gap-[6px] text-caption text-fg">
            <DatabaseIcon {...ICON} className="shrink-0 text-fg-subtle" />
            <span className="min-w-0 flex-1 truncate">{m.metric.name}</span>
            {busy === m.metric.id ? <Spinner size={12} /> : m.reading ? <span className="tnum text-fg-muted">{formatValue(m.reading.value, m.metric.unit)}</span> : null}
          </span>
          <span className="w-full truncate text-micro text-fg-subtle">{m.state === "ready" ? m.metric.means : WHY[m.state]}</span>
        </button>
      ))}
      {!list.length && <p className="text-micro text-fg-subtle">No numbers yet.</p>}
      {list.some((m) => m.state !== "ready") && (
        <a href={placeHref("connections")} className={clsx(r.buttonSm, r.buttonGhost, "self-start")}>
          Check them in Connections
        </a>
      )}
      {error && <p className="text-micro text-danger">{error}</p>}
    </div>
  );
}
