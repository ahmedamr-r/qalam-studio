import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import clsx from "clsx";
import { create } from "zustand";
import { ChevronRight, ChevronsDownUp, CircleAlert, Eye, EyeOff, Lock, LucideProvider, Search, TriangleAlert, Unlock, X } from "lucide-react";
import { useStudio, studio } from "@/doc/store";
import type { Doc, SceneNode } from "@/doc/schema";
import { reparent } from "@/doc/ops";
import { isDescendant, ancestors } from "@/doc/geometry";
import { useReservations } from "@/doc/reservations";
import { kb, registerCommands, useCommand } from "@/commands";
import { IconBtn, Kbd } from "./controls";
import { r } from "./recipes";
import { editNow } from "./useSelection";
import { layerKind } from "./layerKind";
import { QalamAIGlyph } from "./brand/ai-glyph";

/*
 * The Layers panel (Figma UI3): 28px rows, kind icons, the selected layer and its children tinted
 * like the canvas selection, hover synced with the canvas, drag to reorder or nest (an instant drop
 * line), double-click or ⌘R to rename in place, ⌘F to find by name or text, ⌥L to collapse all.
 * Rows never animate on re-render; only the chevron turns and a renamed or dropped row flashes.
 * Keyboard (ARIA tree): one tab stop on the focused row; ↑/↓ move and select, →/← open and close
 * or step in and out, Home/End jump, ↵/F2 rename, Space selects (⇧/⌘ Space adds), and Tab reaches
 * the row's lock and eye. Only the keyboard focuses rows: after a click, arrows still nudge, as in Figma.
 */

type DropPos = "before" | "after" | "inside";

interface LayersUI {
  /** Explicit expand (false) / collapse (true); absent = top level open, deeper closed. */
  collapsed: Record<string, boolean>;
  finding: boolean;
  query: string;
  /** A row that just changed (renamed, dropped) flashes once. */
  flash: string | null;
  /** The tree's single tab stop (roving tabindex): the last focused row, else the first selected. */
  focusId: string | null;
}

export const useLayersUI = create<LayersUI>(() => ({ collapsed: {}, finding: false, query: "", flash: null, focusId: null }));

let flashTimer: ReturnType<typeof setTimeout> | undefined;
function flashRow(id: string) {
  clearTimeout(flashTimer);
  useLayersUI.setState({ flash: null });
  requestAnimationFrame(() => useLayersUI.setState({ flash: id }));
  flashTimer = setTimeout(() => useLayersUI.setState({ flash: null }), 300);
}

/** ⌘F: open the find field in the Layers panel (showing the panel first). */
export function openFind() {
  const s = studio();
  if (s.leftTab !== "layers" || !s.leftOpen) s.setLeftTab("layers");
  useLayersUI.setState({ finding: true });
  // Already open: focus and select what's there, like a second ⌘F in Figma.
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLInputElement>("[data-layers-find]");
    el?.focus();
    el?.select();
  });
}

const closeFind = () => useLayersUI.setState({ finding: false, query: "" });

/** ⌥L: collapse every layer, top-level frames included. */
export function collapseLayers() {
  const { doc } = studio();
  useLayersUI.setState({ collapsed: Object.fromEntries(doc.roots.map((id) => [id, true])) });
}

registerCommands([
  {
    id: "edit.find",
    label: "Find layers",
    category: "edit",
    keys: [kb("⌘F")],
    run: openFind,
    keywords: ["search layers", "filter", "find"],
  },
  {
    id: "view.collapse-layers",
    label: "Collapse layers",
    category: "view",
    keys: [kb("⌥L")],
    run: collapseLayers,
    enabled: () => (studio().doc.roots.length ? true : "No layers yet"),
    keywords: ["fold", "tree"],
  },
]);

