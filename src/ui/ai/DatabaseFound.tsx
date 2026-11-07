import { useEffect, useState } from "react";
import clsx from "clsx";
import { Check, Database as DatabaseIcon } from "lucide-react";
import { numberLine } from "@/connectors/suggest";
import { formatValue } from "@/database/format";
import { nearestMetrics } from "@/database/near";
import { databaseDb, type ReadResult } from "@/org/database";
import { useDatabaseNumbers } from "../numbers/DatabasePick";

/*
 * Under a question about a number: the team's own numbers in its database that bear on it, read at
 * once by their fixed queries (no tokens; a reading from the last five minutes is given again), each
 * picked into the answer, never put there on its own. Only numbers checked on this computer read.
 */

const ICON = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const LINE = "q-item flex w-full flex-col items-start gap-[2px] rounded-md px-[6px] py-[4px] text-left hover:bg-hover disabled:opacity-60";

export function DatabaseFound({ question, lookFor, onFill, framed = false }: { question: string; lookFor?: string; onFill: (line: string) => void; framed?: boolean }) {
  const metrics = useDatabaseNumbers(true);
  const near = nearestMetrics(
    metrics.filter((m) => m.state === "ready"),
    `${question} ${lookFor ?? ""}`,
    { min: 1 },
  ).slice(0, 3);
  const ids = near.map((m) => m.metric.id).join(",");
  const [read, setRead] = useState<Record<string, ReadResult>>({});
  const [used, setUsed] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!ids) return;
    let alive = true;
    void databaseDb.read(ids.split(",")).then(
      (r) => alive && setRead(r),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [ids]);
  const found = near.flatMap((m) => {
    const r = read[m.metric.id];
    return r && "value" in r && r.value !== null ? [{ m, value: r.value }] : [];
  });
  if (!found.length) return null;
  return (
    // Framed when it's all there is under the question: the rule above it, as the tools' row has.
    <div role="group" aria-label="Numbers from your database" className={clsx("flex flex-col gap-[2px]", framed && "border-t border-line-subtle pt-[10px]")} onKeyDown={framed ? (e) => e.stopPropagation() : undefined}>
      <span className="flex items-center gap-[6px] px-[6px] text-micro text-fg-subtle">
        <DatabaseIcon {...ICON} /> From your database: pick what answers it
      </span>
      {found.map(({ m, value }) => (
        <button
          key={m.metric.id}
          type="button"
          disabled={used.has(m.metric.id)}
          className={LINE}
          onClick={() => {
            onFill(numberLine(value, { series: "", chart: m.metric.name, tool: "your database" }));
            setUsed((u) => new Set(u).add(m.metric.id));
          }}
        >
          <span className="flex w-full items-start gap-[6px] text-caption text-fg">
            {used.has(m.metric.id) && <Check {...ICON} className="mt-[2px] shrink-0 text-fg-muted" />}
            <span className={clsx("tnum min-w-0 font-medium")}>{formatValue(value, m.metric.unit)}</span>
          </span>
          <span className="w-full truncate text-micro text-fg-subtle">{m.metric.name}</span>
        </button>
      ))}
    </div>
  );
}
