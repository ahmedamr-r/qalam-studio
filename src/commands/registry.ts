import { create } from "zustand";
import { useStudio } from "@/doc/store";
import { feedback } from "./feedback";
import { useSurfaces } from "./surfaces";

/**
 * One registry for every command in the studio. The keyboard dispatcher, toolbar tooltips, menus,
 * the ⌘K palette and the shortcuts panel all read it, so a shortcut shown anywhere is the one that runs.
 * Keys are written with Mac semantics (meta = ⌘, ctrl = ⌃); `winKeys` overrides them elsewhere.
 */

export type CommandCategory =
  | "essential" | "tools" | "view" | "panels" | "zoom" | "text" | "shape"
  | "vector" | "selection" | "cursor" | "edit" | "transform" | "arrange" | "auto-layout" | "components" | "ai" | "file"
  | "discovery";

export interface KeySpec {
  /** Letters (a–z) match `e.key` first, so AZERTY/Dvorak get their own letter; named keys ("Enter", "ArrowUp"). */
  key?: string;
  /** Physical key ("Digit0", "Slash", "KeyL"): digits and punctuation, and letters typed with ⌥ on a Mac. */
  code?: string;
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  /** Keycap text when the key's own name would mislead (⇧. is shown as ">"). */
  label?: string;
  /** This binding also runs while a text layer is being edited (⌘= zooms there; = types). */
  inText?: boolean;
}

export type CommandSource = "keyboard" | "palette" | "menu" | "context" | "toolbar";

export interface CommandContext {
  source: CommandSource;
  /** The keydown that ran it, when it came from the keyboard. */
  event?: KeyboardEvent;
}

export interface Command {
  /** "edit.duplicate", "tool.pen", "view.rulers" … */
  id: string;
  /** Menu / palette label, sentence case. */
  label: string;
  category: CommandCategory;
  /** First = primary (shown in tooltips and menus). Mac semantics. */
  keys?: KeySpec[];
  /** Keys on Windows/Linux when they differ from `keys` with ⌘ read as Ctrl ([] = none there). */
  winKeys?: KeySpec[];
  run: (ctx: CommandContext) => void | Promise<void>;
  /** A string says why it can't run right now ("Select 2+ layers"). */
  enabled?: () => true | string;
  /** Toggles (rulers, outlines…). */
  checked?: () => boolean;
  /** Runs again on key auto-repeat (nudges, zoom steps). */
  repeat?: boolean;
  /** Default "canvas": only when focus is on the canvas. "global" also runs from panel fields. */
  context?: "canvas" | "text-edit" | "vector-edit" | "global";
  /** Also runs while a text layer is being edited (bold, text align, size steps). */
  inText?: boolean;
  /** Palette search synonyms. */
  keywords?: string[];
  /** Not shown in the palette (raw nudges, gestures). */
  hidden?: boolean;
  /** Something Qalam can't do (yet): listed dimmed in the shortcuts panel with this reason, never runs. */
  unavailable?: string;
  /** Mouse gestures, shown as keycaps instead of keys: ["⌥", "Drag"]. */
  gesture?: string[];
  /** Keydown must reach the browser: the native copy/cut/paste event that follows carries the data. */
  native?: boolean;
  /**
   * Among commands bound to the same key, higher goes first (default 0). A mode's own keys win
   * this way while they're enabled (Discovery's ⇥ and arrows on a tree card); disabled, the key
   * falls through to the next command, as always.
   */
  priority?: number;
}

// ---------------------------------------------------------------------------
// platform

let platformOverride: "mac" | "other" | null = null;
/** Tests pin the platform; the app reads it from the browser. */
export const setPlatform = (p: "mac" | "other" | null) => void (platformOverride = p);
export function isMac(): boolean {
  if (platformOverride) return platformOverride === "mac";
  if (typeof navigator === "undefined") return true;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent);
}

// ---------------------------------------------------------------------------
// registry

const commands = new Map<string, Command>();

/** Bumps whenever commands are added or replaced, so hooks re-read labels and keys. */
export const useRegistry = create<{ version: number }>(() => ({ version: 0 }));

/** Add commands; an id that is already registered is replaced (later registrations win). */
export function registerCommands(list: Command[]) {
  for (const c of list) commands.set(c.id, c);
  useRegistry.setState({ version: useRegistry.getState().version + 1 });
}

export const allCommands = (): Command[] => [...commands.values()];
export const getCommand = (id: string): Command | undefined => commands.get(id);

/** The keys that apply on this platform. */
export function keysOf(c: Command, mac = isMac()): KeySpec[] {
  return (mac ? c.keys : (c.winKeys ?? c.keys)) ?? [];
}

