"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { componentBoxes, describeCounts, diffInstances, diffTokens, type ChangedInstance } from "@/design-system/interview/diff";
import { knobHash, type Knobs, type ReadBack } from "@/design-system/interview/knobs";
import type { Scenario } from "@/design-system/interview/scenarios";
import { TokenSet } from "@/design-system/resolve";
import { previousKnobs } from "@/projects/interview";
import { r } from "../recipes";
import { cachedRender, draftSystem, useRender, type Rendered } from "./previewCache";
import { useInterview } from "./store";

export interface StageProps {
  knobs: Knobs;
  read: ReadBack;
  scenario: Scenario;
  maxSide: number;
  /** Knobs to preview instead (an option under the pointer). */
  hover: Knobs | null;
  onSize: (maxSide: number) => void;
  /** Outline where this component is used (by catalog name). */
  highlight?: string | null;
  /** The status line before anything has changed. */
  hint?: string;
}

/**
 * A screen drawn with the system being shaped. Hovering an option shows it ("Preview"); after a
 * change, the components it changed glow while the rest dims, and a line says what changed;
 * holding Space (or the Compare button) shows how it was before the last change.
 */
export function PreviewStage({ knobs, read, scenario, maxSide, hover, onSize, highlight, hint = "Hover an option to preview it on this screen." }: StageProps) {
  const state = useInterview((s) => s.state);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 700 });
  const [flip, setFlip] = useState(false);
  const before = previousKnobs(state);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width;
      const h = e.contentRect.height;
      setSize({ w, h });
      // Draw at the size it shows (in device pixels), in steps so the cache keeps hitting.
      const px = Math.max(w, h) * (window.devicePixelRatio || 1);
      onSize(Math.min(2400, Math.max(800, Math.ceil(px / 400) * 400)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onSize]);

  // Hold Space to see how it was before the last change.
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !typing(e.target) && before) {
        e.preventDefault();
        setFlip(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setFlip(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [before]);

  const committed = useRender(knobs, read, scenario, maxSide, "commit");
  const hovered = useRender(hover, read, scenario, maxSide, "hover");
  const previous = useRender(flip ? before : null, read, scenario, maxSide, "commit");
  const { glow, status, clear } = useChangeGlow(committed, knobs, read, scenario, maxSide);

  const showing: Rendered | null = (flip && previous) || (hover && hovered) || committed;
  const mode = flip && previous ? "before" : hover && hovered ? "preview" : "now";
  const fit = showing ? Math.min(size.w / showing.w, size.h / showing.h) : 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-stage">
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden p-[24px]" style={{ boxSizing: "border-box" }}>
        {showing ? (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: showing.w * fit * 0.94, height: showing.h * fit * 0.94 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a rendered preview (object URL) */}
            <img src={showing.url} alt={`${scenario.label} with your system`} className="h-full w-full rounded-lg shadow-floating" />
            {highlight && !glow && <UsedOverlay boxes={componentBoxes(showing.nodes, highlight)} w={showing.w} h={showing.h} />}
            {mode === "now" && glow && <GlowOverlay key={glow.key} changed={glow.changed} w={showing.w} h={showing.h} onDone={clear} />}
            {mode !== "now" && (
              <span className="absolute left-[8px] top-[8px] rounded-md bg-inverse px-[8px] py-[2px] text-micro font-medium text-fg-inverse">{mode === "before" ? "Before" : "Preview"}</span>
            )}
          </div>
        ) : (
          <div className="grid h-full place-items-center text-caption text-fg-subtle">Drawing the screen…</div>
        )}
      </div>
      <div className="flex h-[36px] shrink-0 items-center gap-[12px] border-t border-line-subtle bg-app px-[16px] text-caption text-fg-muted" role="status">
        <span className="min-w-0 flex-1 truncate">{status || hint}</span>
        {before && (
          <button
            type="button"
            className="q-item rounded-md px-[8px] py-[2px] text-fg-muted hover:bg-hover hover:text-fg"
            onPointerDown={() => setFlip(true)}
            onPointerUp={() => setFlip(false)}
            onPointerLeave={() => setFlip(false)}
          >
            Hold <kbd className={clsx(r.kbdBase, r.kbd, r.kbdSkin)}>Space</kbd> to compare
          </button>
        )}
      </div>
    </div>
  );
}

/** After a change lands: which components it changed (to glow) and a line saying so. */
function useChangeGlow(committed: Rendered | null, knobs: Knobs, read: ReadBack, scenario: Scenario, maxSide: number) {
  const shown = useRef<{ hash: string; sid: string; r: Rendered; knobs: Knobs } | null>(null);
  const [glow, setGlow] = useState<{ key: number; changed: ChangedInstance[] } | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    // Only a render of the current knobs counts (the old one stays up while the new one draws).
    if (!committed || cachedRender(knobs, read, scenario, maxSide) !== committed) return;
    const hash = knobHash(knobs);
    const prev = shown.current;
    shown.current = { hash, sid: scenario.id, r: committed, knobs };
    // Another screen: what changed on the last one doesn't apply here.
    if (prev && prev.sid !== scenario.id) {
      setStatus("");
      setGlow(null);
    }
    if (!prev || prev.sid !== scenario.id || prev.hash === hash) return;
    const d = diffInstances(prev.r.nodes, committed.nodes);
    const tokens = diffTokens(new TokenSet(draftSystem(prev.knobs, read).ds.tree), new TokenSet(draftSystem(knobs, read).ds.tree)).length;
    const t = `${tokens} token${tokens === 1 ? "" : "s"}`;
    setStatus(d.changed.length ? `${d.changed.length} component${d.changed.length === 1 ? "" : "s"} changed on this screen (${describeCounts(d.byComponent)}) · ${t}` : `${t} changed; nothing on this screen uses them`);
    setGlow(d.changed.length ? { key: Date.now(), changed: d.changed } : null);
  }, [committed, knobs, read, scenario, maxSide]);
  return { glow, status, clear: () => setGlow(null) };
}

/** The changed components glow; everything else dims; then it fades (opacity only). */
function GlowOverlay({ changed, w, h, onDone }: { changed: ChangedInstance[]; w: number; h: number; onDone: () => void }) {
  const id = useRef(`m${Math.random().toString(36).slice(2, 8)}`).current;
  return (
    <svg className="q-change pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden onAnimationEnd={onDone}>
      <defs>
        <mask id={id}>
          <rect width={w} height={h} fill="white" />
          {changed.map((c) => (
            <rect key={c.specPath} x={c.box.x - 3} y={c.box.y - 3} width={c.box.w + 6} height={c.box.h + 6} rx={6} fill="black" />
          ))}
        </mask>
      </defs>
      <rect width={w} height={h} fill="rgb(0 0 0 / 0.34)" mask={`url(#${id})`} />
      {changed.map((c) => (
        <rect key={c.specPath} x={c.box.x - 3} y={c.box.y - 3} width={c.box.w + 6} height={c.box.h + 6} rx={6} fill="none" stroke="var(--color-accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}


/** Where a component is used: a quiet dashed outline around each of its instances. */
function UsedOverlay({ boxes, w, h }: { boxes: { x: number; y: number; w: number; h: number }[]; w: number; h: number }) {
  return (
    <svg className="q-fade pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      {boxes.map((b, i) => (
        <rect key={i} x={b.x - 2} y={b.y - 2} width={b.w + 4} height={b.h + 4} rx={5} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
