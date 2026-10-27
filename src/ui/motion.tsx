import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";

/*
 * Motion helpers. The motion itself is CSS (tokens + .q-* classes in src/ui/globals.css); these only
 * measure, gate and keep things mounted long enough to animate out. No animation library.
 */

export const MOTION_KEY = "qalam.motion";

const hasDOM = () => typeof document !== "undefined";

/** True when the OS asks for less motion (unless the in-app setting says "full"), or the in-app setting says "reduced". */
export function reducedMotion(): boolean {
  if (!hasDOM()) return false;
  const pref = document.documentElement.dataset.motion;
  if (pref === "reduced") return true;
  if (pref === "full") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** In-app override of the OS setting ("system" clears it). Persisted; layout.tsx applies it before paint. */
export function setMotionPreference(pref: "system" | "reduced" | "full") {
  if (!hasDOM()) return;
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.motion;
  else root.dataset.motion = pref;
  try {
    if (pref === "system") localStorage.removeItem(MOTION_KEY);
    else localStorage.setItem(MOTION_KEY, pref);
  } catch {
    // Storage blocked: this session only.
  }
}

let armed = false;

/**
 * Boot gate: globals.css disables every transition until <html data-motion-ready>, so panels and
 * indicators restored from storage do not animate in. Call once the studio has mounted; it arms
 * after two frames. Also pauses CSS loops while the tab is hidden (data-doc-hidden).
 */
export function armMotion() {
  if (!hasDOM() || armed) return;
  armed = true;
  const root = document.documentElement;
  requestAnimationFrame(() => requestAnimationFrame(() => (root.dataset.motionReady = "")));
  const sync = () => {
    if (document.hidden) root.dataset.docHidden = "";
    else delete root.dataset.docHidden;
  };
  sync();
  document.addEventListener("visibilitychange", sync);
}

/** Morph one element between two layouts (workspace modal ↔ full screen). Instant without support or with reduced motion. */
export function withViewTransition(name: string, el: HTMLElement | null, update: () => void) {
  const start = hasDOM() ? (document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }).startViewTransition : undefined;
  if (!el || !start || reducedMotion()) return update();
  el.style.viewTransitionName = name;
  const vt = start.call(document, () => flushSync(update));
  void vt.finished.finally(() => (el.style.viewTransitionName = ""));
}

// ── Sliding indicator ────────────────────────────────────────────────────────

export interface IndicatorBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The active item's box relative to the container's content (scroll included), rounded to whole px. */
export function indicatorBox(container: DOMRectReadOnly, item: DOMRectReadOnly, scroll = { left: 0, top: 0 }, border = { left: 0, top: 0 }): IndicatorBox {
  return {
    x: Math.round(item.left - container.left - border.left + scroll.left),
    y: Math.round(item.top - container.top - border.top + scroll.top),
    w: Math.round(item.width),
    h: Math.round(item.height),
  };
}

export interface SlidingIndicatorOptions {
  /** Which coordinates to write; the other axis keeps the indicator's CSS position. Default "both". */
  axis?: "x" | "y" | "both";
  /** Jump without animating this time (key switches, held arrow keys, a filtered list). */
  instant?: boolean;
}

/**
 * One element (the toolbar key, rail marker, segmented thumb, tab underline, palette highlight)
 * that glides to whichever child of the container carries `data-indicator-active`.
 *
 *   const { containerRef, indicatorRef } = useSlidingIndicator<HTMLDivElement>(value);
 *   <div ref={containerRef} className="relative">
 *     <span ref={indicatorRef} className="q-indicator …" />
 *     {items.map((i) => <button data-indicator-active={i === value || undefined} … />)}
 *   </div>
 *
 * Writes --x/--y/--w/--h on the indicator (.q-indicator reads them). The first placement, resizes
 * and `instant` moves set data-instant for one frame; data-ready arms the transition after the first
 * placement. With no active item the indicator gets data-hidden (style it with data-[hidden]:opacity-0).
 */
