import { useEffect, useState, type RefObject } from "react";
import clsx from "clsx";
import type { RouteRef } from "@/doc/schema";
import { boxIn, showing } from "./dom";

type Box = { x: number; y: number; w: number; h: number };

/** What a marker marks: a step built, or one proposed (dim while it isn't picked). */
export interface Mark {
  key: string;
  at?: RouteRef;
  label: string;
  dim?: boolean;
}

const same = (a: (Box | null)[], b: (Box | null)[]) => a.length === b.length && a.every((x, i) => (x && b[i] ? Math.abs(x.x - b[i]!.x) < 0.5 && Math.abs(x.y - b[i]!.y) < 0.5 && Math.abs(x.w - b[i]!.w) < 0.5 && Math.abs(x.h - b[i]!.h) < 0.5 : x === b[i]));

/**
 * Numbered markers over the live device, one per step (built, or proposed), on what you'd touch
 * first: they follow it as the screen scrolls and parts open, and hide while it isn't showing.
 * Picking one jumps there (or, proposed, picks it); hovering one, or its row in the list, rings
 * what it's on.
 */
export function Markers({
  frame,
  device,
  steps,
  find,
  hover,
  onHover,
  onPick,
}: {
  frame: RefObject<HTMLElement | null>;
  device: RefObject<HTMLElement | null>;
  steps: Mark[];
  find: (ref: RouteRef) => HTMLElement | null;
  hover: number | null;
  onHover: (i: number | null) => void;
  onPick: (i: number) => void;
}) {
  const [boxes, setBoxes] = useState<(Box | null)[]>([]);
  useEffect(() => {
    const measure = () => {
      const f = frame.current;
      const d = device.current;
      if (!f || !d) return;
      const next = steps.map((s) => {
        const el = s.at ? find(s.at) : null;
        return el && showing(d, el) ? boxIn(f, el) : null;
      });
      setBoxes((prev) => (same(prev, next) ? prev : next));
    };
    measure();
    // Often enough to follow scrolling and parts sliding in, not every frame.
    const timer = setInterval(measure, 90);
    const d = device.current;
    d?.addEventListener("scroll", measure, true);
    return () => {
      clearInterval(timer);
      d?.removeEventListener("scroll", measure, true);
    };
  }, [frame, device, steps, find]);

  // Markers on one spot sit side by side.
  const taken: { x: number; y: number }[] = [];
  const spots = boxes.map((b) => {
    if (!b) return null;
    let x = b.x - 9;
    while (taken.some((t) => Math.abs(t.x - x) < 18 && Math.abs(t.y - (b.y - 9)) < 18)) x += 22;
    taken.push({ x, y: b.y - 9 });
    return { x, y: b.y - 9 };
  });
  const ring = hover !== null ? boxes[hover] : null;
  return (
    <>
      {ring && <div className="pointer-events-none absolute rounded-[10px] border-2 border-selection" style={{ left: ring.x - 4, top: ring.y - 4, width: ring.w + 8, height: ring.h + 8 }} />}
      {spots.map((p, i) =>
        p ? (
          <button
            key={steps[i].key}
            type="button"
            aria-label={`Step ${i + 1}: ${steps[i].label}`}
            aria-pressed={steps[i].dim === undefined ? undefined : !steps[i].dim}
            onClick={() => onPick(i)}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
            className={clsx(
              "pointer-events-auto absolute grid size-[20px] place-items-center rounded-full text-micro font-semibold shadow-md ring-2 ring-white transition-transform",
              steps[i].dim ? "bg-white text-selection" : "bg-selection text-white",
              hover === i && "scale-125",
            )}
            style={{ left: p.x, top: p.y }}
          >
            {i + 1}
          </button>
        ) : null,
      )}
    </>
  );
}
