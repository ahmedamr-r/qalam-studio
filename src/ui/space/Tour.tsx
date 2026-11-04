import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { visibleCards } from "@/doc/board";
import { boundsOf, worldBounds } from "@/doc/geometry";
import { useGhosts } from "@/doc/ghosts";
import { studio, useStudio } from "@/doc/store";
import { boardLane } from "@/engine/ost-tools";
import { placeBubble, tourCardOf, tourStops, type Box, type TourStop } from "@/onboarding/tour";
import { useSpaceView } from "@/space/view";
import { toScreenBox } from "../ai/anchor";
import { Researcher } from "../brand/Researcher";
import { getController } from "../CanvasView";
import { useWide } from "../chat/Panels";
import { Button } from "../controls";
import { useDump } from "../discovery/dump";
import { useReview } from "../discovery/review";
import { useWords } from "../frame/store";
import { endTour, startTour, tourSeen, useTour } from "./tour-state";

/*
 * The walkthrough the first time someone lands on a canvas with cards on it: the researcher points
 * at one part at a time while the rest dims. Nothing behind it can be clicked or typed into while
 * it's up, and it asks for no tokens: what it says comes from what's on this canvas (src/onboarding/tour.ts).
 * It waits for a window wide enough to show the canvas beside the chat. ⌘K shows it again.
 */

/** Long enough to see where they landed before it dims. */
const AFTER_LANDING = 900;
const WIDE = 900;
const PAD: Record<TourStop["target"], number> = { card: 10, lane: 8, chat: 0, bar: 4, sections: 4 };

/** The canvas's cards, in the order they're drawn. */
function cardsNow() {
  const doc = studio().doc;
  return doc.roots.flatMap((r) => visibleCards(doc, r)).map((id) => ({ id, faint: useSpaceView.getState().things.get(id)?.type === "problem" }));
}

/** The first source with the card its wire runs to, so what's lit shows the wire between them. */
function firstWire(): Box | null {
  const doc = studio().doc;
  const { items, edges } = boardLane();
  const from = items[0];
  if (!from) return null;
  const to = edges.find((e) => e.from === from.key && doc.nodes[e.to])?.to;
  const boxes = [from, ...(to ? [worldBounds(doc, to)] : [])];
  return boundsOf(boxes.flatMap((b) => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }]));
}

/** A box on the canvas, on the screen. */
function onScreen(world: Box): Box | null {
  const el = document.querySelector('[data-region="canvas"]');
  if (!el) return null;
  const at = el.getBoundingClientRect();
  const b = toScreenBox(world, studio().camera);
  return { x: b.x + at.left, y: b.y + at.top, w: b.w, h: b.h };
}

/** Glide to what's on the canvas only when it isn't all in view: a view they already have stays. */
function bringIn(world: Box | null) {
  const c = getController();
  if (!c || !world) return;
  const b = toScreenBox(world, c.cameraGoal);
  if (b.x < 24 || b.y < 24 || b.x + b.w > c.viewport.w - 24 || b.y + b.h > c.viewport.h - 24) c.glideTo(c.fitCamera(world, {}, 1));
}

/** Starts it once on this computer, as soon as the canvas has settled with cards on it. */
export function CanvasTour() {
  const open = useTour((s) => s.open);
  const hasCards = useStudio((s) => s.doc.roots.length > 0);
  const active = useSpaceView((s) => s.active);
  // Qalam AI's proposals being reviewed or drawn: what's on the canvas is still being settled.
  const proposing = useReview((s) => s.proposals.length > 0);
  const working = useDump((s) => !!s.busy);
  const drawing = useGhosts((s) => s.list.length > 0);
  const busy = proposing || working || drawing;
  const wide = useWide(WIDE);
  useEffect(() => {
    if (open || !active || !hasCards || busy || !wide || tourSeen()) return;
    const t = window.setTimeout(startTour, AFTER_LANDING);
    return () => clearTimeout(t);
  }, [open, active, hasCards, busy, wide]);
  return open && wide ? createPortal(<Tour />, document.body) : null;
}