type CommandGuard = (c: Command) => string | null;
let guard: CommandGuard | null = null;
let announceGuard = false;

/**
 * A mode can switch off commands that don't fit what's selected, with the reason (Discovery:
 * tree cards keep their place, so no resizing, grouping or auto layout on them). One at a time.
 */
export const setCommandGuard = (g: CommandGuard | null, opts: { announce?: boolean } = {}) => {
  guard = g;
  // A guard that holds a whole page read-only says why on key presses too (one toast, replaced).
  announceGuard = !!g && !!opts.announce;
};

/** True, or why the command can't run. */
export function commandState(c: Command): true | string {
  if (c.unavailable) return c.unavailable;
  try {
    const blocked = guard?.(c);
    if (blocked) return blocked;
    return c.enabled ? c.enabled() : true;
  } catch {
    return "Not available here";
  }
}

// ---------------------------------------------------------------------------
// running

type RunListener = (id: string, source: CommandSource) => void;
const runListeners = new Set<RunListener>();

/** HUD / shortcuts-panel flash: called after a command ran. */
export function onCommandRun(fn: RunListener): () => void {
  runListeners.add(fn);
  return () => void runListeners.delete(fn);
}

/** Run a command by id from a menu, the palette or a button. Says why when it can't run. */
export function runCommand(id: string, source: CommandSource, event?: KeyboardEvent): boolean {
  const c = commands.get(id);
  if (!c) return false;
  const state = commandState(c);
  if (state !== true) {
    if (source !== "keyboard" || c.unavailable) feedback(c.unavailable ? `${c.label}: ${c.unavailable}` : state, { id: `cmd:${id}` });
    else if (announceGuard && guard?.(c) === state) feedback(state, { id: "cmd:guard" });
    return false;
  }
  if (source === "keyboard") learn(id);
  try {
    const r = c.run({ source, event });
    if (r instanceof Promise) r.catch((err) => feedback(`${c.label} failed: ${err instanceof Error ? err.message : String(err)}`, { kind: "error", id: `cmd:${id}` }));
  } catch (err) {
    feedback(`${c.label} failed: ${err instanceof Error ? err.message : String(err)}`, { kind: "error", id: `cmd:${id}` });
    return false;
  }
  runListeners.forEach((fn) => fn(id, source));
  return true;
}

// ---------------------------------------------------------------------------
// keyboard matching

/** The parts of a KeyboardEvent the matcher reads (tests pass plain objects). */
export type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> & { repeat?: boolean };

const LETTER = /^[a-z]$/;

function keyMatches(e: KeyLike, s: KeySpec): boolean {
  if (s.key && LETTER.test(s.key)) {
    // ⌥ letters type å, ¬, ˙ or a dead key on a Mac, and non-Latin layouts type their own script:
    // fall back to the physical key.
    const k = e.key.length === 1 ? e.key.toLowerCase() : "";
    return LETTER.test(k) ? k === s.key : e.code === `Key${s.key.toUpperCase()}`;
  }
  if (s.code) return e.code === s.code;
  if (s.key) return e.key === s.key || (e.key.length === 1 && e.key.toLowerCase() === s.key.toLowerCase());
  return false;
}

/**
 * Exact modifiers: a bare-letter command never fires with ⇧ or ⌥ held. On a Mac ⌘ and ⌃ are
 * different keys (⌃C picks a colour, ⌘C copies); elsewhere Ctrl plays ⌘'s part.
 */
function modsMatch(e: KeyLike, s: KeySpec, mac: boolean): boolean {
  if (e.altKey !== !!s.alt || e.shiftKey !== !!s.shift) return false;
  if (mac) return e.metaKey === !!s.meta && e.ctrlKey === !!s.ctrl;
  return !e.metaKey && e.ctrlKey === (!!s.meta || !!s.ctrl);
}

export function matchKey(e: KeyLike, s: KeySpec, mac = isMac()): boolean {
  return modsMatch(e, s, mac) && keyMatches(e, s);
}

/** Where a keydown came from: the canvas, the text editor, or some other field (input, chat…). */
export type DispatchMode = "canvas" | "text-edit" | "field";

function runsIn(c: Command, mode: DispatchMode): boolean {
  if (c.context === "global") return true;
  if (mode === "canvas") return !c.context || c.context === "canvas";
  if (mode === "text-edit") return c.context === "text-edit" || !!c.inText;
  return false;
}

/**
 * Commands bound to this key press, available ones first, then by priority, then in the order
 * they were registered (Enter edits text before it would edit a vector).
 */
