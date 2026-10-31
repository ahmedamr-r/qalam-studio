import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Cable, Maximize, Minus, Plus } from "lucide-react";
import { isOstCard, visibleCards } from "@/doc/board";
import { apply, boundsOf, worldBounds, worldMatrix, type Box, type Pt } from "@/doc/geometry";
import type { Doc } from "@/doc/schema";
import type { Camera } from "@/doc/store";
import { foldToggle, orientationOf } from "@/discovery/tree";
import { litBy, type Lane, type LaneItem } from "@/discovery/lane";
import { bootEngine } from "@/engine/boot";
import { readChromeTheme } from "@/engine/chrome";
import { onFontsChanged } from "@/engine/fonts";
import { Renderer } from "@/engine/renderer";
import type { MapTag } from "@/goals/map";
import { IconBtn, Spinner } from "../controls";
import { reducedMotion } from "../motion";
import { THEME_EVENT } from "../theme";

/*
 * The space's map on the canvas: the board's own painter drawing the map's document
 * (src/goals/map.ts), with a camera of its own, since a board's Controller belongs to the board's
 * document. The wheel pans, ⌘ or a pinch zooms around the pointer, dragging the background pans.
 * A click picks a card (or folds a branch, or opens a source), a double click opens the card on
 * its board. The view is kept per space for this tab, so coming back finds it where it was.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;
const TOGGLE_HIT_PX = 10;
/** Below this a whole map is too small to read: it opens at this zoom on the top of the first tree instead. */
const READABLE = 0.6;
const PAD = 64;