function Tour() {
  const words = useWords();
  // Worked out once: the canvas doesn't change under it, since nothing behind it can be clicked.
  const { stops, cardId, laneBox } = useMemo(() => {
    const selection = studio().selection;
    const card = tourCardOf(cardsNow(), selection.length === 1 ? selection[0] : null);
    const lane = studio().view.sources ? firstWire() : null;
    return { stops: tourStops({ card, lane: !!lane, company: words.company }), cardId: card?.id ?? null, laneBox: lane };
  }, [words.company]);
  const [at, setAt] = useState(0);
  const stop = stops[at];
  const last = at === stops.length - 1;
  const [lit, setLit] = useState<Box | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [screen, setScreen] = useState({ w: window.innerWidth, h: window.innerHeight });
  const bubble = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLDivElement>(null);

  const worldOf = (s: TourStop): Box | null => {
    if (s.target === "lane") return laneBox;
    if (s.target !== "card" || !cardId || !studio().doc.nodes[cardId]) return null;
    return worldBounds(studio().doc, cardId);
  };

  useEffect(() => {
    bringIn(worldOf(stop));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per stop
  }, [at]);
  // Once it's been measured: something hidden can't take the focus.
  const shown = size.w > 0;
  useEffect(() => {
    if (shown) next.current?.querySelector<HTMLButtonElement>("button:last-of-type")?.focus();
  }, [at, shown]);

  // Follows what's lit each frame, since the canvas may be gliding to it or the window may be changing.
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const world = worldOf(stop);
      const part = document.querySelector(`[data-tour="${stop.target}"]`)?.getBoundingClientRect();
      const box = stop.target === "card" || stop.target === "lane" ? world && onScreen(world) : part && { x: part.left, y: part.top, w: part.width, h: part.height };
      const pad = PAD[stop.target];
      const out = box ? { x: Math.round(box.x - pad), y: Math.round(box.y - pad), w: Math.round(box.w + pad * 2), h: Math.round(box.h + pad * 2) } : null;
      setLit((was) => (was?.x === out?.x && was?.y === out?.y && was?.w === out?.w && was?.h === out?.h ? was : out));
      setScreen((was) => (was.w === window.innerWidth && was.h === window.innerHeight ? was : { w: window.innerWidth, h: window.innerHeight }));
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per stop
  }, [at]);

  useLayoutEffect(() => {
    const el = bubble.current;
    if (el) setSize((was) => (was.w === el.offsetWidth && was.h === el.offsetHeight ? was : { w: el.offsetWidth, h: el.offsetHeight }));
  }, [at, screen]);

  // While it's up the keys are its own: nothing behind it hears them, Enter included, which still presses the button in focus.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        endTour();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (at === stops.length - 1) endTour();
        else setAt(at + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (at > 0) setAt(at - 1);
      } else if (e.key === "Tab") {
        const all = [...(bubble.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const now = all.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        all[(now + (e.shiftKey ? all.length - 1 : 1)) % all.length]?.focus();
      }
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [at, stops.length]);

  const place = placeBubble(lit, size, screen);
  return (
    <div className="q-fade fixed inset-0 z-[60]">
      {/* Takes every press: what's behind it waits. */}
      <div aria-hidden className="absolute inset-0" />
      <div
        aria-hidden
        // It travels between stops; the first one it simply appears on.
        className={clsx("pointer-events-none absolute rounded-lg outline-1 outline-accent", at > 0 && "transition-[left,top,width,height] duration-base ease-out-quint motion-reduce:transition-none")}
        style={lit ? { left: lit.x, top: lit.y, width: lit.w, height: lit.h, boxShadow: "0 0 0 200vmax var(--color-overlay)" } : { left: screen.w / 2, top: screen.h / 2, width: 0, height: 0, boxShadow: "0 0 0 200vmax var(--color-overlay)" }}
      />
      <div
        ref={bubble}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className={clsx("absolute flex w-[420px] max-w-[calc(100vw-32px)] items-end gap-[4px]", at > 0 && "transition-[left,top] duration-base ease-out-quint motion-reduce:transition-none")}
        style={{ left: place.x, top: place.y, visibility: size.w ? "visible" : "hidden" }}
      >
        <Researcher pose={stop.pose} size={96} className="q-researcher shrink-0 text-fg" />
        <div className="flex min-w-0 flex-1 flex-col gap-[6px] rounded-lg bg-raised p-[14px] shadow-floating">
          <h2 id="tour-title" className="text-title font-medium text-fg">
            {stop.title}
          </h2>
          <p id="tour-body" aria-live="polite" className="text-body text-fg-muted">
            {stop.body}
          </p>
          {last && <p className="text-caption text-fg-subtle">See this again any time: ⌘K, Show the walkthrough.</p>}
          <div className="mt-[8px] flex items-center gap-[4px]">
            <span className="tnum text-caption text-fg-subtle">
              {at + 1} of {stops.length}
            </span>
            <span className="flex-1" />
            {!last && (
              <Button variant="ghost" size="sm" onClick={endTour}>
                Skip
              </Button>
            )}
            <div ref={next} className="flex items-center gap-[4px]">
              {at > 0 && (
                <Button variant="secondary" size="sm" onClick={() => setAt(at - 1)}>
                  Back
                </Button>
              )}
              <Button size="sm" onClick={() => (last ? endTour() : setAt(at + 1))}>
                {last ? "Done" : "Next"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
