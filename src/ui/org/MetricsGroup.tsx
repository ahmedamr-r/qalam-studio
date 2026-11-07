import { useEffect, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { Pencil, X } from "lucide-react";
import { formatValue } from "@/database/format";
import type { MetricView } from "@/database/view";
import { databaseDb, loadDatabase, useDatabase } from "@/org/database";
import { placeHref } from "@/projects/model";
import { Button, IconBtn } from "../controls";
import { r } from "../recipes";
import { ago } from "../time";

/*
 * The team's numbers in the Company panel (hub/metrics.md): how each is counted, in its words, with
 * what it read last on this computer. A person fixes a number's words or takes it off; its query is
 * changed on Connections, where it's checked beside a sample again. New ones are drafted there too.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const STATE: Record<MetricView["state"], string> = {
  ready: "",
  check: "Not checked on this computer yet",
  elsewhere: "Checked on another database",
  dialect: "Written for another kind of database",
  unconnected: "No database connected on this computer",
};

function MetricForm({ m, onDone }: { m: MetricView["metric"]; onDone: (d: { name: string; means: string } | null) => void }) {
  const [name, setName] = useState(m.name);
  const [means, setMeans] = useState(m.means);
  const ready = name.trim() && means.trim();
  const keys = (e: KeyboardEvent, last: boolean) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onDone(null);
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && last && ready) {
      e.preventDefault();
      onDone({ name: name.trim(), means: means.trim() });
    }
  };
  return (
    <div className="q-sheet flex flex-col gap-[6px] rounded-lg p-[8px]">
      <label className={r.field}>
        <input aria-label="Its name" autoFocus dir="auto" className={r.fieldInput} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => keys(e, false)} />
      </label>
      <textarea aria-label="What it means" rows={2} dir="auto" className={clsx(r.textarea, "w-full text-body")} value={means} onChange={(e) => setMeans(e.target.value)} onKeyDown={(e) => keys(e, true)} />
      <div className="flex items-center justify-end gap-[6px]">
        <Button size="sm" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button size="sm" disabled={!ready} onClick={() => onDone({ name: name.trim(), means: means.trim() })}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

function MetricLine({ m, onError }: { m: MetricView; onError: (e: string | null) => void }) {
  const [fixing, setFixing] = useState(false);
  const x = m.metric;
  const edit = (e: Parameters<typeof databaseDb.edit>[0]) => databaseDb.edit(e).then(() => onError(null), (err: unknown) => onError(message(err)));
  if (fixing)
    return (
      <MetricForm
        m={x}
        onDone={(d) => {
          setFixing(false);
          if (d) void edit({ kind: "fix", id: x.id, name: d.name, means: d.means });
        }}
      />
    );
  return (
    <div className="group relative flex flex-col gap-[2px]">
      <p className="pr-[52px] text-body leading-[20px] text-fg" dir="auto">
        <span className="font-medium">{x.name}</span> <span className="text-fg-muted">{x.means}</span>
      </p>
      <p className="text-micro text-fg-subtle">{m.reading ? `${formatValue(m.reading.value, x.unit)}, read ${ago(m.reading.at)} on this computer` : STATE[m.state]}</p>
      <span className="absolute top-0 right-0 flex items-center gap-[2px] rounded-md bg-app opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <IconBtn size="sm" label={`Fix ${x.name}`} onClick={() => setFixing(true)}>
          <Pencil size={12} {...ICON} />
        </IconBtn>
        <IconBtn size="sm" label={`Take off ${x.name}`} onClick={() => void edit({ kind: "remove", id: x.id })}>
          <X size={12} {...ICON} />
        </IconBtn>
      </span>
    </div>
  );
}

export function MetricsGroup() {
  const { view, loaded } = useDatabase();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void loadDatabase(), []);
  const metrics = view?.metrics ?? [];
  return (
    <section aria-labelledby="space-numbers" className="flex flex-col gap-[8px]">
      <div className="flex h-[24px] items-center justify-between gap-[8px]">
        <h3 id="space-numbers" className={r.sectionTitle}>
          Numbers
        </h3>
        <a href={placeHref("connections")} className={clsx(r.buttonSm, r.buttonGhost)}>
          {metrics.length ? "Check them" : "Draft them"}
        </a>
      </div>
      <p className="text-caption text-fg-muted">How the team counts its business numbers in its own database, each with the query that reads it. A number reads on a computer once it&apos;s checked there beside a sample.</p>
      {loaded && !metrics.length && <p className="text-caption text-fg-subtle">Nothing yet. Connect your database on Connections and Qalam AI drafts the numbers it could track.</p>}
      {metrics.map((m) => (
        <MetricLine key={m.metric.id} m={m} onError={setError} />
      ))}
      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
