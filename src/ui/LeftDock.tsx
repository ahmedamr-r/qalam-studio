import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";
import { BookOpen, CircleHelp, Files, Hexagon, Layers, ListTree, Maximize2, Moon, PanelLeftClose, Shapes, Sun, type LucideIcon } from "lucide-react";
import { useStudio, type LeftTab } from "@/doc/store";
import { runCommand } from "@/commands/registry";
import { IconBtn, Tip } from "./controls";
import { r } from "./recipes";
import { useSlidingIndicator } from "./motion";
import { useTheme } from "./theme";
import { QalamAIGlyph } from "./brand";
import { useExtractAsking, usePreviewedDraft } from "./ai/extractChat";
import { startChats, useChats } from "./ai/chats";
import LayersPanel, { LayersHeaderActions } from "./LayersPanel";
import PagesSection from "./PagesSection";
import ComponentsOutline from "./components-page/Outline";
import { onComponentsPage } from "@/doc/pages";
import ComponentsPanel from "./ComponentsPanel";
import KnowledgePanel from "./KnowledgePanel";
import TokensPanel from "./TokensPanel";
import { openWorkspace, useWorkspace } from "./workspace/store";
import "./knowledge/commands";
import { motionArmed, railMarked } from "./shell";
import { useProjectType } from "@/projects/mode";
import OutlinePanel from "./discovery/OutlinePanel";
import ContextPanel from "./discovery/ContextPanel";
import SourcesPanel, { SourcesHeaderActions } from "./discovery/SourcesPanel";
import { RailPlaces } from "./frame/OrgPlaces";
import { leaveTo } from "@/projects/session";

/**
 * Figma-style left navigation: a labelled rail that switches the panel beside it. The organization's
 * places come first (Home, Boards, Topics, Connections: links that save before they leave), then
 * everything about the file (layers, assets), then design systems (tokens), then AI and what it has
 * learned (Library, the Knowledge hub). Clicking the active item collapses the panel to give the
 * canvas room. The AI item opens the floating chat window over the canvas instead of a panel.
 * A 5px saffron nuqta marks the open panel and slides between items; the panel's width commits in
 * one layout change (the canvas resizes once) while its content slides in by transform.
 */

type RailTab = LeftTab | "ai";

type Item = { tab: RailTab; label: string; title: string; icon: LucideIcon | null; command: string };

const ITEMS: Item[] = [
  { tab: "layers", label: "Layers", title: "Layers", icon: Layers, command: "panels.layers" },
  { tab: "components", label: "Assets", title: "Assets", icon: Shapes, command: "panels.assets" },
  { tab: "tokens", label: "Tokens", title: "Tokens", icon: Hexagon, command: "panels.tokens" },
  { tab: "ai", label: "AI", title: "Qalam AI", icon: null, command: "ai.chat" },
  { tab: "knowledge", label: "Library", title: "Library", icon: BookOpen, command: "panels.knowledge" },
];

/** A Discovery board: its tree as an outline, its sources, Qalam AI, and the product's context (no assets or tokens). */
const BOARD_ITEMS: Item[] = [
  { tab: "layers", label: "Outline", title: "Outline", icon: ListTree, command: "panels.layers" },
  { tab: "sources", label: "Sources", title: "Sources", icon: Files, command: "panels.sources" },
  { tab: "ai", label: "AI", title: "Qalam AI", icon: null, command: "ai.chat" },
  { tab: "knowledge", label: "Context", title: "Product context", icon: BookOpen, command: "panels.knowledge" },
];

const useItems = () => (useProjectType() === "discovery" ? BOARD_ITEMS : ITEMS);

const MIN_W = 220;
const MAX_W = 520;
const DEFAULT_W = 248;
const STORE_KEY = "qalam/left-dock/v1";

interface Saved {
  /** "ai" in layouts saved before the chat became a floating window. */
  tab?: RailTab;
  open?: boolean;
  width?: number;
}

function readSaved(): Saved {
  try {
    return JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "{}") as Saved;
  } catch {
    return {};
  }
}

function writeSaved(patch: Saved) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ ...readSaved(), ...patch }));
  } catch {
    /* storage unavailable: the layout lasts for this session */
  }
}

const clampWidth = (w: number) => Math.min(MAX_W, Math.max(MIN_W, Math.round(w)));