export function commandsFor(e: KeyLike, mode: DispatchMode, mac = isMac()): Command[] {
  const hits: Command[] = [];
  for (const c of commands.values()) {
    if (c.gesture) continue;
    const all = runsIn(c, mode);
    if (!all && mode !== "text-edit") continue;
    if (keysOf(c, mac).some((s) => (all || s.inText) && matchKey(e, s, mac))) hits.push(c);
  }
  return hits.sort((a, b) => Number(!!a.unavailable) - Number(!!b.unavailable) || (b.priority ?? 0) - (a.priority ?? 0));
}

/**
 * Handle a keydown. Returns true when a command owned it. The first enabled command bound to the
 * key runs; matched keys are kept from the browser (⌘R reload, ⌘F find, Tab focus…) unless the
 * command is `native` (⌘C/⌘X/⌘V: the clipboard event that follows carries the data).
 */
export function dispatchKeyDown(e: KeyboardEvent, mode: DispatchMode): boolean {
  const hits = commandsFor(e, mode);
  if (!hits.length) {
    // From a field or the text editor, the browser's own ⌘R, ⌘D, ⌘[, ⌘0… would reload, bookmark,
    // go back or page-zoom the studio: keep them, though no command runs there.
    if (mode !== "canvas" && reservedKeys().some((s) => matchKey(e, s))) e.preventDefault();
    return false;
  }
  const cmd = hits.find((c) => commandState(c) === true) ?? hits[0];
  // A native command the mode blocks (paste on the Components page) must not reach the browser either.
  if (!cmd.native || commandState(cmd) !== true) e.preventDefault();
  if (e.repeat && !cmd.repeat) return true;
  runCommand(cmd.id, "keyboard", e);
  return true;
}

let reserved: KeySpec[] | null = null;
/** Browser shortcuts that would reload, bookmark, navigate, find in or page-zoom the studio. */
const reservedKeys = (): KeySpec[] =>
  (reserved ??= ["⌘R", "⇧⌘R", "⌘D", "⌘G", "⇧⌘G", "⌘[", "⌘]", "⌘0", "⌘=", "⇧⌘=", "⌘-"].map((k) => kb(k)));

// ---------------------------------------------------------------------------
// writing keys

const NAMED_KEYS: Record<string, KeySpec> = {
  "↵": { key: "Enter" }, Esc: { key: "Escape" }, "⌫": { key: "Backspace" }, "⌦": { key: "Delete" }, "⇥": { key: "Tab" },
  "←": { key: "ArrowLeft" }, "→": { key: "ArrowRight" }, "↑": { key: "ArrowUp" }, "↓": { key: "ArrowDown" },
  Space: { code: "Space" }, Home: { key: "Home" }, End: { key: "End" }, PgUp: { key: "PageUp" }, PgDn: { key: "PageDown" },
  "/": { code: "Slash" }, "\\": { code: "Backslash" }, "'": { code: "Quote" }, "[": { code: "BracketLeft" }, "]": { code: "BracketRight" },
  ",": { code: "Comma" }, ".": { code: "Period" }, "=": { code: "Equal" }, "-": { code: "Minus" }, ";": { code: "Semicolon" },
  "`": { code: "Backquote" }, "Num+": { code: "NumpadAdd", label: "+" }, "Num-": { code: "NumpadSubtract", label: "-" },
};

/**
 * A binding written the way menus show it: kb("⌥⌘G"), kb("⇧0"), kb("⇧⌘.", ">"), kb("Esc").
 * Modifier glyphs come first in any order; letters match by key, digits and punctuation by code.
 */
export function kb(text: string, label?: string): KeySpec {
  const spec: KeySpec = {};
  let i = 0;
  for (; i < text.length - 1; i++) {
    const ch = text[i];
    if (ch === "⌘") spec.meta = true;
    else if (ch === "⌃") spec.ctrl = true;
    else if (ch === "⌥") spec.alt = true;
    else if (ch === "⇧") spec.shift = true;
    else break;
  }
  const rest = text.slice(i);
  if (/^[a-z]$/i.test(rest)) spec.key = rest.toLowerCase();
  else if (/^[0-9]$/.test(rest)) spec.code = `Digit${rest}`;
  else if (/^F[0-9]{1,2}$/.test(rest)) spec.code = rest;
  else if (NAMED_KEYS[rest]) Object.assign(spec, NAMED_KEYS[rest]);
  else throw new Error(`kb: unknown key "${rest}" in "${text}"`);
  if (label) spec.label = label;
  return spec;
}

// ---------------------------------------------------------------------------
// display

