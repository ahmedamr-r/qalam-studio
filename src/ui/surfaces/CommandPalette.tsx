import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";
import { Search } from "lucide-react";
import {
  allCommands, commandKeys, commandState, feedback, formatKeys, getCommand, kb, keysOf, matchKey, runCommand, toggleShortcuts, useRegistry,
  type Command,
} from "@/commands";
import { closePalette, useSurfaces } from "@/commands/surfaces";
import { commandCanvas } from "@/commands/canvas";
import { useStudio } from "@/doc/store";
import { revealLayers } from "../pages";
import type { Doc, SceneNode } from "@/doc/schema";
import { r } from "../recipes";
import { Kbd, CommandKbd } from "../controls";
import { reducedMotion, usePresence, useSlidingIndicator } from "../motion";
import { QalamAIGlyph } from "../brand";
import { layerKind } from "../layerKind";
import { CATEGORY_LABEL, CommandIcon } from "./icons";
import { highlightRuns, scoreItem } from "./fuzzy";
import { recordRecent, useRecent } from "./recent";
import { aiActions, askQalamAI } from "./ai-actions";

/*
 * ⌘K Actions (Figma's palette, ⌘/ and ⌘P too). Centred near the top with no scrim, so the canvas stays
 * in view. One query searches commands (label, keywords, category), layers by name and Qalam AI
 * actions; ⌘↵ hands the query to Qalam AI. Every row shows its keycaps, toggles say On/Off and rows
 * that can't run say why. The highlight jumps on keys and glides on the pointer; running a row flashes
 * it for 80ms, closes the palette and then runs the action.
 */

type RowGroup = "Recent" | "Qalam AI" | "Commands" | "Layers";

interface Row {
  key: string;
  group: RowGroup;
  label: string;
  hits: number[];
  icon: ReactNode;
  sub?: string;
  state?: string;
  keys?: string[];
  /** Why it can't run. */
  disabled?: string;
  score: number;
  run: () => void;
}

const MAX_COMMANDS = 40;
const MAX_LAYERS = 8;
const MAX_RECENT = 3;
/** Categories whose `checked` is not an on/off setting (the current tool, the open panel, this palette's neighbours). */
const NO_STATE = new Set(["tools", "panels", "essential"]);
/** Covered by the Qalam AI rows below, which carry the selection's context. */
const AI_DUPES = new Set(["ai.generate", "ai.critique", "ai.direction", "ai.audit", "discovery.design-this", "discovery.redo-interview"]);

const AI_ICON = <QalamAIGlyph size={16} />;
const ASK_KEYS = () => formatKeys(kb("⌘↵"));

export default function CommandPalette() {
  const open = useSurfaces((s) => s.palette);
  const p = usePresence<HTMLDivElement>(open);
  return p.mounted ? <Palette state={p.state} presenceRef={p.ref} /> : null;
}

function commandRow(c: Command, query: string, group: RowGroup): Row | null {
  const m = query ? scoreItem(query, { label: c.label, keywords: c.keywords, extra: CATEGORY_LABEL[c.category] }) : { score: 0, hits: [] };
  if (!m) return null;
  const st = commandState(c);
  let checked: boolean | undefined;
  try {
    checked = c.checked && !NO_STATE.has(c.category) ? c.checked() : undefined;
  } catch {
    checked = undefined;
  }
  return {
    key: `cmd:${c.id}`,
    group,
    label: c.label,
    hits: m.hits,
    icon: c.category === "ai" ? AI_ICON : <CommandIcon id={c.id} category={c.category} />,
    sub: c.category === "tools" ? "Tool" : undefined,
    state: st !== true ? undefined : checked === undefined ? undefined : checked ? "On" : "Off",
    keys: commandKeys(c)[0],
    disabled: st === true ? undefined : st,
    score: m.score,
    run: () => void runCommand(c.id, "palette"),
  };
}

const layerIcon = (n: SceneNode) => {
  const k = layerKind(n);
  return <k.Icon size={16} absoluteStrokeWidth strokeWidth={1.25} aria-hidden className={clsx("shrink-0", k.component && "text-component")} />;
};

/** "Wallet · Home" for a layer inside a screen; nothing for a screen itself. */
function layerPath(doc: Doc, n: SceneNode): string | undefined {
  const names: string[] = [];
  let p = n.parentId ? doc.nodes[n.parentId] : undefined;
  while (p) {
    names.unshift(p.name);
    p = p.parentId ? doc.nodes[p.parentId] : undefined;
  }
  if (!names.length) return undefined;
  return names.length > 2 ? `${names[0]} · … · ${names[names.length - 1]}` : names.join(" · ");
}

