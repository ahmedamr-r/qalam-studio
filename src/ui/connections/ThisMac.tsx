import clsx from "clsx";
import { feedback } from "@/commands/feedback";
import type { HealthRow } from "@/health/doctor";
import { r } from "../recipes";
import { StatusDot } from "../viz";
import { fixHealth, refreshHealth, useHealth } from "../frame/useHealth";

/*
 * This Mac: one quiet line when all is well; otherwise a row for each thing that needs doing (the
 * engine, search, the meaning model, the inbox), the worst first, each with its fix.
 */

const TONE = { ok: "ok", warn: "warn", bad: "bad", off: "off" } as const;

/** `withEngine`: false where the Claude card above already says how the engine is. */
export function ThisMac({ withEngine = true }: { withEngine?: boolean }) {
  const { rows: all, loading } = useHealth();
  if (!all) return <div className={clsx(r.skeleton, "h-[40px] rounded-lg")} aria-hidden />;
  const left = withEngine ? all : all.filter((x) => x.id !== "engine");
  const rows: HealthRow[] = left.length ? left : [{ id: "all", dot: "ok", label: "This Mac", word: "All good" }];
  return (
    <section aria-label="This Mac" className="flex flex-col rounded-lg bg-panel py-[4px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      {rows.map((row) => (
        <Row key={row.id} row={row} />
      ))}
      <div className="flex justify-end px-[12px] pb-[4px]">
        <button type="button" disabled={loading} onClick={() => void refreshHealth()} className={clsx(r.buttonSm, r.buttonGhost)}>
          {loading ? "Checking…" : "Check again"}
        </button>
      </div>
    </section>
  );
}

function Row({ row }: { row: HealthRow }) {
  const fix = row.fix;
  return (
    <div className="flex items-start gap-[10px] px-[12px] py-[8px]">
      <StatusDot tone={TONE[row.dot]} className="mt-[6px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <p className="text-body text-fg">
          {row.label} <span className="text-fg-muted">· {row.word}</span>
        </p>
        {row.detail && <p className="text-caption text-fg-subtle">{row.detail}</p>}
      </div>
      {fix &&
        (fix.href ? (
          <a href={fix.href} target="_blank" rel="noreferrer" className={clsx(r.buttonSm, r.buttonSecondary)}>
            {fix.label}
          </a>
        ) : fix.command ? (
          <button
            type="button"
            className={clsx(r.buttonSm, r.buttonSecondary)}
            onClick={() =>
              void navigator.clipboard.writeText(fix.command!).then(
                () => feedback(`Copied: ${fix.command}`, { kind: "success", id: "connections.copy" }),
                () => feedback("Couldn't copy it", { kind: "error", id: "connections.copy" }),
              )
            }
          >
            {fix.label}
          </button>
        ) : (
          <button type="button" className={clsx(r.buttonSm, r.buttonSecondary)} onClick={() => void fixHealth(fix.id)}>
            {fix.label}
          </button>
        ))}
    </div>
  );
}
