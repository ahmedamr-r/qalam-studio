import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import type { AIStatus } from "@/ai/client";
import { QalamAIGlyph } from "../brand";
import { Button } from "../controls";
import { r } from "../recipes";
import { PageFrame } from "../frame/PageFrame";

/**
 * Connections: what Qalam AI runs on, and the tools the organization's material comes from. For
 * now it says which engine is live and whether it's ready; the connectors follow.
 */
export default function ConnectionsPage() {
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const check = useCallback(() => {
    setChecking(true);
    void fetch("/api/status")
      .then((res) => res.json() as Promise<AIStatus>)
      .then(setStatus, () => setStatus(null))
      .finally(() => setChecking(false));
  }, []);
  useEffect(check, [check]);

  const cli = status?.backend === "cli";
  const ready = !!status?.ai && (!cli || (!!status.claude?.found && status.claude.signedIn !== false));
  const word = !status ? "Checking" : ready ? "Ready" : cli && !status.claude?.found ? "Claude Code not found" : cli ? "Claude Code signed out" : "Not set up";
  return (
    <PageFrame place="connections" crumbs={[{ label: "Connections" }]}>
      <div className={clsx(r.pageMain, "max-w-[880px]")}>
        <h1 className="text-heading font-semibold text-fg">Connections</h1>
        <section aria-label="Qalam AI" className="flex items-center gap-[12px] rounded-lg bg-panel p-[16px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          <span className="grid size-[32px] shrink-0 place-items-center rounded-md bg-raised">
            <QalamAIGlyph size={16} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <p className="flex items-center gap-[8px] text-body font-medium text-fg">
              Qalam AI
              <span className="inline-flex items-center gap-[6px] text-caption font-normal text-fg-muted">
                <span aria-hidden className={clsx("size-[6px] rounded-full", !status ? "bg-fg-faint" : ready ? "bg-success" : "bg-warning")} />
                {word}
              </span>
            </p>
            <p className="truncate text-caption text-fg-subtle">{status ? [cli ? "Claude Code on this Mac" : "Claude API key", status.model].join(" · ") : "…"}</p>
          </div>
          <Button variant="secondary" size="sm" disabled={checking} onClick={check}>
            {checking ? "Checking…" : "Check again"}
          </Button>
        </section>
      </div>
    </PageFrame>
  );
}
