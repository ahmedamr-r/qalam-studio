import type { PlayAction, RouteRef } from "@/doc/schema";
import type { Clip } from "@/proto/walk";
import type { Cursor } from "./cursor";
import { boxIn, showing } from "./dom";

/*
 * Playback: a walkthrough's clips performed on the live prototype. The cursor glides to what each
 * action names and taps it for real — the prototype's own handlers run, so what plays is what a
 * person would get — scrolls the screen, and rings what changed. It stops when asked (a pause, a
 * jump, the session closing), between moves.
 */

export interface Stage {
  /** The device: the cursor's layer covers it. */
  device: HTMLElement;
  find: (ref: RouteRef) => HTMLElement | null;
  scroller: () => HTMLElement | null;
  cursor: Cursor;
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Stopped", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("Stopped", "AbortError"))), { once: true });
  });

/** Waits for an element to show (a sheet still rising), up to `ms`; what was found, showing or not. */
async function until(stage: Stage, ref: RouteRef, ms: number, signal: AbortSignal): Promise<HTMLElement | null> {
  const t0 = performance.now();
  for (;;) {
    const el = stage.find(ref);
    if ((el && showing(stage.device, el)) || performance.now() - t0 > ms) return el;
    await wait(60, signal);
  }
}

/** Can it be seen: is it what's on top at its middle (not scrolled away, not under the pinned top or bottom)? */
function inView(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 16));
  return !!hit && (hit === el || el.contains(hit));
}

/**
 * Brings an element into view when it's scrolled away or under what's pinned. What's pinned (a
 * sticky row, the bar over the footer) is always in view: scrolling wouldn't move it, only what's
 * under it.
 */
async function reach(stage: Stage, el: HTMLElement, signal: AbortSignal) {
  const sc = stage.scroller();
  if (!sc || !sc.contains(el) || inView(el)) return;
  const s = sc.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  sc.scrollTo({ top: sc.scrollTop + (r.top - s.top) - s.height * 0.4, behavior: "smooth" });
  await wait(650, signal);
}

/** A pointer event at an element's middle, as a finger there would send it. */
function pointer(el: HTMLElement, type: "pointerdown" | "pointerup") {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: type === "pointerdown" ? 1 : 0, pointerType: "touch", isPrimary: true }));
}

async function perform(stage: Stage, a: PlayAction, signal: AbortSignal) {
  const { cursor, device } = stage;
  const w = device.clientWidth;
  const h = device.clientHeight;
  if (a.do === "scroll") {
    // The cursor drags the content: down the screen to scroll back up, up it to scroll on.
    const sc = stage.scroller();
    const down = a.y > (sc?.scrollTop ?? 0);
    await cursor.moveTo(w * 0.62, h * (down ? 0.7 : 0.35));
    sc?.scrollTo({ top: a.y, behavior: "smooth" });
    await cursor.moveTo(w * 0.62, h * (down ? 0.35 : 0.7), 650);
    await wait(250, signal);
    return;
  }
  const el = await until(stage, a.ref, 1600, signal);
  // Not there (a part that didn't open): nothing to show, go on.
  if (!el) return;
  await reach(stage, el, signal);
  const b = boxIn(device, el);
  await cursor.moveTo(b.x + b.w / 2, b.y + b.h / 2);
  signal.throwIfAborted();
  if (a.do === "tap") {
    // A finger's tap: down, a beat, up, so the prototype shows it pressed (feel.ts), then the click.
    cursor.tap();
    pointer(el, "pointerdown");
    await wait(110, signal);
    pointer(el, "pointerup");
    el.click();
    await wait(700, signal);
  } else {
    cursor.ring(boxIn(device, el));
    await wait(1200, signal);
    cursor.ring(null);
  }
}

/** Plays the clips from `from` on, telling `at` which clip and action is playing (-1 when it's done). */
export async function play(stage: Stage, clips: Clip[], from: number, at: (clip: number, action: number) => void, signal: AbortSignal): Promise<void> {
  try {
    for (let i = from; i < clips.length; i++) {
      for (const [j, a] of clips[i].actions.entries()) {
        signal.throwIfAborted();
        at(i, j);
        await perform(stage, a, signal);
      }
      await wait(400, signal);
    }
    at(-1, 0);
  } catch (e) {
    if ((e as Error).name !== "AbortError") throw e;
  } finally {
    stage.cursor.hide();
  }
}
