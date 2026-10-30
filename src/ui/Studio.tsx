import { lazy, Suspense, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Check, MoreHorizontal } from "lucide-react";
import { loadEngine } from "@/engine/canvaskit";
import { measureTextProps } from "@/engine/text";
import { setTextMeasurer } from "@/doc/ops";
import { ensureYoga } from "@/doc/autolayout";
import { startAutoLayout } from "@/engine/autolayout-live";
import { startSystemSync } from "./systemSync";
import { installDevHooks } from "./devhooks";
import { ensureFonts } from "@/engine/fonts";
import { flushSystems, getSystem, pruneLooks, tokenSetFor, useSystems } from "@/design-system/registry";
import { useStudio } from "@/doc/store";
import { onComponentsPage, wholeDoc } from "@/doc/pages";
import type { Doc } from "@/doc/schema";
import { startPages } from "./pages";
import { startComponentsPage } from "./components-page/runtime";
import ComponentsPagePanel from "./components-page/Panel";
import { ensureMigrated, legacyProjectId } from "@/projects/migrate";
import { isProjectId, orgHref, projectHref, type Project, type ProjectType } from "@/projects/model";
import { flushDoc, openProject, startDocPersistence, updateProject, useSaveConflict } from "@/projects/session";
import { currentOrg } from "@/org/client";
import { ConflictBanner } from "@/org/ConflictBanner";
import { followOpenProject } from "@/org/live";
import { setChatScope } from "./ai/chats";
import { setKnowledgeScope } from "@/knowledge/store";
import { scheduleThumbnail } from "./projectThumbnail";
import { runCommand } from "@/commands/registry";
import TopBar from "./TopBar";
import Toolbar from "./Toolbar";
import CanvasView from "./CanvasView";
import LeftDock from "./LeftDock";
import { CommandItem, Menu } from "./menu";
import PropertiesPanel from "./PropertiesPanel";
import PrototypePanel from "./prototype/PrototypePanel";
import { usePlayParam, usePrototypeMode } from "./prototype/store";
import { setRightTab, useRightTab, type RightTab } from "./prototype/panel";
import { registerProtoPass } from "@/doc/proto-pass";
import { CommandKbd, Tip } from "./controls";
import Workspace from "./workspace/Workspace";
import { openWorkspace, useWorkspace } from "./workspace/store";
import ChatWindow from "./ai/ChatWindow";
import Toasts from "./toast";
import { r } from "./recipes";
import { armMotion, usePresence } from "./motion";
import { Splash } from "./brand";
import { CommandSurfaces } from "./surfaces";
import { frameCount, motionArmed } from "./shell";
import { useProjectType } from "@/projects/mode";
import { startDiscoveryStudio } from "./discovery/boot";
import DesignPanel from "./discovery/DesignPanel";
import { allCards } from "@/discovery/tree";
import { consumeHandoff, focusFromUrl, startServesTagging, syncServes } from "./discovery/handoff-consume";

// Prototype mode brings Motion and a TSX transpiler: loaded the first time it opens.
const PrototypeMode = lazy(() => import("./prototype/PrototypeMode"));

type Boot = { engine: boolean; layout: boolean; project: boolean };
type BootState = "loading" | "ready" | "error" | "missing";

class MissingProject extends Error {}

/**
 * One project's canvas. The project's document is loaded before the shell mounts; chats are
 * scoped to it; edits save back to it. `mode` is the route's kind: a project of the other kind
 * is sent to its own route.
 */
