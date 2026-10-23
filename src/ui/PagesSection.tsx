import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { create } from "zustand";
import { Check, ChevronDown, Component, LucideProvider, Plus } from "lucide-react";
import { useStudio } from "@/doc/store";
import { activePage, COMPONENTS_PAGE, pagesOf } from "@/doc/pages";
import type { Doc } from "@/doc/schema";
import { useProjectType } from "@/projects/mode";
import { useActiveSystem } from "@/design-system/registry";
import { IconBtn } from "./controls";
import { r } from "./recipes";
import { goToPage, movePageTo, newPage, renamePageTo } from "./pages";

/*
 * Figma UI3's pages list, above the layers: the project's pages in order (click to show one,
 * double-click to rename, drag to reorder, right-click for Rename and Delete), and in Screens
 * projects the Components page last, drawn live from the design system. Folding it leaves the
 * page showing in its header.
 */

const OPEN_KEY = "qalam/pages-open";

function readOpen(): boolean {
  try {
    return typeof window === "undefined" || window.localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

/** The list's own state: folded or not (remembered), and the page being renamed (the context menu asks too). */
export const usePagesUI = create<{ open: boolean; renaming: string | null }>(() => ({ open: readOpen(), renaming: null }));

function setOpen(open: boolean) {
  usePagesUI.setState({ open });
  try {
    window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* storage unavailable: folded for this session */
  }
}

export const renamePageInList = (id: string) => usePagesUI.setState({ open: true, renaming: id });

const row = "q-item relative flex h-[28px] cursor-default select-none items-center gap-[6px] rounded-md pr-[8px] pl-[4px] text-body text-fg-muted hover:bg-hover";

export default function PagesSection() {
  const raw = useStudio((s) => s.doc.pages);
  const page = useStudio((s) => activePage(s.doc));
  const list = useMemo(() => pagesOf({ nodes: {}, roots: [], pages: raw } as Doc), [raw]);
  const open = usePagesUI((s) => s.open);
  const screens = useProjectType() === "screens";
  const current = page === COMPONENTS_PAGE ? "Components" : list.find((p) => p.id === page)?.name;
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);

  const onDrop = () => {
    if (drag && drop && drag !== drop.id) {
      const from = list.findIndex((p) => p.id === drag);
      let to = list.findIndex((p) => p.id === drop.id) + (drop.after ? 1 : 0);
      if (from < to) to--;
      movePageTo(drag, to);
    }
    setDrag(null);
    setDrop(null);
  };

  return (
    <LucideProvider strokeWidth={1.25} absoluteStrokeWidth>
      <section aria-label="Pages" className="shrink-0 border-b border-line-subtle">
        <div className="flex h-[32px] items-center pr-[8px] pl-[12px]">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="q-item -ml-[4px] flex h-[24px] min-w-0 flex-1 items-center gap-[4px] rounded-md px-[4px] text-left text-caption font-semibold text-fg hover:bg-hover"
          >
            <span className="shrink-0">Pages</span>
            {!open && current && <span className="min-w-0 truncate font-normal text-fg-subtle">· {current}</span>}
            <ChevronDown size={12} className={clsx("q-chevron shrink-0 text-fg-subtle", !open && "-rotate-90")} />
          </button>
          <IconBtn size="sm" label="Add page" command="page.add" onClick={() => void newPage()}>
            <Plus size={14} />
          </IconBtn>
        </div>
        {open && (
          <div role="listbox" aria-label="Pages" className="flex max-h-[220px] flex-col overflow-y-auto px-[8px] pb-[6px]" onDragLeave={(e) => e.currentTarget === e.target && setDrop(null)}>
            {list.map((p) => (
              <PageRow
                key={p.id}
                id={p.id}
                name={p.name}
                active={p.id === page}
                dragging={drag === p.id}
                dropAt={drop?.id === p.id ? (drop.after ? "after" : "before") : null}
                onDragStart={() => setDrag(p.id)}
                onDragOver={(after) => drag && drag !== p.id && (drop?.id !== p.id || drop.after !== after) && setDrop({ id: p.id, after })}
                onDrop={onDrop}
                onDragEnd={() => {
                  setDrag(null);
                  setDrop(null);
                }}
              />
            ))}
            {screens && (
              <>
                <div className={clsx(r.divider, "mx-[4px] my-[4px]")} />
                <ComponentsRow active={page === COMPONENTS_PAGE} />
              </>
            )}
          </div>
        )}
      </section>
    </LucideProvider>
  );
}

function PageRow({
  id,
  name,
  active,
  dragging,
  dropAt,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  id: string;
  name: string;
  active: boolean;
  dragging: boolean;
  dropAt: "before" | "after" | null;
  onDragStart: () => void;
  onDragOver: (after: boolean) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const renaming = usePagesUI((s) => s.renaming === id);
  return (
    <div
      role="option"
      aria-selected={active}
      data-page-id={id}
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        const box = e.currentTarget.getBoundingClientRect();
        onDragOver(e.clientY > box.top + box.height / 2);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      onClick={() => goToPage(id)}
      onDoubleClick={() => usePagesUI.setState({ renaming: id })}
      title={renaming ? undefined : name}
      className={clsx(row, active && r.selectedRow, dragging && "opacity-50")}
    >
      {dropAt && (
        <span aria-hidden className={clsx("pointer-events-none absolute right-[4px] left-[8px] z-[1] h-[2px] bg-selection", dropAt === "before" ? "-top-px" : "-bottom-px")} />
      )}
      <span className="grid size-[16px] shrink-0 place-items-center text-fg">{active && <Check size={12} strokeWidth={1.5} />}</span>
      {renaming ? <RenameInput id={id} name={name} /> : <span className="min-w-0 flex-1 truncate" dir="auto">{name}</span>}
    </div>
  );
}

/** The Components page: the project's design system, every component and its variants, live. */
function ComponentsRow({ active }: { active: boolean }) {
  const system = useActiveSystem();
  return (
    <div
      role="option"
      aria-selected={active}
      data-components-page=""
      onClick={() => goToPage(COMPONENTS_PAGE)}
      title={`Every component of ${system.name}, drawn live from the design system`}
      className={clsx(row, active && r.selectedRow)}
    >
      <span className="grid size-[16px] shrink-0 place-items-center text-component">
        <Component size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate">Components</span>
      <span className="min-w-0 max-w-[50%] shrink truncate text-micro font-normal text-fg-subtle">{system.name}</span>
    </div>
  );
}

/** Double-click: rename in place. ↵ or blur commits, Esc cancels. */
function RenameInput({ id, name }: { id: string; name: string }) {
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    usePagesUI.setState({ renaming: null });
    if (value !== null && value.trim() && value.trim() !== name) renamePageTo(id, value);
  };
  return (
    <input
      autoFocus
      aria-label="Page name"
      defaultValue={name}
      dir="auto"
      spellCheck={false}
      maxLength={60}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      }}
      className="-ml-[4px] h-[22px] min-w-0 flex-1 rounded-xs bg-panel px-[4px] text-body font-medium text-fg shadow-focus-field outline-none focus-visible:outline-none"
    />
  );
}
