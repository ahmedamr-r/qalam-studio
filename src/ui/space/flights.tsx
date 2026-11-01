import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { FileText } from "lucide-react";
import { nanoid } from "nanoid";
import { create } from "zustand";
import { reducedMotion } from "../motion";
import { useDock } from "./dock";

/*
 * A source the canvas's chat makes (a brain dump, a file read for a card, what customers said
 * taken in) is thrown to the canvas's Sources button: a chip with its title flies from the message
 * that made it, the button gives a little bump as it lands, and counts what's new until the
 * sources are opened. With less motion asked for, or the chat folded, only the count.
 */

interface Flight {
  id: string;
  title: string;
  from: { x: number; y: number };
}

export const useSourceNews = create<{ flights: Flight[]; fresh: number }>(() => ({ flights: [], fresh: 0 }));

const MAX_FLYING = 4;

/** Where a source thrown from the chat starts: the newest message they sent, else the chat itself. */
function origin(): { x: number; y: number } | null {
  const chat = document.querySelector<HTMLElement>("[data-ask-bar]");
  if (!chat) return null;
  const sent = chat.querySelectorAll<HTMLElement>("[data-chat-you]");
  const r = (sent.length ? sent[sent.length - 1] : chat).getBoundingClientRect();
  return r.width && r.height ? { x: r.left + Math.min(r.width / 2, 160), y: r.top + r.height / 2 } : null;
}

/** New on the Sources button, unless the sources are open already. */
const arrived = () => {
  if (!useDock.getState().open) useSourceNews.setState((s) => ({ fresh: s.fresh + 1 }));
};

/** A source the chat made: it flies to Sources (or, with no flight, just counts as new there). */
export function sourceCame(title: string) {
  const from = reducedMotion() ? null : origin();
  if (!from || useSourceNews.getState().flights.length >= MAX_FLYING) return arrived();
  useSourceNews.setState((s) => ({ flights: [...s.flights, { id: nanoid(6), title: title.trim() || "Source", from }] }));
}

/** The sources were opened: nothing's new. */
export const seenSources = () => useSourceNews.setState({ fresh: 0 });

const DURATION = 720;
const STEPS = 16;

/** The flying chips, landing on `target` (the Sources button). */
export function SourceFlights({ target }: { target: RefObject<HTMLElement | null> }) {
  const flights = useSourceNews((s) => s.flights);
  if (!flights.length) return null;
  return createPortal(
    <>
      {flights.map((f) => (
        <Chip key={f.id} flight={f} target={target} />
      ))}
    </>,
    document.body,
  );
}

function Chip({ flight, target }: { flight: Flight; target: RefObject<HTMLElement | null> }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const done = () => useSourceNews.setState((s) => ({ flights: s.flights.filter((x) => x.id !== flight.id) }));
    const to = target.current?.getBoundingClientRect();
    if (!el.current || !to?.width) return void (arrived(), done());
    // Thrown: up and over in an arc, shrinking into the button.
    const dx = to.left + to.width / 2 - flight.from.x;
    const dy = to.top + to.height / 2 - flight.from.y;
    const lift = Math.min(160, 60 + Math.abs(dx) * 0.25);
    const frames = Array.from({ length: STEPS + 1 }, (_, i) => {
      const t = i / STEPS;
      const x = dx * t;
      const y = dy * t - 4 * lift * t * (1 - t);
      const scale = 1 - 0.55 * t * t;
      return { transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale})`, opacity: t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15 };
    });
    const flying = el.current.animate(frames, { duration: DURATION, easing: "cubic-bezier(0.45, 0, 0.55, 1)", fill: "forwards" });
    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      arrived();
      target.current?.animate([{ transform: "scale(1)" }, { transform: "scale(1.14)" }, { transform: "scale(1)" }], { duration: 360, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
      done();
    };
    // Cancelled (the chip went before it landed): it never lands.
    flying.finished.then(land, () => {});
    return () => flying.cancel();
  }, [flight, target]);
  return (
    <div
      ref={el}
      aria-hidden
      style={{ left: flight.from.x, top: flight.from.y, transform: "translate(-50%, -50%)" }}
      className="pointer-events-none fixed z-[80] flex h-[26px] max-w-[200px] items-center gap-[6px] rounded-md bg-raised px-[8px] text-caption font-medium text-fg shadow-floating"
    >
      <FileText size={13} absoluteStrokeWidth strokeWidth={1.25} className="shrink-0 text-fg-muted" />
      <span className="truncate">{flight.title}</span>
    </div>
  );
}

/** How many sources came in since they were last opened, on the Sources button. */
export function FreshCount() {
  const fresh = useSourceNews((s) => s.fresh);
  if (!fresh) return null;
  return (
    <span data-state="open" className="q-pop h-[16px] min-w-[16px] rounded-full bg-selection-strong px-[4px] text-center text-micro leading-[16px] font-semibold text-white tnum" aria-label={`${fresh} new`}>
      {fresh}
    </span>
  );
}