export default function LeftDock() {
  const tab = useStudio((s) => s.leftTab);
  const open = useStudio((s) => s.leftOpen);
  const items = useItems();
  const board = items === BOARD_ITEMS;
  const onComponents = useStudio((s) => onComponentsPage(s.doc));
  const [width, setWidth] = useState(DEFAULT_W);
  // The panels share one scroll container: a new tab starts at its top, not at the old tab's offset.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [tab]);

  // Remember the panel, whether it's open and its width across reloads.
  useEffect(() => {
    // Chats load in the background so critiques started on the canvas land in them.
    startChats();
    const saved = readSaved();
    if (saved.width) setWidth(clampWidth(saved.width));
    if (saved.tab === "ai") {
      useStudio.setState({ leftTab: "layers", chatOpen: true });
      writeSaved({ tab: "layers" });
    } else if (saved.tab && items.some((i) => i.tab === saved.tab)) useStudio.setState({ leftTab: saved.tab, leftOpen: saved.open ?? true });
    else if (!items.some((i) => i.tab === useStudio.getState().leftTab)) useStudio.setState({ leftTab: "layers" });
    return useStudio.subscribe((s, prev) => {
      if (s.leftTab !== prev.leftTab || s.leftOpen !== prev.leftOpen) writeSaved({ tab: s.leftTab, open: s.leftOpen });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const item = items.find((i) => i.tab === tab) ?? items[0];
  return (
    <div className="flex min-h-0">
      <NavRail />
      {open && (
        <aside className="relative flex min-h-0 flex-col border-r border-line-subtle bg-panel" style={{ width }} aria-label={item.title}>
          {/* The width is already final (one canvas resize); only the content slides in. */}
          <div className="flex min-h-0 flex-1 flex-col transition-[opacity,translate] duration-moderate ease-out-quint starting:translate-x-[calc(var(--motion-shift-lg)*-1)] starting:opacity-0">
            <PanelHeader title={item.title}>
              {tab === "layers" && !board && !onComponents && <LayersHeaderActions />}
              {tab === "sources" && board && <SourcesHeaderActions />}
              {(tab === "tokens" || tab === "components") && (
                <IconBtn size="sm" label={tab === "tokens" ? "Open the token editor" : "Open the component library"} onClick={() => openWorkspace(tab)}>
                  <Maximize2 size={14} absoluteStrokeWidth strokeWidth={1.25} />
                </IconBtn>
              )}
              {tab === "knowledge" && !board && (
                <IconBtn size="sm" label="Open the Knowledge hub" command="knowledge.open" onClick={() => openWorkspace("knowledge")}>
                  <Maximize2 size={14} absoluteStrokeWidth strokeWidth={1.25} />
                </IconBtn>
              )}
              <IconBtn size="sm" label="Collapse panel" command="view.minimize-ui" onClick={() => useStudio.getState().setLeftOpen(false)}>
                <PanelLeftClose size={14} absoluteStrokeWidth strokeWidth={1.25} />
              </IconBtn>
            </PanelHeader>
            {/* Pages sit above the layers and keep their place while the layers scroll. */}
            {tab === "layers" && !board && <PagesSection />}
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
              {/* Tab switches: the new content rises in; the old one is gone at once. */}
              <RiseIn key={onComponents && tab === "layers" ? "components-page" : tab}>
                {tab === "layers" && (board ? <OutlinePanel /> : onComponents ? <ComponentsOutline /> : <LayersPanel />)}
                {tab === "components" && !board && <ComponentsPanel />}
                {tab === "tokens" && !board && <TokensPanel />}
                {tab === "knowledge" && (board ? <ContextPanel /> : <KnowledgePanel />)}
                {tab === "sources" && board && <SourcesPanel />}
              </RiseIn>
            </div>
          </div>
          <ResizeHandle
            width={width}
            onResize={setWidth}
            onDone={(w) => writeSaved({ width: w })}
            onReset={() => {
              setWidth(DEFAULT_W);
              writeSaved({ width: DEFAULT_W });
            }}
          />
        </aside>
      )}
    </div>
  );
}

/** A panel's content rises in when it mounts, except the one restored at boot (decided once, at mount). */
function RiseIn({ children }: { children: ReactNode }) {
  const [rise] = useState(motionArmed);
  return <div className={clsx(rise && "q-rise", "flex min-h-full flex-col")}>{children}</div>;
}

/** Title row shared by the side panels (Figma UI3: panel name, actions on the right). */
export function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={r.panelHeader}>
      <h2 className={r.panelTitle}>{title}</h2>
      <div className="flex items-center gap-[2px]">{children}</div>
    </div>
  );
}

function NavRail() {
  const items = useItems();
  const tab = useStudio((s) => s.leftTab);
  const open = useStudio((s) => s.leftOpen);
  const chatOpen = useStudio((s) => s.chatOpen);
  // The token editor and component library stand in for their panels while they're open.
  const workspace = useWorkspace((s) => s.kind);
  const wsTab: LeftTab | null = workspace;
  const draft = usePreviewedDraft();
  const asking = useExtractAsking();
  const aiBusy = useChats((s) => s.chats.some((c) => c.turns.some((t) => t.status === "running")));
  const badge: Partial<Record<RailTab, { label: string; busy?: boolean }>> = {
    tokens: draft ? { label: draft.phase === "running" ? "Previewing a draft design system that's still being written" : "Previewing a draft design system; save it in the AI chat" } : undefined,
    ai: aiBusy ? { label: "Qalam AI is working on a request", busy: true } : asking ? { label: "Qalam AI has questions before extracting" } : undefined,
  };

  // The marker follows the open panel: it slides on a click and jumps on keys (⌥1…⌥4) and restores.
  const marked = railMarked(workspace, open, tab);
  const clicked = useRef(false);
  // Decided once per switch: later re-renders must not flip it (that would cut the glide short).
  const instant = useMemo(() => !clicked.current, [marked]);
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLElement, HTMLSpanElement>(marked, { axis: "y", instant });
  useEffect(() => {
    const m = indicatorRef.current;
    if (clicked.current && m && marked) {
      // One bouncy landing after a click switch.
      delete m.dataset.landed;
      void m.offsetWidth;
      m.dataset.landed = "";
    }
    clicked.current = false;
  }, [marked, indicatorRef]);

  return (
    <nav ref={containerRef} aria-label="Panels" data-region="rail" className={r.rail}>
      <span
        ref={indicatorRef}
        aria-hidden
        className={clsx(r.railMarker, "data-[hidden]:opacity-0")}
        style={{ top: "calc(var(--h, 0px) / 2)" } as CSSProperties}
        onAnimationEnd={(e) => delete e.currentTarget.dataset.landed}
      />
      <RailPlaces current="goals" leave={(href) => void leaveTo(href)} />
      {items.map((i) => {
        const ai = i.tab === "ai";
        const active = ai ? chatOpen : marked === i.tab;
        const b = badge[i.tab];
        return (
          <Tip key={i.tab} label={active && (ai || !wsTab) ? `Hide ${i.title}` : i.title} command={i.command} side="right">
            <button
              type="button"
              aria-current={!ai && active ? "page" : undefined}
              aria-pressed={ai ? active : undefined}
              aria-label={b ? `${i.title}: ${b.label}` : i.title}
              data-indicator-active={!ai && active ? "" : undefined}
              onClick={() => {
                if (i.tab === "ai") useStudio.getState().toggleChat();
                else if (wsTab) {
                  useWorkspace.getState().close();
                  useStudio.getState().setLeftTab(i.tab);
                } else useStudio.getState().toggleLeftTab(i.tab);
                // Only a click that moves the marker glides it; one that leaves it put (the AI
                // item, the open workspace's own panel) must not leave the flag for the next key.
                const s = useStudio.getState();
                clicked.current = railMarked(useWorkspace.getState().kind, s.leftOpen, s.leftTab) !== marked;
              }}
              className={clsx(r.railItem, "aria-pressed:bg-active aria-pressed:text-fg")}
            >
              {i.icon ? <i.icon size={18} absoluteStrokeWidth strokeWidth={1.25} /> : <QalamAIGlyph size={16} className="my-[1px]" />}
              <span className={r.railLabel}>{i.label}</span>
              {b && (b.busy ? <span aria-hidden className={r.railBadge} /> : <span aria-hidden className="absolute top-[8px] right-[11px] size-[6px] rounded-full bg-fg shadow-[0_0_0_2px_var(--color-app)]" />)}
            </button>
          </Tip>
        );
      })}
      <span className="flex-1" />
      <RailFoot />
    </nav>
  );
}

/** Help (the shortcuts panel) and the theme, at the foot of the rail. */
function RailFoot() {
  const theme = useTheme((s) => s.resolved);
  return (
    <div className="flex flex-col items-center gap-[4px]">
      <Tip label="Keyboard shortcuts" command="essential.shortcuts" side="right">
        <button type="button" aria-label="Keyboard shortcuts" onClick={() => runCommand("essential.shortcuts", "toolbar")} className={r.iconButton}>
          <CircleHelp size={16} absoluteStrokeWidth strokeWidth={1.25} />
        </button>
      </Tip>
      <Tip label={theme === "dark" ? "Light theme" : "Dark theme"} command="view.theme-toggle" side="right">
        <button type="button" aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"} onClick={() => runCommand("view.theme-toggle", "toolbar")} className={r.iconButton}>
          {theme === "dark" ? <Moon size={16} absoluteStrokeWidth strokeWidth={1.25} /> : <Sun size={16} absoluteStrokeWidth strokeWidth={1.25} />}
        </button>
      </Tip>
    </div>
  );
}

/** Drag the panel's right edge to resize it; double-click to reset. The line shows after a beat. */
function ResizeHandle({ width, onResize, onDone, onReset }: { width: number; onResize: (w: number) => void; onDone: (w: number) => void; onReset: () => void }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const last = useRef(width);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={width}
      aria-valuemin={MIN_W}
      aria-valuemax={MAX_W}
      tabIndex={0}
      className="group absolute inset-y-0 -right-[3px] z-10 w-[6px] cursor-col-resize outline-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
        last.current = width;
        document.documentElement.style.cursor = "col-resize";
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        last.current = clampWidth(start.current.w + e.clientX - start.current.x);
        onResize(last.current);
      }}
      onPointerUp={() => {
        if (!start.current) return;
        start.current = null;
        document.documentElement.style.cursor = "";
        onDone(last.current);
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        // Keep the canvas from nudging the selection too.
        e.preventDefault();
        e.stopPropagation();
        const w = clampWidth(width + (e.key === "ArrowRight" ? 16 : -16));
        onResize(w);
        onDone(w);
      }}
    >
      <div className="mx-auto h-full w-[2px] bg-transparent transition-colors duration-fast group-hover:bg-line-strong group-hover:delay-150 group-focus-visible:bg-focus group-active:bg-focus group-active:delay-0" />
    </div>
  );
}