/** Whether the engine is up, so the map's layout measures text as the painter does. */
export function useEngine(): boolean | "failed" {
  const [ready, setReady] = useState<boolean | "failed">(false);
  useEffect(() => {
    let alive = true;
    bootEngine().then(
      () => alive && setReady(true),
      () => alive && setReady("failed"),
    );
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

export interface MapView {
  doc: Doc;
  faint: ReadonlySet<string>;
  tags: ReadonlyMap<string, MapTag>;
  noticed: ReadonlySet<string>;
  lane: Lane | null;
}

export function MapCanvas({
  view,
  picked,
  onPick,
  onOpen,
  onFold,
  onSource,
  focus,
  viewKey,
  lanes,
  onLanes,
}: {
  view: MapView;
  picked: string | null;
  onPick: (id: string | null) => void;
  onOpen: (id: string) => void;
  onFold: (id: string) => void;
  onSource: (item: LaneItem) => void;
  /** Glide to this card (`n` changes each time it's asked). */
  focus: { id: string; n: number } | null;
  /** The space: where this tab's view of it is kept. */
  viewKey: string;
  lanes: boolean;
  onLanes: (on: boolean) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const cam = useRef<Camera | null>(null);
  const hover = useRef<{ card: string | null; toggle: string | null; lane: string | null }>({ card: null, toggle: null, lane: null });
  const latest = useRef({ view, picked });
  latest.current = { view, picked };
  const anim = useRef(0);
  const [cursor, setCursor] = useState("default");

  const paint = () => {
    const r = renderer.current;
    const c = cam.current;
    if (!r || !c) return;
    const { view: v, picked: p } = latest.current;
    const h = hover.current;
    r.schedule({
      doc: v.doc,
      camera: c,
      selection: p ? [p] : [],
      hoverId: h.card,
      editingTextId: null,
      marquee: null,
      guides: [],
      showFlags: false,
      hideHandles: true,
      ost: {
        editingId: null,
        drag: null,
        drop: null,
        hoverToggle: h.toggle,
        noticed: v.noticed,
        work: v.tags,
        faint: v.faint,
        lane: v.lane ? { lane: v.lane, lit: litBy(v.lane, h.lane ?? p), hover: h.lane } : null,
      },
    });
  };

  const setCam = (c: Camera) => {
    cam.current = c;
    try {
      sessionStorage.setItem(`qalam.map.${viewKey}`, JSON.stringify(c));
    } catch {
      // A view not kept is only a view.
    }
    paint();
  };

  /** Everything on the map: its cards and its sources. */
  const extent = (): Box | null => {
    const { doc, lane } = latest.current.view;
    const boxes = doc.roots.flatMap((r) => visibleCards(doc, r).map((id) => worldBounds(doc, id)));
    for (const it of lane?.items ?? []) boxes.push(it);
    return boxes.length ? boundsOf(boxes.flatMap((b) => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }])) : null;
  };

  /** The whole map, or when that's too small to read, the top of the first tree at a size that is. */
  const fitCamera = (): Camera | null => {
    const r = renderer.current;
    const b = extent();
    if (!r || !b) return null;
    const W = r.width;
    const H = r.height;
    const zoom = Math.min(1, (W - PAD * 2) / Math.max(1, b.w), (H - PAD * 2) / Math.max(1, b.h));
    if (zoom >= READABLE) return { x: b.x + b.w / 2 - W / 2 / zoom, y: b.y + b.h / 2 - H / 2 / zoom, zoom };
    const { doc } = latest.current.view;
    const first = doc.roots[0] ? worldBounds(doc, doc.roots[0]) : b;
    const x = Math.max(b.x - PAD / READABLE, first.x + first.w / 2 - W / 2 / READABLE);
    return { x, y: b.y - PAD / READABLE, zoom: READABLE };
  };

  const glide = (to: Camera, ms = 280) => {
    cancelAnimationFrame(anim.current);
    const from = cam.current;
    if (!from || reducedMotion()) return setCam(to);
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = k >= 1 ? 1 : 1 - Math.pow(2, -10 * k);
      const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e);
      setCam({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, zoom });
      anim.current = k < 1 ? requestAnimationFrame(step) : 0;
    };
    anim.current = requestAnimationFrame(step);
  };

  const fit = () => {
    const c = fitCamera();
    if (c) glide(c);
  };

  const zoomAt = (screen: Pt, zoom: number) => {
    const c = cam.current;
    if (!c) return;
    const z = Math.min(2, Math.max(0.08, zoom));
    const w = { x: c.x + screen.x / c.zoom, y: c.y + screen.y / c.zoom };
    setCam({ x: w.x - screen.x / z, y: w.y - screen.y / z, zoom: z });
  };

  // The renderer, its size, the theme and the fonts.
  useEffect(() => {
    const el = canvasRef.current!;
    const r = new Renderer(el);
    renderer.current = r;
    r.onImageLoaded = paint;
    const ro = new ResizeObserver(() => {
      if (!wrap.current) return;
      const box = wrap.current.getBoundingClientRect();
      el.style.width = `${box.width}px`;
      el.style.height = `${box.height}px`;
      r.resize(box.width, box.height, window.devicePixelRatio || 1);
      if (!cam.current && box.width > 0) {
        let kept: Camera | null = null;
        try {
          kept = JSON.parse(sessionStorage.getItem(`qalam.map.${viewKey}`) ?? "null");
        } catch {
          kept = null;
        }
        cam.current = kept && Number.isFinite(kept.zoom) ? kept : fitCamera();
      }
      paint();
    });
    ro.observe(wrap.current!);
    const applyTheme = () => {
      r.setTheme(readChromeTheme());
      paint();
    };
    applyTheme();
    window.addEventListener(THEME_EVENT, applyTheme);
    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const offFonts = onFontsChanged(() => {
      r.invalidateText();
      paint();
    });
    return () => {
      cancelAnimationFrame(anim.current);
      window.removeEventListener(THEME_EVENT, applyTheme);
      themeObserver.disconnect();
      offFonts();
      ro.disconnect();
      r.dispose();
      renderer.current = null;
      cam.current = null;
    };
    // One renderer per space's map; the view's changes are painted below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  // Anything drawn changed: paint it (the first time there's something to show, frame it).
  useEffect(() => {
    if (!cam.current && renderer.current?.width) cam.current = fitCamera();
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, picked]);

  // Asked to show a card: glide so it's in view, readable.
  useEffect(() => {
    const r = renderer.current;
    const { doc } = latest.current.view;
    if (!focus || !r || !doc.nodes[focus.id]) return;
    const b = worldBounds(doc, focus.id);
    const zoom = Math.max(cam.current?.zoom ?? 1, 0.8);
    glide({ x: b.x + b.w / 2 - r.width / 2 / zoom, y: b.y + b.h / 2 - r.height / 2 / zoom, zoom: Math.min(zoom, 1.2) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // The wheel pans, ⌘ or a pinch zooms (not passive: the page mustn't scroll or zoom).
  useEffect(() => {
    const el = canvasRef.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      const c = cam.current;
      if (!c) return;
      if (e.ctrlKey || e.metaKey) {
        const box = el.getBoundingClientRect();
        zoomAt({ x: e.clientX - box.left, y: e.clientY - box.top }, c.zoom * Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002)));
      } else {
        const k = e.deltaMode === 1 ? 16 : 1;
        setCam({ ...c, x: c.x + ((e.shiftKey ? e.deltaY : e.deltaX) * k) / c.zoom, y: c.y + ((e.shiftKey ? 0 : e.deltaY) * k) / c.zoom });
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  const worldAt = (e: { clientX: number; clientY: number }): Pt | null => {
    const c = cam.current;
    const box = canvasRef.current?.getBoundingClientRect();
    if (!c || !box) return null;
    return { x: c.x + (e.clientX - box.left) / c.zoom, y: c.y + (e.clientY - box.top) / c.zoom };
  };

  /** What's under a point: a fold toggle, a source, or a card (the deepest). */
  const hit = (w: Pt): { toggle: string | null; lane: LaneItem | null; card: string | null } => {
    const { doc, lane } = latest.current.view;
    const zoom = cam.current?.zoom ?? 1;
    let toggle: string | null = null;
    let card: string | null = null;
    for (const root of doc.roots) {
      if (!isOstCard(doc.nodes[root])) continue;
      const o = orientationOf(doc, root);
      for (const id of visibleCards(doc, root)) {
        const n = doc.nodes[id];
        if (n.children.some((c) => isOstCard(doc.nodes[c]))) {
          const t = foldToggle(n, o);
          const at = apply(worldMatrix(doc, id), { x: t.x, y: t.y });
          if (Math.hypot(w.x - at.x, w.y - at.y) <= Math.max(t.r, TOGGLE_HIT_PX / zoom)) toggle = id;
        }
        const b = worldBounds(doc, id);
        if (w.x >= b.x && w.x <= b.x + b.w && w.y >= b.y && w.y <= b.y + b.h) card = id;
      }
    }
    const item = lane?.items.find((i) => w.x >= i.x && w.x <= i.x + i.w && w.y >= i.y && w.y <= i.y + i.h) ?? null;
    return { toggle, lane: item, card: toggle || item ? null : card };
  };

  const drag = useRef<{ x: number; y: number; cam: Camera; moved: boolean; id: number } | null>(null);

  return (
    <div ref={wrap} className="relative h-full w-full overflow-hidden bg-canvas" data-region="map">
      <canvas
        ref={canvasRef}
        className="block touch-none select-none outline-none"
        style={{ cursor }}
        tabIndex={0}
        aria-label="The map: every goal, with its problems, solutions and tests"
        onPointerDown={(e) => {
          if (e.button !== 0 || !cam.current) return;
          cancelAnimationFrame(anim.current);
          drag.current = { x: e.clientX, y: e.clientY, cam: cam.current, moved: false, id: e.pointerId };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d && d.id === e.pointerId) {
            if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
            if (!d.moved) {
              d.moved = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              setCursor("grabbing");
            }
            setCam({ ...d.cam, x: d.cam.x - (e.clientX - d.x) / d.cam.zoom, y: d.cam.y - (e.clientY - d.y) / d.cam.zoom });
            return;
          }
          const w = worldAt(e);
          if (!w) return;
          const h = hit(w);
          const next = { card: h.card, toggle: h.toggle, lane: h.lane?.key ?? null };
          const was = hover.current;
          if (was.card !== next.card || was.toggle !== next.toggle || was.lane !== next.lane) {
            hover.current = next;
            setCursor(next.card || next.toggle || next.lane ? "pointer" : "default");
            paint();
          }
        }}
        onPointerLeave={() => {
          if (drag.current) return;
          hover.current = { card: null, toggle: null, lane: null };
          paint();
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.id !== e.pointerId) return;
          if (d.moved) {
            setCursor("default");
            return;
          }
          const w = worldAt(e);
          if (!w) return;
          const h = hit(w);
          if (h.toggle) onFold(h.toggle);
          else if (h.lane) onSource(h.lane);
          else onPick(h.card);
        }}
        onDoubleClick={(e) => {
          const w = worldAt(e);
          const h = w ? hit(w) : null;
          if (h?.card) onOpen(h.card);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && picked) onPick(null);
        }}
      />
      <div className="absolute bottom-[12px] left-[12px] flex items-center gap-[2px] rounded-lg bg-raised p-[2px] shadow-floating">
        <IconBtn size="sm" label="Zoom out" onClick={() => cam.current && renderer.current && zoomAt({ x: renderer.current.width / 2, y: renderer.current.height / 2 }, cam.current.zoom * 0.8)}>
          <Minus size={13} {...ICON} />
        </IconBtn>
        <IconBtn size="sm" label="Zoom in" onClick={() => cam.current && renderer.current && zoomAt({ x: renderer.current.width / 2, y: renderer.current.height / 2 }, cam.current.zoom * 1.25)}>
          <Plus size={13} {...ICON} />
        </IconBtn>
        <IconBtn size="sm" label="Show it all" onClick={fit}>
          <Maximize size={13} {...ICON} />
        </IconBtn>
        <span aria-hidden className="mx-[2px] h-[16px] w-px bg-line-subtle" />
        <button
          type="button"
          aria-pressed={lanes}
          onClick={() => onLanes(!lanes)}
          className={clsx("q-item flex h-[24px] items-center gap-[6px] rounded-md px-[8px] text-caption", lanes ? "bg-selection-subtle text-selection-label" : "text-fg-muted hover:bg-hover hover:text-fg")}
        >
          <Cable size={13} {...ICON} />
          Sources and wires
        </button>
      </div>
    </div>
  );
}

/** While the engine loads (or can't), in the map's place. */
export function MapWaiting({ failed }: { failed?: boolean }) {
  return (
    <div className="grid h-full w-full place-items-center bg-canvas text-caption text-fg-subtle">
      {failed ? (
        "The map can't be drawn here."
      ) : (
        <span className="flex items-center gap-[8px]">
          <Spinner size={12} /> Drawing the map…
        </span>
      )}
    </div>
  );
}