export function useSlidingIndicator<C extends HTMLElement = HTMLElement, I extends HTMLElement = HTMLElement>(
  activeKey: unknown,
  { axis = "both", instant = false }: SlidingIndicatorOptions = {},
): { containerRef: RefObject<C | null>; indicatorRef: RefObject<I | null>; update: (instant?: boolean) => void } {
  const containerRef = useRef<C | null>(null);
  const indicatorRef = useRef<I | null>(null);
  const placed = useRef(false);
  const frame = useRef(0);

  const update = useCallback(
    (jump = false) => {
      const c = containerRef.current;
      const ind = indicatorRef.current;
      if (!c || !ind) return;
      const item = c.querySelector<HTMLElement>("[data-indicator-active]");
      if (!item) {
        ind.dataset.hidden = "";
        return;
      }
      delete ind.dataset.hidden;
      const cs = getComputedStyle(c);
      const box = indicatorBox(c.getBoundingClientRect(), item.getBoundingClientRect(), { left: c.scrollLeft, top: c.scrollTop }, { left: parseFloat(cs.borderLeftWidth) || 0, top: parseFloat(cs.borderTopWidth) || 0 });
      const noAnim = jump || !placed.current;
      if (noAnim) ind.dataset.instant = "";
      if (axis !== "y") {
        ind.style.setProperty("--x", `${box.x}px`);
        ind.style.setProperty("--w", `${box.w}px`);
      }
      if (axis !== "x") {
        ind.style.setProperty("--y", `${box.y}px`);
        ind.style.setProperty("--h", `${box.h}px`);
      }
      if (axis === "x") ind.style.setProperty("--h", `${box.h}px`);
      if (axis === "y") ind.style.setProperty("--w", `${box.w}px`);
      placed.current = true;
      if (noAnim) {
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          frame.current = requestAnimationFrame(() => {
            delete ind.dataset.instant;
            ind.dataset.ready = "";
          });
        });
      }
    },
    [axis],
  );

  useLayoutEffect(() => update(instant), [activeKey, instant, update]);

  useEffect(() => {
    const c = containerRef.current;
    if (!c || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => update(true));
    ro.observe(c);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [update]);

  return { containerRef, indicatorRef, update };
}

// ── Presence (exit animations for our own components) ────────────────────────

export type PresenceState = "open" | "closed";

/**
 * Keeps an element mounted while its `data-state="closed"` keyframe plays, like Radix Presence
 * (Radix content already does this; use this for hand-rolled toasts, cards and panels).
 * Unmounts at once when the closed state has no animation (or reduced motion zeroed it).
 */
export function usePresence<T extends HTMLElement = HTMLElement>(present: boolean): { mounted: boolean; state: PresenceState; ref: (el: T | null) => void } {
  const [mounted, setMounted] = useState(present);
  const el = useRef<T | null>(null);
  const ref = useCallback((node: T | null) => void (el.current = node), []);

  // Mount synchronously when `present` turns on (no frame without the element).
  if (present && !mounted) setMounted(true);

  useEffect(() => {
    if (present || !mounted) return;
    const node = el.current;
    if (!node) return setMounted(false);
    const style = getComputedStyle(node);
    const names = style.animationName.split(",").map((s) => s.trim());
    const longest = Math.max(0, ...style.animationDuration.split(",").map((d) => parseFloat(d) * (d.trim().endsWith("ms") ? 1 : 1000)));
    if (names.every((n) => n === "none") || longest === 0) return setMounted(false);
    const done = (e: AnimationEvent) => {
      if (e.target === node) setMounted(false);
    };
    node.addEventListener("animationend", done);
    node.addEventListener("animationcancel", done);
    // Safety net: a hidden tab pauses animations (data-doc-hidden) and animationend never fires.
    const t = window.setTimeout(() => setMounted(false), longest + 120);
    return () => {
      node.removeEventListener("animationend", done);
      node.removeEventListener("animationcancel", done);
      clearTimeout(t);
    };
  }, [present, mounted]);

  return { mounted: present || mounted, state: present ? "open" : "closed", ref };
}

/**
 * Render-prop form of usePresence:
 *   <Presence present={open}>{({ ref, state }) => <div ref={ref} data-state={state} className="q-pop">…</div>}</Presence>
 */
export function Presence<T extends HTMLElement = HTMLElement>({ present, children }: { present: boolean; children: (p: { ref: (el: T | null) => void; state: PresenceState }) => ReactNode }) {
  const p = usePresence<T>(present);
  return p.mounted ? <>{children({ ref: p.ref, state: p.state })}</> : null;
}
