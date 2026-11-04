import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronUp, FileText, Maximize, Plus } from "lucide-react";
import { visibleCards } from "@/doc/board";
import { boundsOf, worldBounds } from "@/doc/geometry";
import { studio, useStudio, type Camera } from "@/doc/store";
import type { Controller } from "@/engine/controller";
import { bootEngine } from "@/engine/boot";
import { boardLane } from "@/engine/ost-tools";
import { openSpace, useSpaceStatus, type SpaceInputs } from "@/space/session";
import { useSpaceView } from "@/space/view";
import type { SourceRecord } from "@/discovery/sources";
import CanvasView, { getController } from "../CanvasView";
import { IconBtn, Spinner } from "../controls";
import { onCanvasReady } from "../discovery/canvas";
import KindMark from "../discovery/KindMark";
import { useSources } from "../discovery/sources";
import { startSpaceCanvas } from "./boot";
import { CanvasChecklist } from "./Checklist";
import { consumeChatParams, consumeHomeParams } from "./links";
import { CommandItem, Menu, MenuItem, MenuSeparator } from "../menu";
import { useAddress } from "../nav";
import { SourcesDock } from "./SourcesDock";
import { showDock, useDock } from "./dock";
import { addMaterial, writeCard } from "./new";
import { FreshCount, SourceFlights, seenSources } from "./flights";

/*
 * A space's canvas on its home: the board's own canvas (its painter, gestures, card bar and
 * title editing) over the space's document (src/space/session.ts), where every goal's tree is
 * worked on in place. The view is kept per space for this tab, so coming back finds it where it
 * was; the first time it opens readable (the whole space, or the top of the first tree when the
 * whole is too small to read).
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;
const BAR = "q-glass absolute bottom-[12px] z-[8] flex items-center gap-[2px] rounded-xl bg-raised p-[3px] shadow-floating";
const BAR_BUTTON = "q-item q-press flex h-[28px] items-center gap-[6px] rounded-lg px-[10px] text-caption";
const BAR_QUIET = "text-fg-muted hover:bg-hover hover:text-fg aria-expanded:bg-active aria-expanded:text-fg";
/** Below this a whole space is too small to read: it opens at this zoom on the top of the first tree instead. */
const READABLE = 0.6;
const PAD = 64;

/** Whether the engine is up, so the layout measures text as the painter does. */
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

/** The whole space, or when that's too small to read, the top of the first tree at a size that is. */
export function readableCamera(c: Controller): Camera | null {
  const doc = studio().doc;
  const boxes = doc.roots.flatMap((r) => visibleCards(doc, r).map((id) => worldBounds(doc, id)));
  for (const it of boardLane().items) boxes.push(it);
  if (!boxes.length) return null;
  const b = boundsOf(boxes.flatMap((x) => [{ x: x.x, y: x.y }, { x: x.x + x.w, y: x.y + x.h }]));
  const { w: W, h: H } = c.viewport;
  const zoom = Math.min(1, (W - PAD * 2) / Math.max(1, b.w), (H - PAD * 2) / Math.max(1, b.h));
  if (zoom >= READABLE) return { x: b.x + b.w / 2 - W / 2 / zoom, y: b.y + b.h / 2 - H / 2 / zoom, zoom };
  const first = doc.roots[0] ? worldBounds(doc, doc.roots[0]) : b;
  return { x: Math.max(b.x - PAD / READABLE, first.x + first.w / 2 - W / 2 / READABLE), y: b.y - PAD / READABLE, zoom: READABLE };
}