/** Names and text content matching a query, plus the layers that contain them (so the tree stays readable). */
function findLayers(doc: Doc, query: string): { match: Set<string>; shown: Set<string> } | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const match = new Set<string>();
  const shown = new Set<string>();
  for (const n of Object.values(doc.nodes)) {
    const text = n.type === "text" ? n.text.content : "";
    if (!n.name.toLowerCase().includes(q) && !text.toLowerCase().includes(q)) continue;
    match.add(n.id);
    shown.add(n.id);
    for (const a of ancestors(doc, n.id)) shown.add(a);
  }
  return { match, shown };
}

/** A visible row, top to bottom, as the tree's keyboard sees it. */
export interface TreeRow {
  id: string;
  level: number;
  /** Has children: true open, false closed; undefined = a leaf. */
  expanded?: boolean;
}

export type TreeKeyAction = { focus: number } | { expand: string; open: boolean } | null;

/** The ARIA tree pattern's movement keys, from the focused row `i` (pure, so it is tested). */
export function treeKey(rows: TreeRow[], i: number, key: string): TreeKeyAction {
  const row = rows[i];
  if (!row) return rows.length ? { focus: 0 } : null;
  switch (key) {
    case "ArrowDown":
      return i < rows.length - 1 ? { focus: i + 1 } : null;
    case "ArrowUp":
      return i > 0 ? { focus: i - 1 } : null;
    case "Home":
      return i > 0 ? { focus: 0 } : null;
    case "End":
      return i < rows.length - 1 ? { focus: rows.length - 1 } : null;
    case "ArrowRight":
      // Closed: open it. Open: step into its first child. A leaf: nothing.
      if (row.expanded === false) return { expand: row.id, open: true };
      return row.expanded && rows[i + 1]?.level === row.level + 1 ? { focus: i + 1 } : null;
    case "ArrowLeft": {
      if (row.expanded) return { expand: row.id, open: false };
      // Closed or a leaf: step out to the parent (the nearest row above, one level up).
      for (let j = i - 1; j >= 0; j--) if (rows[j].level < row.level) return { focus: j };
      return null;
    }
  }
  return null;
}

/** Search and collapse-all, for the Layers panel header (keys from the registry). */
export function LayersHeaderActions() {
  const finding = useLayersUI((s) => s.finding);
  return (
    <LucideProvider strokeWidth={1.25} absoluteStrokeWidth>
      <IconBtn size="sm" label="Find layers" command="edit.find" active={finding} onClick={() => (finding ? closeFind() : openFind())}>
        <Search size={14} />
      </IconBtn>
      <IconBtn size="sm" label="Collapse layers" command="view.collapse-layers" onClick={collapseLayers}>
        <ChevronsDownUp size={14} />
      </IconBtn>
    </LucideProvider>
  );
}

