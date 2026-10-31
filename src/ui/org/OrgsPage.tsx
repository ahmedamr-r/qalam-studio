import { useEffect, useState } from "react";
import clsx from "clsx";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ArrowRight, FolderOpen, Plus } from "lucide-react";
import { CantReachFiles, listOrgs, type OrgRef } from "@/org/client";
import { openOrgHref, welcomeHref } from "@/projects/model";
import { QalamMark } from "../brand";
import { Button } from "../controls";
import { r } from "../recipes";
import { DialogHost } from "../surfaces/dialog";
import Toasts from "../toast";
import { SpaceTile } from "../frame/OrgPlaces";
import { bootRetryDelay } from "../welcome/steps";
import { openFolderAsOrg } from "./OrgSwitcher";

/*
 * Where Qalam opens: the organizations on this computer, the one opened last first. Opening one
 * lands on the canvas its last tab was on, else its own; a new one goes through the welcome, and
 * any folder can be one. With none yet, the welcome.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

type State = { kind: "loading" } | { kind: "ready"; orgs: OrgRef[]; current: string | null } | { kind: "error"; message: string };

export default function OrgsPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const load = (attempt = 0) =>
    void listOrgs().then(
      ({ orgs, current }) => {
        if (!orgs.length) return window.location.replace(welcomeHref());
        setState({ kind: "ready", orgs, current });
      },
      (e: unknown) => {
        // The desktop app's core may still be starting (503) or restarting (502): wait for it a while, as boot does.
        const wait = e instanceof CantReachFiles && (e.status === 503 || e.status === 502) ? bootRetryDelay(attempt) : null;
        if (wait !== null) return void setTimeout(() => load(attempt + 1), wait);
        setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      },
    );
  useEffect(() => {
    document.title = "Qalam";
    load();
  }, []);

  const orgs = state.kind === "ready" ? [...state.orgs].sort((a, b) => Number(b.id === state.current) - Number(a.id === state.current)) : [];
  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
      <div className="grid h-screen grid-rows-[var(--topbar-h)_minmax(0,1fr)] overflow-hidden bg-app text-fg">
        <header className={clsx(r.topBar, "min-w-0")} data-region="topbar">
          <span className={r.brandCell}>
            <QalamMark size={20} />
          </span>
          <span className="px-[8px] text-body font-medium text-fg">Organizations</span>
        </header>
        <div className="relative min-h-0">
          <main className="h-full overflow-y-auto">
            <div className={clsx(r.pageMain, "max-w-[640px] gap-[20px] pt-[48px]")}>
              <h1 className="text-display font-semibold text-fg">Your organizations</h1>
              {state.kind === "error" ? (
                <div className="flex flex-col items-start gap-[10px]">
                  <p className="text-body text-fg-muted">Qalam can&apos;t reach your files. {state.message}</p>
                  <Button variant="secondary" size="sm" onClick={() => load()}>
                    Try again
                  </Button>
                </div>
              ) : state.kind === "loading" ? (
                <div className={clsx(r.skeleton, "h-[64px] rounded-lg")} aria-hidden />
              ) : (
                <ul className="flex flex-col gap-[8px]">
                  {orgs.map((o) => (
                    <li key={o.id} className="flex">
                      <OrgCard org={o} last={o.id === state.current} />
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-[8px]">
                <Button variant="secondary" size="sm" onClick={() => window.location.assign(welcomeHref("new"))}>
                  <Plus {...ICON} className="mr-[6px]" />
                  New organization…
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void openFolderAsOrg()}>
                  <FolderOpen {...ICON} className="mr-[6px]" />
                  Open a folder…
                </Button>
              </div>
            </div>
          </main>
          <Toasts />
        </div>
      </div>
      <DialogHost />
    </Tooltip.Provider>
  );
}

function OrgCard({ org, last }: { org: OrgRef; last: boolean }) {
  return (
    <a
      href={openOrgHref(org.id)}
      className="q-item q-press group flex flex-1 items-center gap-[12px] rounded-lg bg-panel px-[14px] py-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover"
    >
      <SpaceTile name={org.name || "·"} size="lg" />
      <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="flex items-center gap-[8px]">
          <span className="truncate text-title font-medium text-fg">{org.name}</span>
          {org.shape === "solo" && <span className="shrink-0 text-caption text-fg-subtle">On your own</span>}
          {last && <span className="shrink-0 text-caption text-fg-subtle">Opened last</span>}
        </span>
        <span className="truncate text-caption text-fg-subtle" title={org.dir}>
          {org.dir}
        </span>
      </span>
      <ArrowRight {...ICON} className="shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
    </a>
  );
}