export function SpaceCanvas({ org, space, inputs, sources }: { org: string | null; space: string | null; inputs: SpaceInputs | null; sources: SourceRecord[] }) {
  const engine = useEngine();
  const ready = useSpaceView((s) => s.active);
  const status = useSpaceStatus();
  const key = `qalam.space.view.${org ?? ""}:${space ?? "org"}`;
  const dock = useDock((s) => s.open);
  // What the chat took in flies to the Sources button, which counts it until the sources are opened (./flights.tsx).
  const sourcesButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (dock) seenSources();
  }, [dock]);

  // The organization's sources (a product's space: its own and the whole organization's); the lane draws the ones a card rests on.
  useEffect(() => useSources.setState({ projectId: null, loaded: true, list: sources.filter((s) => !s.product || !space || s.product === space).sort((a, b) => a.addedAt - b.addedAt) }), [sources, space]);

  useEffect(() => {
    if (engine !== true || !org || !inputs) return;
    startSpaceCanvas();
    void openSpace(org, space, inputs);
  }, [engine, org, space, inputs]);

  // Once it's drawn: the view this tab had of it, else a readable one. Then keep the view as it moves.
  useEffect(() => {
    if (!ready) return;
    let kept: Camera | null = null;
    try {
      kept = JSON.parse(sessionStorage.getItem(key) ?? "null");
    } catch {
      kept = null;
    }
    onCanvasReady((c) => {
      const cam = kept && Number.isFinite(kept.zoom) ? kept : readableCamera(c);
      if (cam) studio().setCamera(cam);
      // What the address asks of it (a card, a board, a draft…), now it's in view.
      void consumeHomeParams();
    });
    let t = 0;
    const off = useStudio.subscribe((s, prev) => {
      if (s.camera === prev.camera) return;
      clearTimeout(t);
      t = window.setTimeout(() => {
        try {
          sessionStorage.setItem(key, JSON.stringify(s.camera));
        } catch {
          // A view not kept is only a view.
        }
      }, 200);
    });
    return () => {
      clearTimeout(t);
      off();
    };
  }, [ready, key]);

  // A move in place that asks the canvas something (a card, drafts, a problem under a goal): done once it's open.
  const address = useAddress();
  useEffect(() => {
    if (!ready) return;
    consumeChatParams();
    onCanvasReady(() => void consumeHomeParams());
  }, [ready, address]);

  if (engine === "failed") return <Waiting failed />;
  if (status.error) return <Waiting failed message={`Couldn't open the boards: ${status.error}`} />;
  if (engine !== true || !ready) return <Waiting />;
  return (
    <div className="flex h-full w-full">
      {dock && <SourcesDock onClose={() => showDock(false)} />}
      <div className="@container relative min-w-0 flex-1">
        <CanvasView />
        <CanvasChecklist />
        {/* What goes in, by the edge the sources open from. */}
        <div data-tour="bar" className={clsx(BAR, "left-[12px]")}>
          <button ref={sourcesButton} type="button" aria-pressed={dock} data-sources-button onClick={() => showDock(!dock)} className={clsx(BAR_BUTTON, dock ? "bg-selection-subtle text-selection-label" : BAR_QUIET)}>
            <FileText size={13} {...ICON} />
            Sources
            <FreshCount />
          </button>
          <SourceFlights target={sourcesButton} />
          <AddMenu />
        </div>
        <ViewBar />
      </div>
    </div>
  );
}

/** One button for what can be put on the canvas: a goal or a problem typed in place (under the card picked, where it fits; ./new.ts), or a source. */
function AddMenu() {
  return (
    <Menu
      label="Add"
      side="top"
      sideOffset={8}
      className="w-[180px]"
      trigger={
        <button type="button" className={clsx(BAR_BUTTON, BAR_QUIET)}>
          <Plus size={13} {...ICON} />
          Add
        </button>
      }
    >
      <MenuItem icon={<KindMark kind="outcome" className="text-kind-goal" />} title="Typed on the canvas, under the goal picked" onSelect={() => writeCard("outcome")}>
        Goal
      </MenuItem>
      <MenuItem icon={<KindMark kind="opportunity" className="text-kind-problem" />} title="Typed on the canvas, under the goal or problem picked" onSelect={() => writeCard("opportunity")}>
        Problem
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<FileText size={14} {...ICON} />} onSelect={addMaterial}>
        Source…
      </MenuItem>
    </Menu>
  );
}

/** Where you're looking: back to the whole space, and the zoom, with the rest of the view behind it. People pinch and scroll, so these are rarely pressed. */
function ViewBar() {
  const zoom = useStudio((s) => Math.round(s.camera.zoom * 100));
  return (
    <div className={clsx(BAR, "right-[12px]")}>
      <IconBtn
        label="Show it all"
        onClick={() => {
          const c = getController();
          const cam = c && readableCamera(c);
          if (c && cam) c.glideTo(cam, 280);
        }}
      >
        <Maximize size={13} {...ICON} />
      </IconBtn>
      <Menu
        label="Zoom and view"
        side="top"
        align="end"
        sideOffset={8}
        checks
        className="w-[224px]"
        trigger={
          <button type="button" aria-label={`Zoom and view: ${zoom}%`} className={clsx(BAR_BUTTON, BAR_QUIET, "gap-[4px] pr-[6px] pl-[8px]")}>
            <span className="tnum">{zoom}%</span>
            <ChevronUp size={12} absoluteStrokeWidth strokeWidth={1.25} className="q-chevron" />
          </button>
        }
      >
        <CommandItem id="zoom.in" />
        <CommandItem id="zoom.out" />
        <CommandItem id="zoom.100" />
        <MenuSeparator />
        <CommandItem id="view.sources" />
      </Menu>
    </div>
  );
}

/** While the engine and the boards load (or can't), in the canvas's place. */
function Waiting({ failed, message }: { failed?: boolean; message?: string }) {
  return (
    <div className="q-canvas-wash grid h-full w-full place-items-center bg-canvas text-caption text-fg-subtle">
      {failed ? (
        (message ?? "The canvas can't be drawn here.")
      ) : (
        <span className="flex items-center gap-[8px]">
          <Spinner size={12} /> Opening the boards…
        </span>
      )}
    </div>
  );
}