function goToLayer(id: string) {
  // Layers on another page show it first.
  revealLayers([id], { glide: false });
  commandCanvas()?.glideToFit([id]);
  recordRecent(`layer:${id}`);
}

function layerRow(doc: Doc, n: SceneNode, query: string, group: RowGroup): Row | null {
  const m = query ? scoreItem(query, { label: n.name || n.type }) : { score: 0, hits: [] };
  if (!m) return null;
  return {
    key: `layer:${n.id}`,
    group,
    label: n.name || n.type,
    hits: m.hits,
    icon: layerIcon(n),
    sub: layerPath(doc, n),
    score: m.score,
    run: () => goToLayer(n.id),
  };
}

function buildRows(query: string, doc: Doc, selection: string[], recent: string[]): Row[] {
  const q = query.trim();
  const ai = aiActions(doc, selection);
  const aiRow = (a: (typeof ai)[number], group: RowGroup): Row | null => {
    const m = q ? scoreItem(q, { label: a.label, keywords: a.keywords, extra: "Qalam AI" }) : { score: 0, hits: [] };
    if (!m) return null;
    return {
      key: a.id,
      group,
      label: a.label,
      hits: m.hits,
      icon: AI_ICON,
      sub: a.sub,
      state: a.enabled === true ? a.state : undefined,
      disabled: a.enabled === true ? undefined : a.enabled,
      score: m.score,
      run: () => {
        recordRecent(a.id);
        a.run();
      },
    };
  };
  const commands = allCommands().filter((c) => !c.hidden && !c.unavailable && !c.gesture && c.id !== "essential.actions" && !AI_DUPES.has(c.id));
  const rows: Row[] = [];

  if (!q) {
    for (const id of recent) {
      if (rows.length >= MAX_RECENT) break;
      let row: Row | null = null;
      if (id.startsWith("layer:")) {
        const n = doc.nodes[id.slice(6)];
        row = n ? layerRow(doc, n, "", "Recent") : null;
      } else if (id.startsWith("ai:")) {
        const a = ai.find((x) => x.id === id);
        row = a ? aiRow(a, "Recent") : null;
      } else {
        const c = getCommand(id);
        row = c && !c.unavailable ? commandRow(c, "", "Recent") : null;
      }
      if (row) rows.push({ ...row, key: `recent:${row.key}` });
    }
    for (const a of ai.slice(0, 3)) rows.push(aiRow(a, "Qalam AI")!);
    for (const c of commands) if (c.category !== "ai") rows.push(commandRow(c, "", "Commands")!);
    return rows;
  }

  const cmdRows = commands
    .map((c) => commandRow(c, q, c.category === "ai" ? "Qalam AI" : "Commands"))
    .filter((x): x is Row => !!x)
    .sort((a, b) => b.score - a.score);
  const layerRows = Object.values(doc.nodes)
    .map((n) => layerRow(doc, n, q, "Layers"))
    .filter((x): x is Row => !!x)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_LAYERS);
  const aiRows = [...ai.map((a) => aiRow(a, "Qalam AI")).filter((x): x is Row => !!x), ...cmdRows.filter((x) => x.group === "Qalam AI")].sort((a, b) => b.score - a.score);
  const ask: Row = {
    key: "ask",
    group: "Qalam AI",
    label: "Ask Qalam AI",
    hits: [],
    icon: AI_ICON,
    sub: `“${q}”`,
    keys: ASK_KEYS(),
    score: -1,
    run: () => askQalamAI(q),
  };
  const commandsOnly = cmdRows.filter((x) => x.group === "Commands").slice(0, MAX_COMMANDS);
  // Groups follow their best match, so a layer name typed in full outranks a fuzzy command.
  const groups: [RowGroup, Row[]][] = [
    ["Commands", commandsOnly],
    ["Layers", layerRows],
    ["Qalam AI", aiRows],
  ];
  groups.sort((a, b) => (b[1][0]?.score ?? -Infinity) - (a[1][0]?.score ?? -Infinity));
  for (const [, list] of groups) rows.push(...list);
  // Ask Qalam AI ends the list (and is always there, so a query never dead-ends).
  rows.push(ask);
  return rows;
}

