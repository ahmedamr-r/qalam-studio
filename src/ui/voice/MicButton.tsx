import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import clsx from "clsx";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Mic } from "lucide-react";
import { create } from "zustand";
import { listenVoice, loadVoice, stopVoice, useVoice } from "@/org/voice";
import { r } from "../recipes";
import { insertAtCursor, selectionOf } from "./insert";

/*
 * The mic in a box people write in: click to talk, click again to put what was said at the
 * cursor, Esc to drop it. What's heard so far shows above the mic while it listens. One listen at a
 * time in the window; it shows only where this Mac has an engine on (src/voice/model.ts).
 */

type Phase = "idle" | "starting" | "listening" | "finishing";

const useDictation = create<{
  owner: symbol | null;
  phase: Phase;
  partial: string;
  level: number;
  error: { owner: symbol; text: string } | null;
}>(() => ({ owner: null, phase: "idle", partial: "", level: 0, error: null }));

let ctrl: AbortController | null = null;
let deliver: ((said: string) => void) | null = null;

function end() {
  ctrl = null;
  deliver = null;
  useDictation.setState({ owner: null, phase: "idle", partial: "", level: 0 });
}

function startDictation(owner: symbol, onText: (said: string) => void) {
  cancelDictation();
  const c = new AbortController();
  ctrl = c;
  deliver = onText;
  useDictation.setState({
    owner,
    phase: "starting",
    partial: "",
    level: 0,
    error: null,
  });
  const failed = (text: string) => {
    end();
    useDictation.setState({ error: { owner, text } });
  };
  void listenVoice(c.signal, (l) => {
    if (ctrl !== c) return;
    if (l.t === "ready") useDictation.setState({ phase: "listening" });
    else if (l.t === "level") useDictation.setState({ level: l.v });
    else if (l.t === "partial") useDictation.setState({ partial: l.text });
    else if (l.t === "final") {
      const put = deliver;
      end();
      if (l.text) put?.(l.text);
    } else if (l.t === "cancelled") end();
    else if (l.t === "error") {
      failed(l.message);
      if (l.code === "mic-denied") void loadVoice(true);
    }
  })
    .catch((e) => ctrl === c && failed(e instanceof Error ? e.message : String(e)))
    .finally(() => ctrl === c && end());
}

function finishDictation() {
  useDictation.setState({ phase: "finishing" });
  void stopVoice();
}

export function cancelDictation() {
  ctrl?.abort();
  if (ctrl) end();
}

/** The mics on screen, by the box each writes into (for the Talk shortcut). */
const mics = new Set<{
  field: RefObject<HTMLElement | null>;
  toggle: () => void;
}>();

/** Talk into the focused box, or finish: false when it has no mic. */
export function toggleDictationHere(): boolean {
  const at = document.activeElement;
  for (const m of mics) {
    if (at && m.field.current?.contains(at)) {
      m.toggle();
      return true;
    }
  }
  return false;
}

/** What was said, put at the cursor of a text box whose value `set` keeps (a one-line box folds line breaks; its maxLength holds). */
export function speechInto(ref: RefObject<HTMLInputElement | HTMLTextAreaElement | null>, set: (value: string) => void, o: { max?: number } = {}) {
  return (said: string) => {
    const el = ref.current;
    if (!el) return;
    const { value, caret } = insertAtCursor(el.value, selectionOf(el), said, {
      oneLine: el.tagName === "INPUT",
      max: o.max ?? (el.maxLength > 0 ? el.maxLength : undefined),
    });
    set(value);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };
}

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export function MicButton({ onText, field, size = "sm", className }: { onText: (said: string) => void; field?: RefObject<HTMLElement | null>; size?: "sm" | "md"; className?: string }) {
  const use = useVoice((v) => v.view?.use ?? null);
  const me = useRef(Symbol("mic")).current;
  const d = useDictation();
  const [hover, setHover] = useState(false);
  const mine = d.owner === me;
  const on = mine && d.phase !== "idle";
  const toggle = useRef(() => {});
  toggle.current = () => {
    const s = useDictation.getState();
    if (s.owner !== me || s.phase === "idle") startDictation(me, onText);
    else if (s.phase === "listening") finishDictation();
    else cancelDictation();
  };

  useEffect(() => void loadVoice(), []);
  useEffect(() => {
    if (!field) return;
    const entry = { field, toggle: () => toggle.current() };
    mics.add(entry);
    return () => void mics.delete(entry);
  }, [field]);
  // Esc drops what was said, before the box hears it.
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancelDictation();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [on]);
  useEffect(() => () => void (useDictation.getState().owner === me && cancelDictation()), [me]);
  useEffect(() => {
    if (!d.error || d.error.owner !== me) return;
    const t = setTimeout(() => useDictation.setState({ error: null }), 8000);
    return () => clearTimeout(t);
  }, [d.error, me]);

  if (!use) return null;
  const error = d.error?.owner === me ? d.error.text : null;
  const label = on ? (d.phase === "listening" ? "Finish" : "Stop") : "Talk";
  return (
    <Tooltip.Root open={on || !!error || hover} onOpenChange={setHover}>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={on}
          // The box keeps the focus (and its cursor) while the mic is clicked.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggle.current()}
          className={clsx(size === "sm" ? r.iconButtonSm : r.iconButton, "relative", on && "text-ai", className)}
        >
          {on && (
            <span
              aria-hidden
              className="absolute inset-[2px] rounded-full bg-ai/15 transition-transform duration-quick"
              style={{
                transform: `scale(${(0.7 + d.level * 0.6).toFixed(2)})`,
              }}
            />
          )}
          <Mic size={size === "sm" ? 14 : 16} {...ICON} className="relative" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className={clsx(r.tooltip, "h-auto min-h-[26px] max-w-[320px] py-[4px] pr-[8px]")}
          onPointerDownOutside={(e) => on && e.preventDefault()}
        >
          {on ? (
            <span className="flex min-w-0 flex-col gap-[2px] py-[2px]">
              <span className={clsx("text-fg-muted", !d.partial && "q-shimmer-text")} dir="auto">
                {d.partial || (d.phase === "starting" ? "Starting the mic…" : d.phase === "finishing" ? "Finishing…" : "Listening…")}
              </span>
              <span className="text-micro font-normal text-fg-subtle">Click the mic to put it in · Esc to drop it</span>
            </span>
          ) : error ? (
            <span className="text-danger">{error}</span>
          ) : (
            "Talk instead of typing"
          )}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/**
 * A text box with the mic in its corner (bottom right for a box of lines, the middle of the right
 * edge for one line); the box makes room for it only when this Mac has a mic on.
 */
export function Dictated({
  field,
  set,
  children,
  className,
  max,
}: {
  field: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  set: (value: string) => void;
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const use = useVoice((v) => v.view?.use ?? null);
  const [line, setLine] = useState(false);
  useEffect(() => setLine(field.current?.tagName === "INPUT"), [field]);
  return (
    <div className={clsx("relative min-w-0", use && (line ? "[&>input]:pr-[30px]" : "[&>textarea]:pr-[32px]"), className)}>
      {children}
      {use && (
        <span className={clsx("absolute right-[4px]", line ? "top-1/2 -translate-y-1/2" : "bottom-[4px]")}>
          <MicButton field={field} onText={speechInto(field, set, { max })} />
        </span>
      )}
    </div>
  );
}
