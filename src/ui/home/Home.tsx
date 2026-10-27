import { useCallback, useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Frame, MoreHorizontal, Network, Palette } from "lucide-react";
import type { AIStatus } from "@/ai/client";
import { getSystem } from "@/design-system/registry";
import { projectHref, statusOf, type Project, type ProjectType } from "@/projects/model";
import { createProject } from "@/projects/session";
import { deleteProject, hasLegacyChanges, importLegacy, listProjects, renameProjectById } from "@/projects/library";
import { QalamMark, Wordmark } from "../brand";
import { Button } from "../controls";
import { Menu, MenuItem, MenuSeparator } from "../menu";
import { r } from "../recipes";
import { confirmDialog, DialogHost, promptDialog } from "../surfaces/dialog";

/**
 * The projects home: start a design system (the brand interview), a screens canvas or a Discovery
 * board (the product's opportunity tree), and reopen recent work. Unfinished interviews show their
 * step, so this is also the resume list. Projects are saved in this browser.
 */

const TYPE_LABEL: Record<ProjectType, string> = { system: "Design system", screens: "Screens", discovery: "Discovery" };
const TYPE_ICON: Record<ProjectType, typeof Frame> = { system: Palette, screens: Frame, discovery: Network };

const ICON = { size: 16, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export default function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [legacy, setLegacy] = useState(false);

  const refresh = useCallback(() => {
    void listProjects()
      .then((list) => {
        setProjects(list);
        setLegacy(hasLegacyChanges());
      })
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", refresh);
    };
  }, [refresh]);

  const start = async (type: ProjectType) => {
    const p = await createProject(type, type === "system" ? "Untitled system" : type === "discovery" ? "Untitled discovery" : "Untitled");
    window.location.assign(projectHref(p));
  };

  return (
    <Tooltip.Provider delayDuration={500}>
      <div className="min-h-screen bg-app text-fg">
        <header className="flex h-[48px] items-center gap-[10px] border-b border-line-subtle px-[16px]">
          <QalamMark size={20} />
          <Wordmark />
        </header>
        <main className="mx-auto flex w-full max-w-[1080px] flex-col gap-[32px] px-[16px] py-[32px]">
          <section aria-labelledby="start" className="flex flex-col gap-[12px]">
            <h1 id="start" className="text-heading font-medium">
              Start something
            </h1>
            <div className="grid gap-[12px] sm:grid-cols-3">
              <StartTile
                icon={<Palette {...ICON} />}
                title="Design system"
                body="Tell Qalam AI about your brand. It proposes three directions you can shape on real screens, then saves your tokens."
                onClick={() => void start("system")}
              />
              <StartTile icon={<Frame {...ICON} />} title="Screens" body="A blank canvas for screens and flows, with Qalam AI and your systems." onClick={() => void start("screens")} />
              <StartTile
                icon={<Network {...ICON} />}
                title="Discovery"
                body="Map the outcome you're after, your customers' needs and the solutions to try, as a tree. Start from six questions, your research or a blank board."
                onClick={() => void start("discovery")}
              />
            </div>
          </section>

          <ClaudeNotice />

          {legacy && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-[12px] rounded-lg bg-raised px-[12px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
              <p className="text-body text-fg-muted">An older tab saved changes to your first project after it moved here.</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void importLegacy().then((p) => {
                    if (p) refresh();
                  })
                }
              >
                Import as a new project
              </Button>
            </div>
          )}

          <section aria-labelledby="recent" className="flex flex-col gap-[12px]">
            <h2 id="recent" className="text-title font-medium">
              Recent
            </h2>
            {projects === null ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[16px]" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <div key={i} className={clsx(r.skeleton, "aspect-[4/3] rounded-lg")} />
                ))}
              </div>
            ) : projects.length === 0 ? (
              <p className="text-body text-fg-muted">No projects yet. Start a design system, a screens canvas or a Discovery board above.</p>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[16px]">
                {projects.map((p) => (
                  <li key={p.id}>
                    <ProjectCard p={p} onChanged={refresh} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="text-caption text-fg-subtle">Projects are saved in this browser.</p>
        </main>
      </div>
      <DialogHost />
    </Tooltip.Provider>
  );
}

type ClaudeCheck = NonNullable<AIStatus["claude"]>;

/** Qalam AI runs on the user's own Claude Code: say what to do first when it's missing or signed out. */
function ClaudeNotice() {
  const [claude, setClaude] = useState<ClaudeCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const check = useCallback(() => {
    setChecking(true);
    void fetch("/api/status")
      .then((r) => r.json() as Promise<AIStatus>)
      .then((s) => setClaude(s.backend === "cli" ? (s.claude ?? null) : null))
      .catch(() => setClaude(null))
      .finally(() => setChecking(false));
  }, []);
  useEffect(check, [check]);
  if (!claude || (claude.found && claude.signedIn !== false)) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-[12px] rounded-lg bg-raised px-[12px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <p className="text-body text-fg-muted">
        {claude.found ? (
          <>
            Qalam AI runs on your own Claude Code, which isn't signed in. Run <code className="font-mono text-fg">claude auth login</code> in a terminal, then check again.
          </>
        ) : (
          <>
            Qalam AI runs on your own Claude Code, which isn't installed.{" "}
            <a className="text-fg underline" href="https://code.claude.com/docs/en/quickstart" target="_blank" rel="noreferrer">
              Install it
            </a>
            , run <code className="font-mono text-fg">claude auth login</code>, then check again.
          </>
        )}
      </p>
      <Button variant="secondary" size="sm" disabled={checking} onClick={check}>
        {checking ? "Checking…" : "Check again"}
      </Button>
    </div>
  );
}

function StartTile({ icon, title, body, onClick }: { icon: ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="q-item q-press flex items-start gap-[12px] rounded-lg bg-panel p-[16px] text-left shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover"
    >
      <span className="grid size-[32px] shrink-0 place-items-center rounded-md bg-raised text-fg">{icon}</span>
      <span className="flex flex-col gap-[4px]">
        <span className="text-body font-medium text-fg">{title}</span>
        <span className="text-caption text-fg-muted">{body}</span>
      </span>
    </button>
  );
}

function ProjectCard({ p, onChanged }: { p: Project; onChanged: () => void }) {
  const href = projectHref(p);
  const TypeIcon = TYPE_ICON[p.type];
  const rename = async () => {
    const name = await promptDialog({ title: "Rename project", defaultValue: p.name, confirmLabel: "Rename", validate: (v) => (v.trim() ? null : "Name can't be empty") });
    if (name) await renameProjectById(p.id, name);
    onChanged();
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete “${p.name}”?`,
      body: p.type === "discovery" ? "Its board, sources and chats are removed from this browser. This can't be undone." : "Its canvas and chats are removed from this browser. This can't be undone.",
      confirmLabel: "Delete project",
      danger: true,
    });
    if (!ok) return;
    const system = p.type === "system" && p.systemId ? getSystem(p.systemId) : undefined;
    const removeSystem = system
      ? await confirmDialog({
          title: `Also remove “${system.name}” from your systems?`,
          body: "Screens in other projects that use it switch to the built-in system.",
          confirmLabel: "Remove system",
          cancelLabel: "Keep system",
          danger: true,
        })
      : false;
    await deleteProject(p, { removeSystem });
    onChanged();
  };
  return (
    <div className="flex flex-col gap-[8px]">
      <a
        href={href}
        aria-label={`Open ${p.name}`}
        className="q-item grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-stage shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
      >
        {p.thumbnail ? (
          <img src={p.thumbnail} alt="" className="max-h-[86%] max-w-[86%] rounded-sm object-contain" />
        ) : (
          <span className="text-fg-faint">
            <TypeIcon size={24} absoluteStrokeWidth strokeWidth={1.25} />
          </span>
        )}
      </a>
      <div className="flex items-start justify-between gap-[8px] px-[2px]">
        <div className="min-w-0">
          <a href={href} className="block truncate text-body font-medium text-fg hover:underline">
            {p.name}
          </a>
          <p className="flex items-center gap-[6px] text-caption text-fg-muted">
            <span>{TYPE_LABEL[p.type]}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{p.type === "system" ? statusOf(p) : `${statusOf(p)} · ${ago(p.updatedAt)}`}</span>
          </p>
        </div>
        <Menu
          label="Project actions"
          align="end"
          className="w-[180px]"
          trigger={
            <button type="button" aria-label={`Actions for ${p.name}`} className={clsx(r.iconButton, "shrink-0")}>
              <MoreHorizontal {...ICON} />
            </button>
          }
        >
          <MenuItem onSelect={() => window.location.assign(href)}>Open</MenuItem>
          <MenuItem onSelect={() => void rename()}>Rename…</MenuItem>
          <MenuSeparator />
          <MenuItem danger onSelect={() => void remove()}>
            Delete…
          </MenuItem>
        </Menu>
      </div>
    </div>
  );
}

const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }) : null;

/** "just now", "5 minutes ago", "yesterday"… */
export function ago(ts: number, now = Date.now()): string {
  const s = Math.round((ts - now) / 1000);
  const abs = Math.abs(s);
  if (!rtf || abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
