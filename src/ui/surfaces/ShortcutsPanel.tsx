import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import clsx from "clsx";
import { Search, X } from "lucide-react";
import { allCommands, commandKeys, ESSENTIAL, getCommand, onCommandRun, toggleShortcuts, useLearned, useRegistry, type Command, type CommandCategory } from "@/commands";
import { useSurfaces } from "@/commands/surfaces";
import { r } from "../recipes";
import { Checkbox, IconBtn, Kbd, Tip } from "../controls";
import { reducedMotion, useSlidingIndicator } from "../motion";
import { CATEGORY_LABEL } from "./icons";
import { scoreItem } from "./fuzzy";

/*
 * Keyboard shortcuts (⌃⇧?), like Figma's panel: it slides up over the bottom of the canvas without
 * taking focus, so shortcuts keep working while it is open. Tabs per category (Essential first),
 * keycaps on every row, shortcuts the designer has already used in the learned colour, and a row
 * whose command just ran flashes its keycaps. A toggle lists Figma's shortcuts Qalam doesn't have,
 * dimmed with the reason.
 */

type Tab = "essential" | Exclude<CommandCategory, "essential" | "panels" | "file">;

const TABS: Tab[] = ["essential", "discovery", "tools", "view", "zoom", "text", "shape", "vector", "selection", "cursor", "edit", "transform", "arrange", "auto-layout", "components", "ai"];

/** Panels live under View and file commands under Edit, as in Figma's panel. */
const tabOf = (c: Command): Tab => (c.category === "panels" ? "view" : c.category === "file" ? "edit" : c.category === "essential" ? "essential" : c.category);

const PANEL_H = 340;
const LEARNED_KEYS =
  "[&_kbd]:text-fg-accent [&_kbd]:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-accent)_38%,transparent)]";

/** A command has a shortcut to list: keys on this platform, or a gesture. */
const listed = (c: Command) => commandKeys(c).length > 0;

/** The canvas area the panel sits over (falls back to the window). */
function useCanvasBox(active: boolean) {
  const [box, setBox] = useState<{ left: number; width: number; bottom: number; height: number } | null>(null);
  useLayoutEffect(() => {
    if (!active) return;
    const el = document.querySelector<HTMLElement>('[data-region="canvas"]') ?? document.querySelector<HTMLElement>('canvas[aria-label="Design canvas"]')?.parentElement ?? null;
    const measure = () => {
      const rect = el?.getBoundingClientRect();
      if (!rect || rect.width < 200) return setBox({ left: 8, width: window.innerWidth - 16, bottom: 32, height: PANEL_H });
      setBox({
        left: Math.round(rect.left + 8),
        width: Math.round(rect.width - 16),
        bottom: Math.round(window.innerHeight - rect.bottom + 8),
        height: Math.round(Math.min(PANEL_H, rect.height - 96)),
      });
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" && el ? new ResizeObserver(measure) : null;
    if (el) ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [active]);
  return box;
}

/** Mounted while open and while sliding away; `entered` drives the CSS transition. */
function useSlide(open: boolean) {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open) {
      const f = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
      return () => cancelAnimationFrame(f);
    }
    setEntered(false);
    const t = setTimeout(() => setMounted(false), reducedMotion() ? 160 : 260);
    return () => clearTimeout(t);
  }, [open]);
  return { mounted, entered };
}

export default function ShortcutsPanel() {
  const open = useSurfaces((s) => s.shortcuts);
  const { mounted, entered } = useSlide(open);
  const box = useCanvasBox(mounted);
  if (!mounted || !box) return null;
  return <Panel open={open} entered={entered} box={box} />;
}