export default function LayersPanel() {
  const roots = useStudio((s) => s.doc.roots);
  // Layers AI is working on in place: shown dimmed and locked, like on the canvas.
  const reservations = useReservations((s) => s.list);
  const held = useMemo(() => new Set(reservations.flatMap((x) => x.nodeIds)), [reservations]);
  const finding = useLayersUI((s) => s.finding);
  const query = useLayersUI((s) => s.query);
  // The whole document is read only while finding, so the tree doesn't re-render on every edit.
  const doc = useStudio((s) => (query.trim() ? s.doc : null));
  const found = useMemo(() => (doc ? findLayers(doc, query) : null), [doc, query]);
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: DropPos } | null>(null);
  const frameKeys = useCommand("tool.frame")?.keys[0];
  const tree = useRef<HTMLDivElement>(null);
  // Focus is inside the tree: the tree itself stops being a tab stop, so ⇧Tab can leave it.
  const [inside, setInside] = useState(false);

  // Selecting on the canvas opens the layers around the selection (⌥L can still close them).
  useEffect(() => {
    const expand = (selection: string[]) => {
      const { doc: d } = studio();
      const { collapsed, focusId } = useLayersUI.getState();
      const open = selection.flatMap((id) => (d.nodes[id] ? ancestors(d, id) : [])).filter((a) => collapsed[a] !== false);
      if (open.length) useLayersUI.setState({ collapsed: { ...collapsed, ...Object.fromEntries(open.map((a) => [a, false])) } });
      // Tabbing into the tree lands on what is selected.
      if (selection.length && !selection.includes(focusId ?? "")) useLayersUI.setState({ focusId: selection[0] });
    };
    expand(studio().selection);
    return useStudio.subscribe((s, prev) => s.selection !== prev.selection && expand(s.selection));
  }, []);

  const onDrop = () => {
    if (!drag || !drop) return;
    const { doc: d } = studio();
    const target = d.nodes[drop.id];
    if (!target || drag === drop.id || isDescendant(d, drop.id, drag)) return;
    if (drop.pos === "inside" && target.type === "frame") {
      reparent([drag], target.id);
    } else {
      // Layers panel shows top-most first, so "before" in the list = higher index.
      const parentId = target.parentId;
      const list = (parentId ? d.nodes[parentId].children : d.roots).filter((id) => id !== drag);
      const i = list.indexOf(target.id);
      reparent([drag], parentId, drop.pos === "before" ? i + 1 : i);
    }
    flashRow(drag);
    setDrag(null);
    setDrop(null);
  };

  const rows = () => [...(tree.current?.querySelectorAll<HTMLElement>("[role=treeitem]") ?? [])];
  const focusRow = (el: HTMLElement | undefined) => {
    if (!el) return;
    useLayersUI.setState({ focusId: el.dataset.layerId ?? null });
    el.focus();
  };

  // The tree is reached with Tab: hand focus to the roving row (else the selection, else the top row).
  const onTreeFocus = (e: FocusEvent<HTMLDivElement>) => {
    setInside(true);
    if (e.target !== e.currentTarget) return;
    const all = rows();
    const { focusId } = useLayersUI.getState();
    const { selection } = studio();
    focusRow(all.find((el) => el.dataset.layerId === focusId) ?? all.find((el) => selection.includes(el.dataset.layerId ?? "")) ?? all[0]);
  };

  const onTreeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    // Only a row reached with the keyboard owns these keys.
    if (el.getAttribute("role") !== "treeitem" || !el.matches(":focus-visible") || e.altKey) return;
    const all = rows();
    const id = el.dataset.layerId!;
    const s = studio();
    const add = e.shiftKey || e.metaKey || e.ctrlKey;
    let handled = true;
    if (e.key === " ") {
      s.select(add ? (s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id]) : [id]);
    } else if (add && !(e.shiftKey && e.key.startsWith("Arrow"))) {
      // ⇧↵ (select parent), ⌘ arrows and the rest stay app shortcuts.
      handled = false;
    } else if (e.key === "Enter" || e.key === "F2") {
      if (el.getAttribute("aria-disabled") !== "true") s.setRenaming(id);
    } else {
      const action = treeKey(
        all.map((r) => ({
          id: r.dataset.layerId!,
          level: Number(r.getAttribute("aria-level")),
          expanded: r.hasAttribute("aria-expanded") ? r.getAttribute("aria-expanded") === "true" : undefined,
        })),
        all.indexOf(el),
        e.key,
      );
      if (!action) {
        // Arrows and Home/End at the tree's edges stay in the tree (they'd nudge the selection).
        handled = /^(Arrow|Home$|End$)/.test(e.key);
      } else if ("expand" in action) {
        useLayersUI.setState((u) => ({ collapsed: { ...u.collapsed, [action.expand]: !action.open } }));
      } else {
        const next = all[action.focus];
        focusRow(next);
        // Selection follows focus; ⇧ extends it.
        const nid = next.dataset.layerId!;
        s.select(e.shiftKey ? [...s.selection.filter((x) => x !== nid), nid] : [nid]);
      }
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const ctx: RowCtx = { held, found, drag, setDrag, drop, setDrop, onDrop };
  return (
    <LucideProvider strokeWidth={1.25} absoluteStrokeWidth>
      <div data-region="layers" aria-label="Layers" className="flex min-h-full flex-col" onDragEnd={() => (setDrag(null), setDrop(null))}>
        {finding && <FindBar count={found?.match.size ?? null} />}
        {!roots.length ? (
          <p className="px-[16px] py-[12px] text-caption text-fg-subtle">
            No layers yet. Draw a frame {frameKeys && <Kbd keys={frameKeys} size="sm" className="mx-[2px] align-[-3px]" />} or generate screens with Qalam AI.
          </p>
        ) : found && !found.match.size ? (
          <p className="px-[16px] py-[12px] text-caption text-fg-subtle">No layer is named or says &ldquo;{query.trim()}&rdquo;.</p>
        ) : (
          <div
            ref={tree}
            role="tree"
            aria-label="Layers"
            aria-multiselectable
            tabIndex={inside ? -1 : 0}
            onFocus={onTreeFocus}
            onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setInside(false)}
            onKeyDown={onTreeKeyDown}
            className="flex flex-col px-[8px] pt-[4px] pb-[12px] outline-none"
          >
            {[...roots].reverse().map((id) => (
              <LayerRow key={id} id={id} depth={0} busy={held.has(id)} ctx={ctx} />
            ))}
          </div>
        )}
      </div>
    </LucideProvider>
  );
}

