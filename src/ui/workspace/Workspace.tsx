import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronRight, Maximize2, Minimize2, Search, X } from "lucide-react";
import { dispatchKeyDown, formatKeys, kb } from "@/commands/registry";
import { useStudio } from "@/doc/store";
import { IconBtn } from "../controls";
import { usePresence, withViewTransition } from "../motion";
import { r } from "../recipes";
import { redoEdit, undoEdit } from "./editing";
import { trapTab } from "./focus-trap";
import { useWorkspace, type WorkspaceKind } from "./store";
import TokensWorkspace from "./TokensWorkspace";
import ComponentsWorkspace from "./ComponentsWorkspace";
import KnowledgeWorkspace from "./KnowledgeWorkspace";

/**
 * Host for the big editors (tokens, components). A large modal over the canvas, or full screen
 * beside the icon rail, like Figma's variables. While open, keyboard and clipboard events stay in
 * here, so Delete or ⌘V never reach the canvas behind it.
 *
 * Motion: the modal scales in from .96 over a fading scrim and plays both out on close; switching
 * between modal and full screen morphs the one panel with a view transition (instant without
 * support or with reduced motion). Focus returns to whatever opened the editor.
 *
 * Focus: the modal is a real one, so Tab cycles inside it. Full screen is a non-modal dialog: the
 * top bar, rail and status bar around it stay reachable by keyboard and assistive tech.
 */

const PANEL_ID = "qalam-workspace";

/**
 * Modal ↔ full screen, morphing the panel between the two layouts (the morph's rules live with the
 * other view transitions in globals.css). The scrim has its own name so it fades instead of popping.
 */
export function toggleWorkspaceSize() {
  const { size, setSize } = useWorkspace.getState();
  withViewTransition("workspace", document.getElementById(PANEL_ID), () => setSize(size === "full" ? "modal" : "full"));
}

export default function Workspace() {
  const kind = useWorkspace((s) => s.kind);
  const size = useWorkspace((s) => s.size);
  const uiHidden = useStudio((s) => s.view.uiHidden);
  const root = useRef<HTMLDivElement | null>(null);
  const p = usePresence<HTMLDivElement>(!!kind);
  // Keep the last editor on screen while its exit plays.
  const [shown, setShown] = useState<WorkspaceKind | null>(kind);
  if (kind && kind !== shown) setShown(kind);
  const open = !!kind;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.current?.focus({ preventScroll: true });
    // Events aimed at nothing in particular (focus fell back to <body>) must not drive the canvas.
    const guard = (e: Event) => {
      if (e.target !== document.body && e.target !== document.documentElement) return;
      e.stopImmediatePropagation();
      if (e instanceof KeyboardEvent && e.key === "Escape") useWorkspace.getState().close();
    };
    const types = ["keydown", "copy", "cut", "paste"] as const;
    for (const t of types) window.addEventListener(t, guard, true);
    // Anything that brings up another left panel or the AI chat (Generate, a token chip…) takes over from the editor.
    const unsub = useStudio.subscribe((s, prev) => {
      if (s.leftTab !== prev.leftTab || (s.chatOpen && !prev.chatOpen)) useWorkspace.getState().close();
    });
    return () => {
      for (const t of types) window.removeEventListener(t, guard, true);
      unsub();
      // Back to the button that opened the editor, unless something else has taken focus meanwhile.
      const now = document.activeElement;
      if (opener?.isConnected && (!now || now === document.body || root.current?.contains(now))) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!p.mounted || !shown) return null;
  const full = size === "full";
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const close = () => useWorkspace.getState().close();
  // The shell around the editor: the top bar stays visible (and, full screen, the rail); with the UI hidden (⌘\) there is none.
  const top = uiHidden ? "top-0" : "top-(--topbar-h)";

  return (
    <>
      {!full && (
        <div
          aria-hidden
          data-state={p.state}
          className={clsx("q-overlay fixed inset-x-0 bottom-0 z-40 bg-overlay", top)}
          style={{ viewTransitionName: "workspace-scrim" }}
          onPointerDown={close}
        />
      )}
      <div
        className={clsx(
          "pointer-events-none fixed z-40",
          full ? clsx(top, uiHidden ? "inset-x-0 bottom-0" : "right-0 bottom-(--footer-h) left-(--rail-w)") : clsx(top, "inset-x-0 bottom-0 grid place-items-center p-[24px]"),
        )}
      >
        <div
          ref={(el) => {
            root.current = el;
            p.ref(el);
          }}
          id={PANEL_ID}
          tabIndex={-1}
          role="dialog"
          aria-modal={full ? undefined : true}
          aria-label={shown === "tokens" ? "Tokens" : shown === "knowledge" ? "Knowledge hub" : "Components"}
          data-state={p.state}
          inert={p.state === "closed" || undefined}
          className={clsx(
            "q-dialog pointer-events-auto relative flex min-h-0 flex-col overflow-hidden bg-panel text-fg outline-none focus-visible:outline-none",
            full ? "h-full w-full border-l border-line-subtle" : "h-full max-h-[880px] w-full max-w-[1360px] rounded-xl shadow-modal",
          )}
          onKeyDown={(e) => {
            // Keys here never reach the canvas's shortcuts; app-wide commands (⌘K, ⌘\, ⌘S, F6…) still run.
            e.stopPropagation();
            if (dispatchKeyDown(e.nativeEvent, "field")) return;
            const t = e.target as HTMLElement;
            const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
            if (e.key === "Escape" && !e.nativeEvent.defaultPrevented && !typing) close();
            if (!full && root.current) trapTab(e, root.current);
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
              e.preventDefault();
              if (e.shiftKey) redoEdit();
              else undoEdit();
            }
          }}
          onKeyUp={stop}
          onCopy={stop}
          onCut={stop}
          onPaste={stop}
        >
          {shown === "tokens" ? <TokensWorkspace /> : shown === "knowledge" ? <KnowledgeWorkspace /> : <ComponentsWorkspace />}
        </div>
      </div>
    </>
  );
}

