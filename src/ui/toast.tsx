import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import clsx from "clsx";
import { Check, CircleAlert, X } from "lucide-react";
import { onFeedback, type Feedback } from "@/commands/feedback";
import { r } from "./recipes";
import { usePresence } from "./motion";

/*
 * Toasts and the shortcut HUD, bottom-centre above the toolbar. Anything calls
 * `feedback("Copied as PNG", { kind: "success" })` (src/commands/feedback.ts); this renders it.
 * The HUD (info messages) replaces itself in place ("Opacity 40%" → "45%", "Rulers on" → "Outlines
 * on"); success and error toasts stack: newest in front, up to three, older ones tucked behind and
 * fanned out on hover or keyboard focus. Each rises on the spring and drops away when it times out;
 * a horizontal swipe dismisses it (CSS in globals.css). The stack is the one polite live region.
 */

export interface ToastItem extends Feedback {
  /** Unique per toast (ids repeat across time). */
  key: number;
  open: boolean;
  /** Bumped when a same-id message replaces this one, to restart its timer. */
  rev: number;
}

export const MAX_TOASTS = 3;

/** How long a toast stays up. HUD-style info is brief; errors wait to be read. */
export const toastDuration = (f: Pick<Feedback, "kind" | "message">) =>
  f.kind === "error" ? 6000 : f.kind === "success" ? 2600 : Math.min(4000, 1400 + f.message.length * 20);

/**
 * Add a message. The HUD (info: "Rulers on", "Opacity 40%") is one slot that replaces in place and
 * never stacks; a message with the same id as an open toast replaces it too. Anything else goes in
 * front and the overflow closes.
 */
export function pushToast(list: ToastItem[], f: Feedback, key: number): ToastItem[] {
  const same = list.find((t) => t.open && t.id === f.id) ?? (f.kind === "info" ? list.find((t) => t.open && t.kind === "info") : undefined);
  if (same) return list.map((t) => (t === same ? { ...t, id: f.id, message: f.message, kind: f.kind, rev: t.rev + 1 } : t));
  const next = [{ ...f, key, open: true, rev: 0 }, ...list];
  let open = 0;
  return next.map((t) => (t.open && ++open > MAX_TOASTS ? { ...t, open: false } : t));
}

export const closeToast = (list: ToastItem[], key: number) => list.map((t) => (t.key === key ? { ...t, open: false } : t));
export const removeToast = (list: ToastItem[], key: number) => list.filter((t) => t.key !== key);

/** How far (px) a toast must be dragged sideways before letting go dismisses it. */
export const SWIPE_DISMISS = 48;
/** Movement (px) before a press on a toast counts as a swipe rather than a click. */
export const SWIPE_SLOP = 4;

/** What letting go of a swipe does: dismiss past the threshold (either direction), else spring back. */
export const swipeOutcome = (dx: number): "end" | "cancel" => (Math.abs(dx) >= SWIPE_DISMISS ? "end" : "cancel");

/** Depth of each toast in the stack: 0 = newest open one; closing toasts keep the slot they had. */
export function stackDepths(list: ToastItem[]): Map<number, number> {
  const out = new Map<number, number>();
  let d = 0;
  for (const t of list) out.set(t.key, t.open ? d++ : Math.min(d, MAX_TOASTS));
  return out;
}

export default function Toasts() {
  const [list, setList] = useState<ToastItem[]>([]);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const seq = useRef(0);

  useEffect(() => onFeedback((f) => setList((l) => pushToast(l, f, ++seq.current))), []);

  const depths = stackDepths(list);
  return (
    <div
      className="q-toast-stack"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocused(false)}
    >
      {list.map((t) => (
        <ToastView
          key={t.key}
          toast={t}
          depth={depths.get(t.key) ?? 0}
          paused={paused}
          onClose={() => setList((l) => closeToast(l, t.key))}
          onGone={() => setList((l) => removeToast(l, t.key))}
        />
      ))}
    </div>
  );
}

function ToastView({ toast, depth, paused, onClose, onGone }: { toast: ToastItem; depth: number; paused: boolean; onClose: () => void; onGone: () => void }) {
  const p = usePresence<HTMLDivElement>(toast.open);
  const [swipe, setSwipe] = useState<"move" | "cancel" | "end" | undefined>();
  const drag = useRef<{ x: number; dx: number; moved: boolean } | null>(null);

  // Time out (restarted by a replacement; held while the pointer is over the stack).
  useEffect(() => {
    if (!toast.open || paused) return;
    const t = setTimeout(onClose, toastDuration(toast));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.open, toast.rev, paused]);

  useEffect(() => {
    if (!p.mounted) onGone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.mounted]);

  // Swipe sideways to dismiss. The toast follows the pointer through --swipe-x (the `translate`
  // property, so it composes with the enter/exit keyframes' `transform`).
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !toast.open || (e.target as HTMLElement).closest("button")) return;
    drag.current = { x: e.clientX, dx: 0, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.dx = e.clientX - d.x;
    if (!d.moved && Math.abs(d.dx) < SWIPE_SLOP) return;
    d.moved = true;
    e.currentTarget.style.setProperty("--swipe-x", `${d.dx}px`);
    if (swipe !== "move") setSwipe("move");
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    const outcome = swipeOutcome(d.dx);
    setSwipe(outcome);
    if (outcome === "end") onClose();
  };

  if (!p.mounted) return null;
  const error = toast.kind === "error";
  // Tucked toasts are invisible until the stack fans out (hover, or focus inside it).
  const reachable = toast.open && (depth === 0 || paused);
  return (
    <div data-i={Math.min(depth, MAX_TOASTS)} style={{ "--i": Math.min(depth, MAX_TOASTS) } as CSSProperties} aria-hidden={!toast.open || undefined}>
      <div
        ref={p.ref}
        data-state={p.state}
        data-swipe={swipe}
        className={clsx(r.toast, "touch-pan-y select-none", toast.kind === "info" && "pl-[14px]")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {toast.kind !== "info" && (
          <span className={clsx(r.toastIcon, error && "bg-danger-subtle text-danger")} aria-hidden>
            {error ? <CircleAlert size={12} /> : <Check size={12} strokeWidth={2.25} />}
          </span>
        )}
        {/* key on rev: a replaced message swaps with a short fade instead of re-entering the toast */}
        <span key={toast.rev} className={clsx("max-w-[420px] truncate", toast.rev > 0 && "q-fade")}>
          {error && <span className="sr-only">Error: </span>}
          {toast.message}
        </span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onClose}
          className={clsx(r.iconButtonSm, "ml-[2px]")}
          tabIndex={reachable ? 0 : -1}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