function Panel({ open, entered, box }: { open: boolean; entered: boolean; box: { left: number; width: number; bottom: number; height: number } }) {
  const [tab, setTab] = useState<Tab>("essential");
  const [tabVia, setTabVia] = useState<"pointer" | "key">("pointer");
  const [query, setQuery] = useState("");
  const [showMissing, setShowMissing] = useState(false);
  const [lastRun, setLastRun] = useState<{ id: string; n: number } | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const version = useRegistry((s) => s.version);
  const learned = useLearned((s) => s.learned);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const commands = useMemo(() => allCommands().filter(listed), [version]);
  const usable = commands.filter((c) => !c.unavailable);
  // Discovery's tab only where its commands are registered (Discovery projects).
  const tabs = useMemo(() => TABS.filter((t) => t !== "discovery" || commands.some((c) => c.category === "discovery")), [commands]);
  const learnedCount = usable.filter((c) => learned.has(c.id)).length;

  const q = query.trim();
  const sections = useMemo(() => {
    const visible = commands.filter((c) => showMissing || !c.unavailable);
    if (q) {
      const hits = visible
        .map((c) => ({ c, m: scoreItem(q, { label: c.label, keywords: c.keywords, extra: CATEGORY_LABEL[c.category] }) }))
        .filter((x) => x.m)
        .sort((a, b) => b.m!.score - a.m!.score);
      const by = new Map<Tab, Command[]>();
      for (const { c } of hits) by.set(tabOf(c), [...(by.get(tabOf(c)) ?? []), c]);
      return tabs.filter((t) => by.has(t)).map((t) => ({ title: t === "essential" ? "Essential" : CATEGORY_LABEL[t], items: by.get(t)! }));
    }
    if (tab === "essential") {
      const items = ESSENTIAL.map((id) => getCommand(id)).filter((c): c is Command => !!c && listed(c) && (showMissing || !c.unavailable));
      return [{ title: null as string | null, items }];
    }
    return [{ title: null as string | null, items: visible.filter((c) => tabOf(c) === tab) }];
  }, [commands, tabs, q, tab, showMissing]);

  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLDivElement, HTMLSpanElement>(q ? null : tab, { axis: "x", instant: tabVia === "key" });

  // A command that runs while the panel is up: its keycaps pop and the row flashes (and turns learned).
  useEffect(() => {
    if (!open) return;
    return onCommandRun((id) => {
      setLastRun((prev) => ({ id, n: (prev?.n ?? 0) + 1 }));
      const row = body.current?.querySelector<HTMLElement>(`[data-shortcut="${CSS.escape(id)}"]`);
      if (!row) return;
      row.classList.remove("q-flash-run");
      void row.offsetWidth;
      row.classList.add("q-flash-run");
      const caps = row.querySelector<HTMLElement>("[data-caps]");
      if (caps && !reducedMotion()) caps.animate([{ transform: "scale(0.94)" }, { transform: "scale(1)" }], { duration: 140, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)" });
    });
  }, [open]);

  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [tab, q]);

  // Reduced motion: it fades in place instead of sliding.
  const still = reducedMotion();
  const style: CSSProperties = {
    left: box.left,
    width: box.width,
    bottom: box.bottom,
    height: box.height,
    translate: entered || still ? "0 0" : "0 calc(100% + 24px)",
    opacity: entered ? 1 : 0,
    transition: still
      ? "opacity var(--dur-fast) var(--ease-out-quad)"
      : entered
        ? "translate calc(var(--dur-move) * 1.5) var(--ease-drawer), opacity var(--dur-fast) var(--ease-out-quad)"
        : "translate var(--dur-move) var(--ease-in-quad), opacity var(--dur-fast) var(--ease-in-quad)",
  };

  const last = lastRun ? getCommand(lastRun.id) : undefined;
  const lastKeys = last ? commandKeys(last)[0] : undefined;

  return (
    <section
      role="region"
      aria-label="Keyboard shortcuts"
      data-state={open ? "open" : "closed"}
      inert={!open}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !(e.target instanceof HTMLInputElement && query)) {
          e.stopPropagation();
          toggleShortcuts();
        }
      }}
      style={style}
      className="fixed z-[45] flex flex-col overflow-hidden rounded-xl bg-elevated shadow-modal"
    >
      <header className="@container flex h-[44px] shrink-0 items-center gap-[12px] pl-[16px] pr-[8px]">
        <h2 className="shrink-0 text-body font-semibold whitespace-nowrap text-fg">Keyboard shortcuts</h2>
        <Tip label="Shortcuts you have used from the keyboard">
          <span className="inline-flex shrink-0 items-center gap-[8px] text-micro whitespace-nowrap text-fg-subtle tnum">
            <span className="relative h-[4px] w-[48px] overflow-hidden rounded-full bg-active" aria-hidden>
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-fg-accent transition-[width] duration-base ease-out-quint"
                style={{ width: `${usable.length ? (learnedCount / usable.length) * 100 : 0}%` }}
              />
            </span>
            {learnedCount} of {usable.length} used
          </span>
        </Tip>
        <span className="flex-1" />
        {last && lastKeys && (
          <span key={lastRun!.n} className="q-fade hidden min-w-0 items-center gap-[8px] text-caption text-fg-subtle @min-[880px]:inline-flex">
            <span className="truncate">{last.label}</span>
            <Kbd keys={lastKeys} size="sm" className={LEARNED_KEYS} />
          </span>
        )}
        <label className={clsx(r.field, "h-[28px] w-[200px] shrink-0 gap-[6px] pl-[8px] text-body")}>
          <Search size={14} absoluteStrokeWidth strokeWidth={1.25} className="shrink-0 text-fg-subtle" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Esc clears the query first; with nothing typed it reaches the panel, which closes. Other
              // keys go on to the field dispatcher, which runs only app-wide commands (⌘K, ⌃⇧?).
              if (e.key === "Escape" && query) {
                e.preventDefault();
                e.stopPropagation();
                setQuery("");
              }
            }}
            placeholder="Search shortcuts"
            aria-label="Search shortcuts"
            spellCheck={false}
            className={r.fieldInput}
          />
        </label>
        <Checkbox checked={showMissing} onChange={setShowMissing} label={<span className="whitespace-nowrap">Show Figma-only</span>} />
        <IconBtn label="Close" command="essential.shortcuts" onClick={() => toggleShortcuts()}>
          <X size={16} absoluteStrokeWidth strokeWidth={1.25} />
        </IconBtn>
      </header>
      <div
        ref={containerRef}
        role="tablist"
        aria-label="Shortcut categories"
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          e.preventDefault();
          e.stopPropagation();
          const i = tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : -1);
          const next = tabs[(i + tabs.length) % tabs.length];
          setTabVia("key");
          setTab(next);
          setQuery("");
          requestAnimationFrame(() => containerRef.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus());
        }}
        className="ds-noscrollbar relative flex h-[36px] shrink-0 items-center gap-[2px] overflow-x-auto border-b border-line-subtle px-[12px] [mask-image:linear-gradient(to_right,black_calc(100%-40px),transparent)]"
      >
        <span ref={indicatorRef} aria-hidden className="q-indicator top-[4px] rounded-md bg-active shadow-[inset_0_0_0_1px_var(--color-line-subtle)] data-[hidden]:opacity-0" />
        {tabs.map((t) => {
          const selected = !q && t === tab;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              data-tab={t}
              aria-selected={selected}
              tabIndex={selected || (q && t === "essential") ? 0 : -1}
              data-indicator-active={selected || undefined}
              onClick={() => {
                setTabVia("pointer");
                setTab(t);
                setQuery("");
              }}
              className={clsx(
                "relative z-[1] h-[28px] shrink-0 rounded-md px-[10px] text-caption font-medium whitespace-nowrap transition-colors duration-quick",
                selected ? "text-fg" : "text-fg-subtle hover:text-fg-muted",
              )}
            >
              {t === "essential" ? "Essential" : CATEGORY_LABEL[t]}
            </button>
          );
        })}
      </div>
      <div ref={body} role="tabpanel" aria-label={q ? "Search results" : CATEGORY_LABEL[tab]} className="min-h-0 flex-1 overflow-y-auto px-[16px] pt-[8px] pb-[16px]">
        {sections.every((s) => !s.items.length) ? (
          <p className="grid h-full place-items-center text-body text-fg-subtle">{q ? `No shortcuts match “${q}”` : "Nothing here yet"}</p>
        ) : (
          <div key={q ? "q" : tab} className="q-fade columns-[280px] gap-x-[32px]">
            {sections.map((s) => (
              <div key={s.title ?? "all"} className="contents">
                {s.title && <h3 className="break-after-avoid pt-[8px] pb-[2px] text-micro font-medium text-fg-subtle first:pt-0">{s.title}</h3>}
                {s.items.map((c) => (
                  <ShortcutRow key={c.id} c={c} learned={learned.has(c.id)} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ShortcutRow({ c, learned }: { c: Command; learned: boolean }) {
  const combos = commandKeys(c).slice(0, 2);
  const row = (
    <div
      data-shortcut={c.id}
      style={{ "--q-flash": "var(--color-selection-subtle)" } as CSSProperties}
      className={clsx(
        "flex h-[30px] break-inside-avoid items-center gap-[12px] rounded-md px-[6px] -mx-[6px] text-body",
        c.unavailable ? "text-fg-faint" : "text-fg-muted",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{c.label}</span>
      <span data-caps="" className={clsx("flex shrink-0 items-center gap-[6px]", learned && !c.unavailable && LEARNED_KEYS, c.unavailable && "opacity-50")}>
        {combos.map((k, i) => (
          <span key={i} className="contents">
            {i > 0 && <span className="text-micro text-fg-subtle">or</span>}
            <Kbd keys={k} size="sm" />
          </span>
        ))}
      </span>
    </div>
  );
  return c.unavailable ? (
    <Tip label={c.unavailable} side="top" align="start">
      {row}
    </Tip>
  ) : (
    row
  );
}