export default function Studio({ projectId, mode = "screens" }: { projectId: string; mode?: ProjectType }) {
  const [state, setState] = useState<BootState>("loading");
  const [error, setError] = useState("");
  const [boot, setBoot] = useState<Boot>({ engine: false, layout: false, project: false });

  useEffect(() => {
    // Screens keep a prototype over them (links, states, tracks); it's checked as the document opens.
    if (mode !== "discovery") registerProtoPass();
    const project = ensureMigrated()
      .then(() => (isProjectId(projectId) ? openProject(projectId) : null))
      .then((p) => {
        if (!p) throw new MissingProject();
        if (p.type !== mode) {
          window.location.replace(projectHref(p));
          return new Promise<never>(() => {});
        }
        setChatScope(p.id, legacyProjectId());
        setKnowledgeScope(p.id);
        setBoot((b) => ({ ...b, project: true }));
        return p;
      });
    Promise.all([
      project,
      loadEngine().then(() => setBoot((b) => ({ ...b, engine: true }))),
      ensureYoga().then(() => setBoot((b) => ({ ...b, layout: true }))),
    ])
      .then(([p]) => {
        setTextMeasurer(measureTextProps);
        startAutoLayout();
        // A Discovery board: its trees, gestures and commands (no design system to follow).
        if (p.type === "discovery") {
          installDevHooks();
          startDocPersistence(startDiscoveryStudio(p));
          keepCurrent();
          return setState("ready");
        }
        // Screens follow their design system live (components edited in Assets, by AI or in Tokens).
        startSystemSync();
        installDevHooks();
        startPages();
        startDocPersistence((doc) => {
          // The project's picture and counts are of every page's screens.
          scheduleThumbnail(wholeDoc(doc));
          if (p.type === "screens") syncServes(wholeDoc(doc));
        });
        keepCurrent();
        if (p.type === "system") openSystemProject(p);
        else followProjectSystem(p);
        // Screens projects keep a Components page, drawn live from their design system.
        if (p.type === "screens") startComponentsPage();
        setState("ready");
        // A solution sent here from a Discovery board ("Design this"), and the screens made for it.
        if (p.type === "screens") {
          startServesTagging();
          focusFromUrl();
          void consumeHandoff(p);
        }
        // Typefaces of the systems in use (the active one and any screen's), loaded in the background.
        const doc = wholeDoc(useStudio.getState().doc);
        const ids = new Set([useSystems.getState().activeId, ...doc.roots.map((id) => doc.nodes[id]?.meta.designSystem ?? "builtin")]);
        void ensureFonts([...ids].flatMap((id) => tokenSetFor(id).families()));
      })
      .catch((e: unknown) => {
        if (e instanceof MissingProject) return setState("missing");
        setError(e instanceof Error ? e.message : String(e));
        setState("error");
      });
  }, [projectId, mode]);

  // Transitions stay off until the shell has painted once (restored panels must not animate in).
  useEffect(() => {
    if (state === "ready") armMotion();
  }, [state]);

  return (
    <>
      {state === "ready" && <Shell />}
      {state === "ready" && <ConflictBanner />}
      <BootScreen state={state} boot={boot} error={error} />
    </>
  );
}

/**
 * Keep the open project current with changes made elsewhere (src/org/live.ts), and let the
 * desktop app finish saving before its window closes.
 */
function keepCurrent() {
  followOpenProject();
  (window as unknown as { __qalamBeforeClose?: () => Promise<void> }).__qalamBeforeClose = async () => {
    await flushDoc();
    await flushSystems();
  };
}

/**
 * The studio frame: top bar, left rail + panel, canvas, Design panel and status line. Row and
 * column sizes come from the layout vars in globals.css (--topbar-h, --rail-w, --footer-h…), which
 * Workspace and the canvas overlays read too. ⌘\ (view.uiHidden) leaves only the canvas.
 */
function Shell() {
  const uiHidden = useStudio((s) => s.view.uiHidden);
  const prototyping = usePrototypeMode((s) => s.open);
  usePlayParam();
  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
      <div
        className={clsx(
          "grid h-screen overflow-hidden bg-app",
          uiHidden ? "grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]" : "grid-cols-[auto_minmax(0,1fr)_var(--right-w)] grid-rows-[var(--topbar-h)_minmax(0,1fr)_var(--footer-h)]",
        )}
      >
        {!uiHidden && (
          <BootIn delay={0} className="col-span-3 flex min-w-0">
            <TopBar />
          </BootIn>
        )}
        {!uiHidden && (
          <BootIn delay={40} className="flex min-h-0">
            <LeftDock />
          </BootIn>
        )}
        <main className="q-boot relative min-h-0 min-w-0 bg-canvas" style={{ "--boot-delay": "80ms" } as CSSProperties}>
          <CanvasView />
          <ChatWindow />
          {!uiHidden && (
            <BootIn delay={120}>
              <Toolbar />
            </BootIn>
          )}
          <Toasts />
        </main>
        {!uiHidden && (
          <BootIn delay={80} className="flex min-h-0">
            <RightPanel />
          </BootIn>
        )}
        <Workspace />
        {!uiHidden && <StatusBar />}
      </div>
      <CommandSurfaces />
      {prototyping && (
        <Suspense fallback={null}>
          <PrototypeMode />
        </Suspense>
      )}
    </Tooltip.Provider>
  );
}

/** Chrome fades in once, staggered (top bar 0, rail 40, panels 80, toolbar 120ms). Opacity only: a
 *  transform here would become the containing block of the panels' positioned children. Chrome
 *  shown again later (⌘\) appears at once: the fade is decided when it mounts. */
function BootIn({ delay, className, children }: { delay: number; className?: string; children: ReactNode }) {
  const [boot] = useState(() => !motionArmed());
  return (
    <div className={clsx(boot && "q-boot", className)} style={{ "--boot-delay": `${delay}ms` } as CSSProperties}>
      {children}
    </div>
  );
}

const RIGHT_TABS: { value: RightTab; label: string }[] = [
  { value: "design", label: "Design" },
  { value: "prototype", label: "Prototype" },
];

