import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Search, X } from "lucide-react";
import {
  ICON_SETS,
  ICON_SET_IDS,
  bareIcon,
  ensureIconSet,
  iconDrawing,
  iconNamesFor,
  iconSetOfName,
  iconSetReady,
  onIconSetLoaded,
  resolveIconIn,
  type IconSet,
} from "@/design-system/icons";
import { Spinner, fieldBox } from "./controls";
import { r } from "./recipes";
import { useSlidingIndicator } from "./motion";

/**
 * Pick an icon from a whole library (Lucide or Hugeicons): search by name or a word in it, click a
 * glyph. Opens on the design system's icon set; the other set is a tab away.
 */

const SHOWN = 160;

/** Loads an icon set and re-renders when it's there. */
export function useIconSet(set: IconSet): boolean {
  const [ready, setReady] = useState(() => iconSetReady(set));
  useEffect(() => {
    setReady(iconSetReady(set));
    if (iconSetReady(set)) return;
    const off = onIconSetLoaded(() => setReady(iconSetReady(set)));
    ensureIconSet(set).catch(() => {});
    return off;
  }, [set]);
  return ready;
}

/** A stored icon name, drawn the way the canvas draws it (same path data, the set's stroke weight). */
export function IconGlyph({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const set = iconSetOfName(name);
  const ready = useIconSet(set);
  const d = useMemo(() => (ready ? iconDrawing(name) : "pending"), [name, ready]);
  if (d === "pending" || !d) return <span className={clsx("inline-block shrink-0 rounded-xs border border-dashed border-line-strong", className)} style={{ width: size, height: size }} />;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={ICON_SETS[set].strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={clsx("shrink-0", className)} aria-hidden>
      {d.fill && <path d={d.fill} fill="currentColor" stroke="none" fillRule={d.evenOdd ? "evenodd" : undefined} />}
      <path d={d.stroke} />
    </svg>
  );
}

/** Names in a set matching a query: the name it resolves to first, then prefix matches, then names containing every word. */
export function searchIcons(query: string, set: IconSet = "lucide"): string[] {
  const names = iconNamesFor(set);
  const q = query.trim().toLowerCase();
  if (!q) return names;
  const exact = resolveIconIn(q, set);
  const first = exact && iconSetOfName(exact) === set ? bareIcon(exact) : null;
  const words = q.split(/[\s-]+/).filter(Boolean);
  const starts: string[] = [];
  const contains: string[] = [];
  for (const n of names) {
    if (n === first) continue;
    if (n.startsWith(q)) starts.push(n);
    else if (words.every((w) => n.includes(w))) contains.push(n);
  }
  return [...(first && names.includes(first) ? [first] : []), ...starts, ...contains];
}

const stored = (name: string, set: IconSet) => (set === "hugeicons" ? `hugeicons:${name}` : name);

export function IconPicker({ value, onChange, ariaLabel, allowNone, set: systemSet = "lucide" }: { value: string | undefined; onChange: (name: string | undefined) => void; ariaLabel: string; allowNone?: boolean; set?: IconSet }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [set, setSet] = useState<IconSet>(systemSet);
  useEffect(() => setSet(systemSet), [systemSet]);
  const ready = useIconSet(set);
  const results = useMemo(() => (ready ? searchIcons(query, set) : []), [query, set, ready]);
  const current = value ? resolveIconIn(value, set) : null;
  const pick = (name: string | undefined) => {
    onChange(name);
    setOpen(false);
    setQuery("");
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={ariaLabel} className={clsx(r.selectTrigger, "w-full text-left")}>
          {value ? <IconGlyph name={value} size={14} className="text-fg-muted" /> : null}
          <span className="min-w-0 flex-1 truncate">{value ? bareIcon(value) : allowNone ? "None" : "—"}</span>
          {value && iconSetOfName(value) === "hugeicons" && <span className="shrink-0 text-micro text-fg-subtle">Hugeicons</span>}
          <ChevronDown size={12} className="shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="left"
          align="start"
          sideOffset={10}
          collisionPadding={8}
          className={clsx(r.popover, "flex w-[296px] flex-col gap-[8px] text-body text-fg")}
        >
          <SetTabs set={set} systemSet={systemSet} onChange={setSet} />
          <div className={clsx(fieldBox, "gap-[6px] px-[8px]")}>
            <Search size={12} className="shrink-0 text-fg-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results[0]) pick(stored(results[0], set));
              }}
              placeholder={ready ? `Search ${iconNamesFor(set).length.toLocaleString("en-US")} ${ICON_SETS[set].label} icons` : `Loading ${ICON_SETS[set].label}…`}
              aria-label="Search icons"
              className="h-full min-w-0 flex-1 bg-transparent text-caption text-fg outline-none placeholder:text-fg-faint focus-visible:outline-none"
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="q-item grid size-[20px] place-items-center rounded-xs text-fg-subtle hover:bg-hover hover:text-fg">
                <X size={12} />
              </button>
            )}
          </div>
          {ready ? (
            <div className="grid max-h-[264px] grid-cols-8 gap-[2px] overflow-y-auto">
              {results.slice(0, SHOWN).map((n) => {
                const name = stored(n, set);
                return (
                  <button
                    key={n}
                    type="button"
                    title={n}
                    aria-label={n}
                    onClick={() => pick(name)}
                    className={clsx("q-item grid size-[32px] place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg", name === current && "bg-selected text-fg shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-selected")}
                  >
                    <IconGlyph name={name} />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex h-[96px] items-center justify-center gap-[8px] text-caption text-fg-subtle">
              <Spinner size={12} /> Loading {ICON_SETS[set].label}…
            </div>
          )}
          <div className="flex h-[20px] items-center justify-between px-[2px] text-micro text-fg-subtle tnum">
            <span>{!ready ? " " : results.length > SHOWN ? `${SHOWN} of ${results.length.toLocaleString("en-US")}: search to narrow` : `${results.length} icon${results.length === 1 ? "" : "s"}`}</span>
            {allowNone && value && (
              <button type="button" onClick={() => pick(undefined)} className={clsx(r.link, "font-medium")}>
                Remove icon
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Lucide / Hugeicons tabs: a segmented control whose thumb slides to the picked set. */
function SetTabs({ set, systemSet, onChange }: { set: IconSet; systemSet: IconSet; onChange: (s: IconSet) => void }) {
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLDivElement, HTMLSpanElement>(set);
  return (
    <div ref={containerRef} role="tablist" aria-label="Icon set" className={r.segmented}>
      <span ref={indicatorRef} aria-hidden className={clsx(r.segmentedThumb, "data-[hidden]:opacity-0")} />
      {ICON_SET_IDS.map((s) => (
        <button
          key={s}
          type="button"
          role="tab"
          aria-selected={set === s}
          aria-checked={set === s}
          data-indicator-active={set === s || undefined}
          onClick={() => onChange(s)}
          title={`${ICON_SETS[s].label} (${ICON_SETS[s].site}): ${ICON_SETS[s].blurb}${s === systemSet ? " · this design system's set" : ""}`}
          className={clsx(r.segmentedItem, "q-press justify-center gap-[4px] text-caption font-medium [grid-auto-flow:column]")}
        >
          {ICON_SETS[s].label}
          {s === systemSet && <span className="font-normal text-fg-subtle">· system</span>}
        </button>
      ))}
    </div>
  );
}