/** ⌘F field: filters the tree by layer name and text; ↵ selects every match, Esc closes. */
function FindBar({ count }: { count: number | null }) {
  const query = useLayersUI((s) => s.query);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="sticky top-0 z-[2] bg-panel px-[8px] pt-[4px] pb-[4px]">
      <div className={clsx(r.field, "gap-[6px] pr-[2px] pl-[8px]")}>
        <Search size={12} className="shrink-0 text-fg-subtle" />
        <input
          ref={input}
          data-layers-find
          value={query}
          placeholder="Find layers and text"
          aria-label="Find layers"
          spellCheck={false}
          className={r.fieldInput}
          onChange={(e) => useLayersUI.setState({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              closeFind();
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Enter") {
              const found = findLayers(studio().doc, query);
              if (found?.match.size) studio().select([...found.match]);
            }
          }}
        />
        {count !== null && <span className="shrink-0 text-micro text-fg-subtle tnum">{count === 1 ? "1 match" : `${count} matches`}</span>}
        <button type="button" aria-label="Close find" onClick={closeFind} className="q-item grid size-[24px] shrink-0 place-items-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg">
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

interface RowCtx {
  held: Set<string>;
  found: { match: Set<string>; shown: Set<string> } | null;
  drag: string | null;
  setDrag: (id: string | null) => void;
  drop: { id: string; pos: DropPos } | null;
  setDrop: (d: { id: string; pos: DropPos } | null) => void;
  onDrop: () => void;
}

/** The part of a name that matched the find query, marked like a text selection. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-xs bg-accent-subtle text-fg">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function LayerRow({
  id,
  depth,
  busy,
  ctx,
}: {
  id: string;
  depth: number;
  /** AI is working on this layer or one it sits in: it can't be dragged, renamed, hidden or locked. */
  busy: boolean;
  ctx: RowCtx;
}) {
  const { held, found, drag, setDrag, drop, setDrop, onDrop } = ctx;
  const n = useStudio((s) => s.doc.nodes[id]) as SceneNode | undefined;
  const selected = useStudio((s) => s.selection.includes(id));
  const first = useStudio((s) => s.selection[0] === id);
  const hovered = useStudio((s) => s.hoverId === id);
  const renaming = useStudio((s) => s.renamingId === id);
  const collapsedFlag = useLayersUI((s) => s.collapsed[id]);
  const flash = useLayersUI((s) => s.flash === id);
  const query = useLayersUI((s) => s.query);
  const tabStop = useLayersUI((s) => s.focusId === id);
  const rowRef = useRef<HTMLDivElement>(null);

  // A layer selected on the canvas scrolls into view (no-op when it is already visible).
  useEffect(() => {
    if (first) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [first]);

  if (!n) return null;
  if (found && !found.shown.has(id)) return null;
  const kind = layerKind(n);
  const children = found ? n.children.filter((c) => found.shown.has(c)) : n.children;
  // Top-level frames start open, deeper ones closed; while finding, everything on the way to a match is open.
  const isCollapsed = children.length > 0 && !found && (collapsedFlag ?? depth > 0);
  const flags = n.meta.flags ?? [];
  const toggle = () => useLayersUI.setState((s) => ({ collapsed: { ...s.collapsed, [id]: !isCollapsed } }));
  const indent = 4 + depth * 16;
  const dropHere = drop?.id === id ? drop.pos : null;

  const row = (
    <div
      ref={rowRef}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={children.length ? !isCollapsed : undefined}
      data-layer-id={id}
      tabIndex={tabStop ? 0 : -1}
      onFocus={(e) => {
        if (e.target !== e.currentTarget) return;
        if (!tabStop) useLayersUI.setState({ focusId: id });
        // A click doesn't keep focus here, so the canvas keeps its keys (arrows nudge, Space pans).
        if (!e.currentTarget.matches(":focus-visible")) e.currentTarget.blur();
      }}
      draggable={!renaming && !busy}
      aria-disabled={busy || undefined}
      title={busy ? "Qalam AI is working on this. It unlocks when it finishes or you stop it." : undefined}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        setDrag(id);
      }}
      onDragOver={(e) => {
        if (!drag || drag === id || busy) return;
        e.preventDefault();
        const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const y = (e.clientY - box.top) / box.height;
        const pos: DropPos = n.type === "frame" && y > 0.3 && y < 0.7 ? "inside" : y < 0.5 ? "before" : "after";
        if (drop?.id !== id || drop.pos !== pos) setDrop({ id, pos });
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onMouseEnter={() => !busy && studio().setHover(id)}
      onMouseLeave={() => studio().setHover(null)}
      onClick={(e) => {
        const s = studio();
        if (e.shiftKey || e.metaKey || e.ctrlKey) s.select(selected ? s.selection.filter((x) => x !== id) : [...s.selection, id]);
        else s.select([id]);
      }}
      onDoubleClick={() => !busy && studio().setRenaming(id)}
      className={clsx(
        r.layerRow,
        "cursor-default select-none transition-opacity duration-fast focus-visible:-outline-offset-2",
        depth === 0 && n.type === "frame" && r.layerRowFrame,
        selected ? r.layerRowSelected : hovered && "bg-hover",
        drag === id && "opacity-50",
        busy && "opacity-60",
        dropHere === "inside" && "shadow-[inset_0_0_0_1.5px_var(--color-selection)]",
        flash && "q-flash-row",
      )}
      style={{ paddingLeft: indent }}
    >
      {dropHere && dropHere !== "inside" && <DropLine pos={dropHere} left={indent + 20} />}
      <button
        type="button"
        tabIndex={-1}
        aria-label={isCollapsed ? "Expand" : "Collapse"}
        className={clsx(r.layerTwisty, "rounded-xs hover:text-fg-muted", !children.length && "invisible")}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <ChevronRight size={12} className={clsx("transition-[rotate] duration-fast ease-out-quad", !isCollapsed && "rotate-90")} />
      </button>
      <kind.Icon size={14} aria-hidden className={clsx(r.layerIcon, kind.component && "!text-component", !n.visible && "opacity-50")} />
      {renaming ? (
        <RenameInput id={id} name={n.name} />
      ) : (
        <span className={clsx("min-w-0 flex-1 truncate text-left", !n.visible && "opacity-50")} dir="auto">
          {found?.match.has(id) ? <Highlight text={n.name} query={query} /> : n.name}
        </span>
      )}
      {flags.length > 0 &&
        (flags.some((f) => f.severity === "error") ? (
          <CircleAlert size={12} className="shrink-0 text-danger" aria-label={`${flags.length} issues`} />
        ) : (
          <TriangleAlert size={12} className="shrink-0 text-warning" aria-label={`${flags.length} issues`} />
        ))}
      {busy && held.has(id) && <QalamAIGlyph size={12} className="q-breathe shrink-0" />}
      <span className={clsx("flex h-full shrink-0 items-center", busy && "pointer-events-none invisible")}>
        <TailButton label={n.locked ? "Unlock" : "Lock"} shown={n.locked} tabbable={tabStop} onClick={() => editNow([id], (x) => void (x.locked = !x.locked))}>
          {n.locked ? <Lock size={12} /> : <Unlock size={12} />}
        </TailButton>
        <TailButton label={n.visible ? "Hide" : "Show"} shown={!n.visible} tabbable={tabStop} onClick={() => editNow([id], (x) => void (x.visible = !x.visible))}>
          {n.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </TailButton>
      </span>
    </div>
  );

  const kids =
    !isCollapsed &&
    [...children].reverse().map((c) => <LayerRow key={c} id={c} depth={depth + 1} busy={busy || held.has(c)} ctx={ctx} />);

  // A selected layer's children share a lighter tint, so the selected subtree reads as one block.
  return selected && kids && children.length ? (
    <div className={r.layerGroupSelected}>
      {row}
      {kids}
    </div>
  ) : (
    <>
      {row}
      {kids}
    </>
  );
}

/**
 * Lock / eye at the row's end: shown on hover or keyboard focus, or always while the layer is locked
 * or hidden. Only the focused row's pair is in the tab order (Tab from the row reaches them).
 */
function TailButton({
  label,
  shown,
  tabbable,
  onClick,
  children,
}: {
  label: string;
  shown: boolean;
  tabbable: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={tabbable ? 0 : -1}
      aria-label={label}
      className={clsx(
        "q-item grid size-[24px] place-items-center rounded-sm text-fg-subtle hover:bg-active hover:text-fg group-aria-selected/row:text-fg-muted focus-visible:-outline-offset-2",
        !shown && "invisible group-hover/row:visible group-focus-visible/row:visible group-has-[:focus-visible]/row:visible",
      )}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {children}
    </button>
  );
}

/** Where a dragged layer will land: a 2px selection-blue line with a ring at its start, like Figma. */
function DropLine({ pos, left }: { pos: "before" | "after"; left: number }) {
  return (
    <span aria-hidden className={clsx("pointer-events-none absolute right-[4px] z-[1] h-[2px] bg-selection", pos === "before" ? "-top-px" : "-bottom-px")} style={{ left }}>
      <span className="absolute -top-[3px] -left-[6px] size-[8px] rounded-full bg-panel shadow-[inset_0_0_0_2px_var(--color-selection)]" />
    </span>
  );
}

/** ⌘R / double-click: rename in place. ↵ or blur commits, Esc cancels. */
function RenameInput({ id, name }: { id: string; name: string }) {
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    const next = value?.trim();
    if (next && next !== name) {
      editNow([id], (x) => void (x.name = next));
      flashRow(id);
    }
    studio().setRenaming(null);
  };
  return (
    <input
      autoFocus
      aria-label="Layer name"
      defaultValue={name}
      dir="auto"
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        // ↵ / Esc hand focus back to the row, so the keyboard carries on through the tree.
        const row = e.currentTarget.closest<HTMLElement>("[role=treeitem]");
        if (e.key === "Enter") {
          finish(e.currentTarget.value);
          row?.focus();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
          row?.focus();
        }
      }}
      className="-ml-[4px] h-[22px] min-w-0 flex-1 rounded-xs bg-panel px-[4px] text-body font-medium text-fg shadow-focus-field outline-none focus-visible:outline-none"
    />
  );
}