const MAC_NAMES: Record<string, string> = {
  Enter: "↵", Escape: "Esc", Backspace: "⌫", Delete: "⌦", Tab: "⇥", " ": "Space", Space: "Space",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", PageUp: "PgUp", PageDown: "PgDn",
};
const WIN_NAMES: Record<string, string> = { ...MAC_NAMES, Enter: "Enter", Backspace: "Backspace", Delete: "Del", Tab: "Tab" };
const CODE_NAMES: Record<string, string> = {
  Slash: "/", Backslash: "\\", Quote: "'", BracketLeft: "[", BracketRight: "]", Comma: ",", Period: ".",
  Equal: "=", Minus: "-", Semicolon: ";", Backquote: "`", NumpadAdd: "+", NumpadSubtract: "-",
};

function keyName(s: KeySpec, mac: boolean): string {
  if (s.label) return s.label;
  const names = mac ? MAC_NAMES : WIN_NAMES;
  if (s.key && LETTER.test(s.key)) return s.key.toUpperCase();
  if (s.key && names[s.key]) return names[s.key];
  if (s.code) {
    if (names[s.code]) return names[s.code];
    if (CODE_NAMES[s.code]) return CODE_NAMES[s.code];
    const m = /^(?:Key|Digit|Numpad)(.+)$/.exec(s.code);
    if (m) return m[1];
    return s.code;
  }
  return s.key ?? "";
}

/** Keycaps for one binding: ["⌥", "⌘", "G"] on a Mac (⌃ ⌥ ⇧ ⌘ order), ["Ctrl", "Alt", "G"] elsewhere. */
export function formatKeys(spec: KeySpec, mac = isMac()): string[] {
  const out: string[] = [];
  if (mac) {
    if (spec.ctrl) out.push("⌃");
    if (spec.alt) out.push("⌥");
    if (spec.shift) out.push("⇧");
    if (spec.meta) out.push("⌘");
  } else {
    if (spec.ctrl || spec.meta) out.push("Ctrl");
    if (spec.alt) out.push("Alt");
    if (spec.shift) out.push("Shift");
  }
  out.push(keyName(spec, mac));
  return out;
}

/** A command's first binding as text for messages: "⌘\\" on a Mac, "Ctrl+\\" elsewhere ("" when it has none). */
export function keysText(id: string, mac = isMac()): string {
  const c = commands.get(id);
  const spec = c ? keysOf(c, mac)[0] : undefined;
  return spec ? formatKeys(spec, mac).join(mac ? "" : "+") : "";
}

/** Keycaps for every binding of a command on this platform (gestures included). */
export function commandKeys(c: Command, mac = isMac()): string[][] {
  if (c.gesture) return [c.gesture];
  return keysOf(c, mac).map((s) => formatKeys(s, mac));
}

// ---------------------------------------------------------------------------
// learned shortcuts (the shortcuts panel highlights the ones the designer has used)

const LEARNED_KEY = "qalam/learned-shortcuts";

function loadLearned(): Set<string> {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(LEARNED_KEY) : null;
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export const useLearned = create<{ learned: Set<string> }>(() => ({ learned: loadLearned() }));

function learn(id: string) {
  const { learned } = useLearned.getState();
  if (learned.has(id)) return;
  const next = new Set(learned).add(id);
  useLearned.setState({ learned: next });
  try {
    window.localStorage.setItem(LEARNED_KEY, JSON.stringify([...next]));
  } catch {
    /* storage unavailable: the highlight lasts for this session */
  }
}

// ---------------------------------------------------------------------------
// React

export interface CommandView {
  label: string;
  keys: string[][];
  enabled: true | string;
  checked?: boolean;
  unavailable?: string;
}

/**
 * Label, keycaps and live state of a command for buttons, menus and tooltips. Re-renders when the
 * document state its `enabled` / `checked` read changes.
 */
export function useCommand(id: string): CommandView | undefined {
  useRegistry((r) => r.version);
  useSurfaces();
  // enabled/checked mostly read the studio store; a primitive key keeps re-renders to real changes.
  const state = useStudio(() => {
    const c = commands.get(id);
    if (!c) return "";
    return `${commandState(c)}\u0000${c.checked ? String(safe(c.checked)) : ""}`;
  });
  const c = commands.get(id);
  if (!c || !state) return undefined;
  const [enabled, checked] = state.split("\u0000");
  return {
    label: c.label,
    keys: commandKeys(c),
    enabled: enabled === "true" ? true : enabled,
    ...(c.checked ? { checked: checked === "true" } : {}),
    ...(c.unavailable ? { unavailable: c.unavailable } : {}),
  };
}

function safe(f: () => boolean): boolean {
  try {
    return f();
  } catch {
    return false;
  }
}