const ESC = formatKeys(kb("Esc"));

/** Title bar shared by the editors: name on the left, search and window controls on the right. */
export function WorkspaceHeader({
  icon,
  title,
  children,
  search,
  onSearch,
  placeholder = "Search",
  actions,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  search?: string;
  onSearch?: (q: string) => void;
  placeholder?: string;
  actions?: ReactNode;
}) {
  const size = useWorkspace((s) => s.size);
  const { close } = useWorkspace.getState();
  return (
    <header className="flex h-[48px] shrink-0 items-center gap-[8px] border-b border-line-subtle pr-[8px] pl-[16px]">
      <span className="grid size-[16px] shrink-0 place-items-center text-fg-subtle [&_svg]:size-[16px]" aria-hidden>
        {icon}
      </span>
      <h2 className="text-title font-semibold text-fg">{title}</h2>
      <div className="flex min-w-0 flex-1 items-center gap-[8px]">{children}</div>
      {onSearch && (
        <label className={clsx(r.field, "w-[240px] cursor-text")}>
          <Search size={12} absoluteStrokeWidth strokeWidth={1.25} className="shrink-0 text-fg-subtle" />
          <input
            value={search ?? ""}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              // Esc clears a query first; on an empty field it hands focus back to the editor, so the next Esc closes it.
              if (e.key !== "Escape") return;
              e.preventDefault();
              if (search) onSearch("");
              else document.getElementById(PANEL_ID)?.focus({ preventScroll: true });
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            className={clsx(r.fieldInput, "text-caption")}
          />
          {search && (
            <button type="button" aria-label="Clear search" onClick={() => onSearch("")} className={clsx(r.iconButtonBase, "-mr-[4px] size-[20px] text-fg-subtle")}>
              <X size={12} absoluteStrokeWidth strokeWidth={1.25} />
            </button>
          )}
        </label>
      )}
      {actions}
      <span className={clsx(r.vsep, "mx-[4px]")} aria-hidden />
      <IconBtn label={size === "full" ? "Exit full screen" : "Full screen"} onClick={toggleWorkspaceSize}>
        {size === "full" ? <Minimize2 size={14} absoluteStrokeWidth strokeWidth={1.25} /> : <Maximize2 size={14} absoluteStrokeWidth strokeWidth={1.25} />}
      </IconBtn>
      <IconBtn label="Close" keys={ESC} onClick={close}>
        <X size={16} absoluteStrokeWidth strokeWidth={1.25} />
      </IconBtn>
    </header>
  );
}

/** Sidebar heading row (Figma: "Collections", "Groups"). */
export function SideHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-[36px] shrink-0 items-center justify-between pr-[8px] pl-[16px]">
      <span className="text-caption font-semibold text-fg">{children}</span>
      {action}
    </div>
  );
}

/** Expand/collapse twisty for a sidebar row; an empty slot keeps rows aligned when there is nothing to expand. */
export function Twisty({ show, open, onClick }: { show: boolean; open?: boolean; onClick?: () => void }) {
  if (!show) return <span className="w-[16px] shrink-0" aria-hidden />;
  return (
    <button
      type="button"
      aria-label={open ? "Collapse" : "Expand"}
      aria-expanded={open}
      onClick={onClick}
      className="grid h-[24px] w-[16px] shrink-0 place-items-center rounded-sm text-fg-faint transition-colors duration-fast hover:text-fg-muted hover:duration-0"
    >
      <ChevronRight size={12} absoluteStrokeWidth strokeWidth={1.25} className={clsx("transition-[rotate] duration-fast ease-out-quad", open && "rotate-90")} />
    </button>
  );
}

/** Sidebar row: a selectable item with an optional count and leading slot. */
export function SideItem({
  selected,
  onClick,
  children,
  count,
  depth = 0,
  lead,
  trail,
  title,
}: {
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
  depth?: number;
  lead?: ReactNode;
  trail?: ReactNode;
  title?: string;
}) {
  return (
    <div
      className={clsx("q-item group/side mx-[8px] flex h-[28px] shrink-0 items-center gap-[4px] rounded-md", selected ? r.selectedRow : "text-fg-muted hover:bg-hover hover:text-fg")}
      style={{ paddingLeft: (lead ? 4 : 8) + depth * 16 }}
    >
      {lead}
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-current={selected ? "true" : undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-[8px] rounded-sm pr-[8px] text-left focus-visible:outline-offset-[-2px]"
      >
        <span className="min-w-0 flex-1 truncate text-body">{children}</span>
        {count !== undefined && <span className={clsx("text-micro tnum", selected ? "text-fg-muted" : "text-fg-subtle")}>{count}</span>}
      </button>
      {trail}
    </div>
  );
}
