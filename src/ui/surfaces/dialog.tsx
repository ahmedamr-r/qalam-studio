import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import clsx from "clsx";
import { create } from "zustand";
import { TriangleAlert } from "lucide-react";
import { formatKeys, kb } from "@/commands/registry";
import { r } from "../recipes";
import { usePresence } from "../motion";
import { Kbd } from "../controls";

/*
 * Promise-based dialogs that replace window.confirm / window.prompt:
 *
 *   if (await confirmDialog({ title: "Delete “Wallet”?", body: "…", confirmLabel: "Delete", danger: true })) remove();
 *   const name = await promptDialog({ title: "Rename chat", defaultValue: chat.title });
 *
 * One dialog shows at a time (later calls queue). Focus is trapped inside and returns to where it was;
 * Esc or a click on the scrim cancels, ↵ confirms. The scrim fades, the card scales from .96 (q-overlay
 * + q-dialog), and both play their exit before unmounting. <DialogHost/> is mounted by <CommandSurfaces/>.
 */

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  /** Default "OK". */
  confirmLabel?: string;
  /** Default "Cancel"; null leaves only the confirm button (a notice to acknowledge). */
  cancelLabel?: string | null;
  /** Destructive: the confirm button turns danger and the title gets a warning icon. */
  danger?: boolean;
}

export interface PromptOptions extends Omit<ConfirmOptions, "danger"> {
  defaultValue?: string;
  placeholder?: string;
  /** Caption above the field. */
  label?: string;
  /** Return a reason to keep the dialog open ("Name can't be empty"), or null when the value is fine. */
  validate?: (value: string) => string | null;
}

type Request =
  | ({ kind: "confirm"; id: number; resolve: (ok: boolean) => void } & ConfirmOptions)
  | ({ kind: "prompt"; id: number; resolve: (value: string | null) => void } & PromptOptions);

const useDialogs = create<{ queue: Request[] }>(() => ({ queue: [] }));
let seq = 0;

/** Ask a yes/no question. Resolves true on confirm, false on cancel (Esc, scrim, Cancel). */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogs.setState((s) => ({ queue: [...s.queue, { ...opts, kind: "confirm", id: ++seq, resolve }] }));
  });
}

/** Ask for a line of text. Resolves the trimmed value, or null when cancelled. */
export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogs.setState((s) => ({ queue: [...s.queue, { ...opts, kind: "prompt", id: ++seq, resolve }] }));
  });
}

/** Settle the front request and move the queue on. */
function settle(req: Request, value: boolean | string | null) {
  useDialogs.setState((s) => ({ queue: s.queue.filter((q) => q.id !== req.id) }));
  if (req.kind === "confirm") req.resolve(value === true);
  else req.resolve(typeof value === "string" ? value : null);
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function DialogHost() {
  const front = useDialogs((s) => s.queue[0] ?? null);
  // Keep the last request on screen while its exit plays.
  const [shown, setShown] = useState<Request | null>(front);
  if (front && front !== shown) setShown(front);
  const p = usePresence<HTMLDivElement>(!!front);
  if (!p.mounted || !shown) return null;
  return <DialogView key={shown.id} req={shown} state={p.state} presenceRef={p.ref} />;
}

function DialogView({ req, state, presenceRef }: { req: Request; state: "open" | "closed"; presenceRef: (el: HTMLDivElement | null) => void }) {
  const card = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState(req.kind === "prompt" ? (req.defaultValue ?? "") : "");
  const [error, setError] = useState<string | null>(null);
  const [nope, setNope] = useState(0);
  const open = state === "open";
  const titleId = `qd-title-${req.id}`;
  const bodyId = `qd-body-${req.id}`;

  // Focus moves in on open and goes back to whatever had it on close.
  useLayoutEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    if (input.current) {
      input.current.focus();
      input.current.select();
    } else if (req.kind === "confirm" && req.danger) {
      // Destructive: nothing is pre-focused (no ring on Delete); ↵ still confirms, as its label is explicit.
      card.current?.focus();
    } else confirmBtn.current?.focus();
    return () => {
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (!nope) return;
    const t = setTimeout(() => setNope(0), 160);
    return () => clearTimeout(t);
  }, [nope]);

  const done = (ok: boolean) => {
    if (!open) return;
    if (!ok) return settle(req, req.kind === "confirm" ? false : null);
    if (req.kind === "confirm") return settle(req, true);
    const v = value.trim();
    const why = req.validate?.(v) ?? (v ? null : "Enter a value");
    if (why) {
      setError(why);
      setNope((n) => n + 1);
      input.current?.focus();
      return;
    }
    settle(req, v);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    // Nothing typed here reaches the canvas shortcuts.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      return done(false);
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      // A focused Cancel button keeps its own Enter.
      if ((e.target as HTMLElement).dataset.cancel !== undefined) return;
      e.preventDefault();
      return done(true);
    }
    if (e.key === "Tab") {
      const items = [...(card.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
      e.preventDefault();
      items[next].focus();
    }
  };

  const danger = req.kind === "confirm" && req.danger;
  return (
    <>
      <div data-state={state} className={clsx(r.overlay, "z-[70]")} onPointerDown={() => done(false)} aria-hidden />
      <div
        ref={(el) => {
          card.current = el;
          presenceRef(el);
        }}
        role={danger ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={req.body ? bodyId : undefined}
        tabIndex={-1}
        data-state={state}
        onKeyDown={onKeyDown}
        className={clsx(r.modal, "fixed left-1/2 top-[22vh] z-[71] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden outline-none")}
      >
        <div className="flex gap-[12px] px-[20px] pt-[18px] pb-[16px]">
          {danger && (
            <span className="mt-[1px] grid size-[28px] shrink-0 place-items-center rounded-full bg-danger-subtle text-danger">
              <TriangleAlert size={14} absoluteStrokeWidth strokeWidth={1.25} />
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
            <h2 id={titleId} className="text-title font-semibold text-fg">
              {req.title}
            </h2>
            {req.body && (
              <div id={bodyId} className="text-body leading-[20px] text-fg-muted">
                {req.body}
              </div>
            )}
            {req.kind === "prompt" && (
              <label className="mt-[6px] flex flex-col gap-[4px]">
                {req.label && <span className="text-micro text-fg-subtle">{req.label}</span>}
                <span className={clsx(r.field, "h-[32px]", error && r.fieldInvalid, nope > 0 && "q-shake")}>
                  <input
                    ref={input}
                    value={value}
                    placeholder={req.placeholder}
                    aria-invalid={!!error || undefined}
                    onChange={(e) => {
                      setValue(e.target.value);
                      setError(null);
                    }}
                    className={clsx(r.fieldInput, "text-body")}
                  />
                </span>
                {error && <span className="text-caption text-danger">{error}</span>}
              </label>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-[8px] border-t border-line-subtle bg-muted px-[16px] py-[12px]">
          {req.cancelLabel !== null && (
            <button type="button" data-cancel="" onClick={() => done(false)} className={clsx(r.button, r.buttonSecondary)}>
              {req.cancelLabel ?? "Cancel"}
            </button>
          )}
          <button
            ref={confirmBtn}
            type="button"
            onClick={() => done(true)}
            className={clsx(r.button, danger ? r.buttonDanger : r.buttonPrimary, "q-item", !danger && "pr-[6px]")}
          >
            {req.confirmLabel ?? "OK"}
            {!danger && <Kbd keys={formatKeys(kb("↵"))} size="sm" onInverse />}
          </button>
        </div>
      </div>
    </>
  );
}