/**
 * The right side: AI, tokens and knowledge live in the left rail. Its header is UI3's tab row,
 * Design and Prototype (⌥8 / ⌥9, ⇧E switches; no Inspect; a Discovery board has Design only),
 * and ⋯ holds the canvas view options.
 */
function RightPanel() {
  // A Discovery board and the Components page have no prototype.
  const board = useProjectType() === "discovery";
  const onComponents = useStudio((s) => onComponentsPage(s.doc));
  const designOnly = board || onComponents;
  const chosen = useRightTab((s) => s.tab);
  const tab: RightTab = designOnly ? "design" : chosen;
  const tabs = board ? [{ value: "design" as RightTab, label: "Board" }] : designOnly ? RIGHT_TABS.slice(0, 1) : RIGHT_TABS;
  return (
    <Tabs.Root value={tab} onValueChange={(v) => setRightTab(v as RightTab)} asChild>
      <aside className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-line-subtle bg-panel" aria-label={tabs.find((t) => t.value === tab)!.label}>
        <div className={clsx(r.panelHeader, "pl-[8px]")}>
          <Tabs.List aria-label="Panel" className="flex items-center gap-[2px]">
            {tabs.map((t) => (
              <Tabs.Trigger
                key={t.value}
                value={t.value}
                className="q-item flex h-[24px] items-center rounded-md px-[8px] text-caption font-semibold text-fg-subtle hover:bg-hover hover:text-fg-muted aria-selected:bg-active aria-selected:text-fg"
              >
                {t.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Menu
            label="View options"
            align="end"
            checks
            className="w-[232px]"
            trigger={
              <button type="button" aria-label="View options" className={clsx(r.iconButtonSm, "aria-expanded:bg-active aria-expanded:text-fg")}>
                <MoreHorizontal size={14} absoluteStrokeWidth strokeWidth={1.25} />
              </button>
            }
          >
            <CommandItem id="view.rulers" />
            <CommandItem id="view.outlines" />
            <CommandItem id="view.layout-grids" />
            <CommandItem id="view.pixel-grid" />
            <CommandItem id="view.pixel-preview" />
            <CommandItem id="view.snap-pixels" />
            <CommandItem id="view.agent-cursors" />
            {board ? <CommandItem id="view.sources" /> : <CommandItem id="view.route-parts" />}
          </Menu>
        </div>
        <Tabs.Content value="design" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
          <DesignOrCard />
        </Tabs.Content>
        {!designOnly && (
          <Tabs.Content value="prototype" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
            <PrototypePanel />
          </Tabs.Content>
        )}
      </aside>
    </Tabs.Root>
  );
}

/**
 * Discovery: a card panel for tree cards (and the tree when nothing is selected). The Components
 * page: the selected component's details. Otherwise the Design panel.
 */
function DesignOrCard() {
  const board = useProjectType() === "discovery";
  const onComponents = useStudio((s) => onComponentsPage(s.doc));
  return board ? <DesignPanel /> : onComponents ? <ComponentsPagePanel /> : <PropertiesPanel />;
}

function StatusBar() {
  const board = useProjectType() === "discovery";
  const onComponents = useStudio((s) => onComponentsPage(s.doc));
  const frames = useStudio((s) => (board ? allCards(s.doc).length : onComponents ? showcaseCards(s.doc) : frameCount(s.doc)));
  const selected = useStudio((s) => s.selection.length);
  return (
    <footer className={clsx(r.statusBar, "col-span-3 min-w-0")}>
      {/* The full wording is in the main menu's Help ▸ About. */}
      {!board && <span className="min-w-0 truncate">Qalam Studio · early preview</span>}
      <span className="grow" />
      <span className="tnum">
        {frames} {board ? (frames === 1 ? "card" : "cards") : onComponents ? (frames === 1 ? "component" : "components") : frames === 1 ? "frame" : "frames"}
        {selected > 0 && ` · ${selected} selected`}
      </span>
      <span aria-hidden className="text-fg-faint">
        ·
      </span>
      <SaveState />
      <span aria-hidden className="text-fg-faint">
        ·
      </span>
      {!board && (
        <>
          <span>Skia CanvasKit · WebGL</span>
          <span aria-hidden className="text-fg-faint">
            ·
          </span>
        </>
      )}
      <button
        type="button"
        onClick={() => runCommand("essential.shortcuts", "toolbar")}
        className="q-item -mx-[4px] inline-flex h-[20px] items-center gap-[6px] rounded-sm px-[4px] hover:bg-hover hover:text-fg-muted"
      >
        Shortcuts <CommandKbd command="essential.shortcuts" size="sm" />
      </button>
    </footer>
  );
}

/**
 * The document saves to this browser 400ms after an edit settles (store.ts); this mirrors that
 * debounce so "Saving…" shows while an edit is pending and "Saved" once it has been written.
 */
function SaveState() {
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let timer = 0;
    const off = useStudio.subscribe((s, prev) => {
      if (s.doc === prev.doc || s.txBase) return;
      setSaving(true);
      clearTimeout(timer);
      timer = window.setTimeout(() => setSaving(false), 500);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
  const conflict = useSaveConflict((s) => !!s.conflict);
  const [dir, setDir] = useState("");
  useEffect(() => void currentOrg().then((o) => setDir(o.dir), () => {}), []);
  return (
    <Tip label={conflict ? "Not saved: it changed elsewhere too (see the choice at the top)" : `Saved to ${dir || "your organization's folder"}`} side="top">
      <span className="inline-flex items-center gap-[6px]" aria-live="polite">
        <span aria-hidden className={clsx("size-[6px] rounded-full transition-colors duration-fast", conflict ? "bg-warning" : saving ? "bg-fg-faint" : "bg-success")} />
        {conflict ? "Not saved" : saving ? "Saving…" : "Saved"}
      </span>
    </Tip>
  );
}

/** Splash while CanvasKit and Yoga load; fades out over the shell once ready. Steps are real, not a fake percentage. */
function BootScreen({ state, boot, error }: { state: BootState; boot: Boot; error: string }) {
  const p = usePresence<HTMLDivElement>(state !== "ready");
  if (!p.mounted) return null;
  return (
    <div ref={p.ref} data-state={p.state} className="q-boot-screen fixed inset-0 z-[100] grid place-items-center bg-app text-fg">
      {state === "missing" ? (
        <ProjectMissing />
      ) : (
        <Splash error={state === "error" ? `Could not start the WebGL canvas: ${error}. Try a recent Chrome, Edge, Safari or Firefox.` : undefined}>
          <ul className="q-fade flex flex-col gap-[6px] text-caption text-fg-subtle">
            <BootStep done={boot.project}>Project</BootStep>
            <BootStep done={boot.engine}>Canvas engine (Skia CanvasKit)</BootStep>
            <BootStep done={boot.layout}>Layout engine</BootStep>
          </ul>
        </Splash>
      )}
    </div>
  );
}

/** A link to a project that isn't in this organization (deleted, or kept in another one). */
export function ProjectMissing() {
  return (
    <div className="flex w-[300px] flex-col items-center gap-[12px] text-center">
      <p className="text-title font-medium text-fg">Not found</p>
      <p className="text-body text-fg-muted">It isn't in this organization's folder. It was deleted, or it's still saved in a browser: the home can bring those in.</p>
      <a href={orgHref()} className={clsx(r.button, r.buttonSecondary)}>
        Back home
      </a>
    </div>
  );
}

/** A design-system project opens its own system, in the token editor, full screen. */
function openSystemProject(p: Project) {
  if (!p.systemId || !getSystem(p.systemId)) return;
  useSystems.getState().setActive(p.systemId);
  useWorkspace.setState({ size: "full" });
  openWorkspace("tokens", { systemId: p.systemId });
}

/**
 * A Screens project remembers which system new work uses, or that it uses none (Qalam AI picks
 * each brief's look): restored on open, and changing it in the project updates it.
 */
let followingSystem = false;
function followProjectSystem(p: Project) {
  const systems = useSystems.getState();
  if (p.systemId && getSystem(p.systemId) && systems.activeId !== p.systemId) systems.setActive(p.systemId);
  systems.setFreeform(!!p.freeform);
  // Looks no screen uses any more (deleted screens, a stopped run) go, unless the designer saved them.
  // Screens on every page keep their looks.
  const doc = wholeDoc(useStudio.getState().doc);
  pruneLooks(p.id, new Set(doc.roots.map((id) => doc.nodes[id]?.meta.designSystem).filter((x): x is string => !!x)));
  if (followingSystem) return;
  followingSystem = true;
  useSystems.subscribe((s, prev) => {
    if (s.activeId !== prev.activeId) void updateProject({ systemId: s.activeId }, { touch: false });
    if (s.freeform !== prev.freeform) void updateProject({ freeform: s.freeform || undefined }, { touch: false });
  });
}

function BootStep({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <li className={clsx("flex items-center justify-center gap-[6px] transition-colors duration-fast", done && "text-fg-muted")}>
      <span className="grid size-[12px] place-items-center">{done ? <Check size={12} className="q-fade text-success" /> : <span className="size-[4px] rotate-45 rounded-[1px] bg-fg-faint" />}</span>
      {children}
    </li>
  );
}

/** Components drawn on the Components page (its cards). */
const showcaseCards = (doc: Doc) => Object.values(doc.nodes).filter((n) => n.meta.showcase?.kind === "card").length;
