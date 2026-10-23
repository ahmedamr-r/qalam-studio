/*
 * The playback cursor: a pointer that moves over the device to what a step touches, ripples when
 * it taps, and rings what it rests on. It's drawn in a layer over the device that takes no input
 * (the prototype underneath is what's tapped), and moves by CSS transitions, so it keeps going
 * smoothly while the prototype animates.
 */

export interface Cursor {
  /** Glide to (x, y) in the layer, taking about `ms`. */
  moveTo: (x: number, y: number, ms?: number) => Promise<void>;
  tap: () => void;
  /** Ring a box (null: no ring). */
  ring: (box: { x: number; y: number; w: number; h: number } | null) => void;
  hide: () => void;
  /** Where it is now. */
  at: () => { x: number; y: number };
  dispose: () => void;
}

const POINTER = `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M4 2.5v15.2l4.1-3.9 2.6 6 2.9-1.3-2.6-5.9h5.6L4 2.5Z" fill="#fff" stroke="#0b0b0c" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A cursor in `layer` (positioned, the device's size). */
export function createCursor(layer: HTMLElement): Cursor {
  const pointer = document.createElement("div");
  pointer.innerHTML = POINTER;
  Object.assign(pointer.style, { position: "absolute", left: "0", top: "0", width: "22px", height: "22px", opacity: "0", transition: "opacity 160ms ease", filter: "drop-shadow(0 1px 2px rgb(0 0 0 / 0.35))", zIndex: "3", willChange: "transform" });
  const ring = document.createElement("div");
  Object.assign(ring.style, { position: "absolute", left: "0", top: "0", borderRadius: "10px", border: "2px solid var(--color-selection)", boxShadow: "0 0 0 4px rgb(55 137 253 / 0.18)", opacity: "0", transition: "opacity 180ms ease, transform 260ms cubic-bezier(.2,.8,.2,1), width 260ms cubic-bezier(.2,.8,.2,1), height 260ms cubic-bezier(.2,.8,.2,1)", pointerEvents: "none", zIndex: "2" });
  layer.append(ring, pointer);
  let pos = { x: layer.clientWidth / 2, y: layer.clientHeight * 0.7 };
  const place = (ms: number) => {
    pointer.style.transition = `opacity 160ms ease, transform ${ms}ms cubic-bezier(.3,.7,.2,1)`;
    pointer.style.transform = `translate(${pos.x - 4}px, ${pos.y - 2}px)`;
  };
  place(0);
  return {
    async moveTo(x, y, ms) {
      const d = Math.hypot(x - pos.x, y - pos.y);
      const t = ms ?? Math.round(Math.min(650, Math.max(260, d * 1.1)));
      pointer.style.opacity = "1";
      pos = { x, y };
      place(t);
      await wait(t);
    },
    tap() {
      const ripple = document.createElement("div");
      Object.assign(ripple.style, { position: "absolute", left: `${pos.x - 18}px`, top: `${pos.y - 18}px`, width: "36px", height: "36px", borderRadius: "50%", background: "rgb(55 137 253 / 0.35)", pointerEvents: "none", zIndex: "2" });
      layer.append(ripple);
      ripple.animate([{ transform: "scale(0.3)", opacity: 1 }, { transform: "scale(1.4)", opacity: 0 }], { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" }).onfinish = () => ripple.remove();
      pointer.animate([{ scale: "1" }, { scale: "0.86" }, { scale: "1" }], { duration: 220 });
    },
    ring(box) {
      if (!box) {
        ring.style.opacity = "0";
        return;
      }
      Object.assign(ring.style, { opacity: "1", width: `${box.w + 8}px`, height: `${box.h + 8}px`, transform: `translate(${box.x - 4}px, ${box.y - 4}px)` });
    },
    hide() {
      pointer.style.opacity = "0";
      ring.style.opacity = "0";
    },
    at: () => pos,
    dispose() {
      pointer.remove();
      ring.remove();
    },
  };
}