function Palette({ state, presenceRef }: { state: "open" | "closed"; presenceRef: (el: HTMLDivElement | null) => void }) {
  const open = state === "open";
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [via, setVia] = useState<"key" | "pointer" | "query">("query");
  const [flash, setFlash] = useState<string | null>(null);
  const [shake, setShake] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const footerBtn = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const pending = useRef<Row | null>(null);

  useRegistry((s) => s.version);
  const doc = useStudio((s) => s.doc);
  const selection = useStudio((s) => s.selection);
  // enabled / checked read these; subscribe so states stay live while the palette is up.
  useStudio((s) => s.view);
  useStudio((s) => s.tool);
  useStudio((s) => s.leftOpen);
  useStudio((s) => s.past.length + s.future.length);
  const recent = useRecent((s) => s.ids);

  const rows = useMemo(() => buildRows(query, doc, selection, recent), [query, doc, selection, recent]);
  const current = rows[Math.min(active, rows.length - 1)];
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLDivElement, HTMLSpanElement>(current?.key ?? null, { axis: "y", instant: via !== "pointer" });

  // Focus the field at once; give focus back to where it was when the palette goes.
  useLayoutEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => {
      if (before && before !== document.body && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, []);

  // Clicking anywhere else closes it (no scrim: the click still lands).
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) closePalette();
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [open]);

  // The results animate their height (not on the first frame, not with reduced motion).
  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    const list = containerRef.current;
    const pad = list ? parseFloat(getComputedStyle(list).paddingTop) + parseFloat(getComputedStyle(list).paddingBottom) : 0;
    const measure = () => setHeight(Math.min(el.offsetHeight + pad, Math.min(480, window.innerHeight * 0.6)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const t = requestAnimationFrame(() => setArmed(true));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(t);
    };
  }, []);

  // Keyboard moves keep the highlighted row in view.
  useEffect(() => {
    if (via !== "key" || !current) return;
    containerRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(current.key)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current, via, containerRef]);

  const runRow = (row: Row | undefined) => {
    if (!row || !open) return;
    if (row.disabled) {
      // Says why in the HUD; the row shakes instead of closing.
      feedback(row.disabled, { id: `palette:${row.key}` });
      setShake(null);
      requestAnimationFrame(() => setShake(row.key));
      return;
    }
    // The row flashes (80ms), then the palette closes and the action runs: on the flash's animationend,
    // with a timer as the fallback (reduced motion keeps the flash; a busy main thread delays both).
    pending.current = row;
    setFlash(row.key);
    setTimeout(finishRun, 160);
  };

  const finishRun = () => {
    const row = pending.current;
    if (!row) return;
    pending.current = null;
    closePalette();
    // After the palette lets go of focus, so actions that move focus (rename, chat) keep it.
    requestAnimationFrame(() => row.run());
  };

  const move = (delta: number) => {
    if (!rows.length) return;
    setVia("key");
    setActive((i) => (Math.min(i, rows.length - 1) + delta + rows.length) % rows.length);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const ne = e.nativeEvent;
    if (ne.isComposing) return;
    const toggle = getCommand("essential.actions");
    if (toggle && keysOf(toggle).some((k) => matchKey(ne, k))) {
      e.preventDefault();
      e.stopPropagation();
      return closePalette();
    }
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) return handled(), move(1);
    if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) return handled(), move(-1);
    if (e.key === "PageDown") return handled(), move(Math.min(8, rows.length - 1 - active));
    if (e.key === "PageUp") return handled(), move(-Math.min(8, active));
    if (e.key === "Escape") return handled(), closePalette();
    // Focus stays in the palette: Tab moves between the field and the footer's All shortcuts.
    if (e.key === "Tab") return handled(), footerBtn.current?.focus();
    if (e.key === "Enter") {
      handled();
      if ((e.metaKey || e.ctrlKey) && query.trim()) return runRow(rows.find((x) => x.key === "ask"));
      return runRow(current);
    }
  };

  let lastGroup: RowGroup | null = null;
  const reduce = reducedMotion();
  return (
    <div
      ref={(el) => {
        panel.current = el;
        presenceRef(el);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Actions"
      data-state={state}
      className={clsx(r.palette, "z-[60]")}
    >
      <div className={r.paletteInputRow}>
        <Search size={18} absoluteStrokeWidth strokeWidth={1.25} aria-hidden />
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setVia("query");
          }}
          onKeyDown={onKeyDown}
          placeholder="Search commands and layers, or ask Qalam AI"
          aria-label="Search actions"
          role="combobox"
          aria-expanded="true"
          aria-controls="qalam-palette-list"
          aria-activedescendant={current ? `qp-${current.key}` : undefined}
          autoComplete="off"
          spellCheck={false}
          className={r.paletteInput}
        />
        <Kbd keys={formatKeys(kb("Esc"))} size="sm" />
      </div>
      <div
        className="q-palette-results"
        style={{ height: height ?? undefined, transition: !armed || reduce ? "none" : undefined } as CSSProperties}
      >
        <div ref={containerRef} id="qalam-palette-list" role="listbox" aria-label="Results" className={clsx(r.paletteList, "h-full")}>
          <span ref={indicatorRef} aria-hidden data-glide={via === "pointer" ? "fast" : undefined} className={clsx(r.paletteHighlight, "inset-x-[6px] w-auto data-[hidden]:opacity-0")} />
          <div ref={content} className="pb-[2px]">
            {rows.map((row, i) => {
              const head = row.group !== lastGroup ? row.group : null;
              lastGroup = row.group;
              const isActive = row === current;
              return (
                <div key={row.key}>
                  {head && (
                    <div className={r.paletteGroup} role="presentation">
                      {head}
                    </div>
                  )}
                  <div
                    id={`qp-${row.key}`}
                    data-row={row.key}
                    role="option"
                    aria-selected={isActive}
                    aria-disabled={row.disabled ? true : undefined}
                    data-indicator-active={isActive || undefined}
                    onPointerMove={() => {
                      if (i === active && via === "pointer") return;
                      setVia("pointer");
                      setActive(i);
                    }}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => runRow(row)}
                    onAnimationEnd={() => {
                      if (shake === row.key) setShake(null);
                      if (flash === row.key) finishRun();
                    }}
                    style={{ "--q-flash": "var(--color-line-strong)" } as CSSProperties}
                    className={clsx(r.paletteRow, "cursor-default", flash === row.key && "q-flash-run rounded-lg", shake === row.key && "q-shake")}
                  >
                    {row.icon}
                    <span className={clsx("min-w-0 shrink-0 truncate max-w-[60%]", row.disabled ? "text-fg-subtle" : query.trim() && row.hits.length ? "text-fg-muted" : "text-fg")}>
                      {highlightRuns(row.label, row.disabled ? [] : row.hits).map((run, k) =>
                        run.hit ? (
                          <span key={k} className="font-medium text-fg">
                            {run.text}
                          </span>
                        ) : (
                          <span key={k}>{run.text}</span>
                        ),
                      )}
                    </span>
                    {row.sub && <span className={clsx(r.paletteSub, "min-w-0 truncate")}>{row.sub}</span>}
                    <span className="ml-auto flex shrink-0 items-center gap-[10px] pl-[12px]">
                      {row.disabled ? (
                        <span className={clsx(r.paletteState, "max-w-[220px] truncate")}>{row.disabled}</span>
                      ) : (
                        row.state && <span className={r.paletteState}>{row.state}</span>
                      )}
                      {row.keys && <Kbd keys={row.keys} className={clsx(row.disabled && "opacity-50")} />}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className={r.paletteFooter}>
        <span className="inline-flex items-center gap-[6px]">
          <Kbd keys={[formatKeys(kb("↑")).at(-1)!, formatKeys(kb("↓")).at(-1)!]} size="sm" />
          Navigate
        </span>
        <span className="inline-flex items-center gap-[6px]">
          <Kbd keys={formatKeys(kb("↵"))} size="sm" />
          Run
        </span>
        <span className="inline-flex items-center gap-[6px]">
          <Kbd keys={ASK_KEYS()} size="sm" />
          Ask Qalam AI
        </span>
        <span className="inline-flex items-center gap-[6px]">
          <Kbd keys={formatKeys(kb("Esc"))} size="sm" />
          Close
        </span>
        <span className="flex-1" />
        <button
          ref={footerBtn}
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            // The other half of the Tab loop. Keys pressed here never reach the canvas shortcuts;
            // Esc and ⌘K close the palette as they do from the field, ↵ and Space press the button.
            if (e.key === "Enter" || e.key === " ") return;
            e.stopPropagation();
            const toggle = getCommand("essential.actions");
            if (e.key === "Escape" || (toggle && keysOf(toggle).some((k) => matchKey(e.nativeEvent, k)))) {
              e.preventDefault();
              closePalette();
            } else if (e.key === "Tab") {
              e.preventDefault();
              input.current?.focus();
            }
          }}
          onClick={() => {
            closePalette();
            if (!useSurfaces.getState().shortcuts) toggleShortcuts();
          }}
          className="q-item -mr-[6px] inline-flex h-[24px] items-center gap-[6px] rounded-md px-[6px] text-micro text-fg-subtle hover:bg-hover hover:text-fg-muted"
        >
          All shortcuts
          <CommandKbd command="essential.shortcuts" size="sm" />
        </button>
      </div>
    </div>
  );
}
