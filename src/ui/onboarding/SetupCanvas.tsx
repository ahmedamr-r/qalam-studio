import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Check, FileText, Globe, Maximize, Minus, PenLine, Plus, Star, Target, TriangleAlert, X } from "lucide-react";
import { connectorDef } from "@/connectors/catalog";
import type { SetupDoc } from "@/org/setup";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { ConnectorLogo } from "../brand/ConnectorLogo";
import { IconBtn, Spinner, Tip } from "../controls";
import { dropKnown } from "../setup/know";
import { acceptLines, discardLines } from "../setup/setup";
import { MAX_LINES, pathOf, type Canvas, type CanvasEdge, type CanvasNode } from "./canvas";

/*
 * The setup's canvas (./canvas.ts lays it out): what was sent on the left, wired to the problems and
 * goals Qalam AI found in it, n8n-style. Cards are HTML over a layer of SVG wires in one world that
 * pans and zooms (as the knowledge graph does: scroll pans, ⌘/Ctrl-scroll or pinch zooms, drag the
 * background); it frames everything as nodes arrive. Hovering or selecting a card lights its path and
 * dims the rest; a source opens its reader; a proposed goal is accepted (✓) or left out (✕) on its card.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;
const MIN_K = 0.3;
const MAX_K = 1.6;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));
/** The smallest the canvas frames itself at, so its words stay readable. */
const READABLE = 0.8;

interface View {
  x: number;
  y: number;
  k: number;
}

const TYPE_WORD: Record<string, string> = { pdf: "PDF", doc: "Doc", docx: "Word", sheet: "Sheet", slides: "Slides", text: "Text", markdown: "Markdown", paste: "Text", connector: "" };

/** Where a source came from, in words: "Your words", "Web page", "Google Drive · PDF". */
export function sourceLine(doc: SetupDoc | undefined): string {
  if (!doc) return "Source";
  if (doc.from === "said") return "Your words";
  if (doc.from === "page") return "Web page";
  const where = doc.from === "computer" ? "This computer" : (connectorDef(doc.from)?.label ?? doc.from);
  const kind = doc.type ? (TYPE_WORD[doc.type] ?? "") : "";
  return [where, kind, doc.pages ? `${doc.pages} pages` : ""].filter(Boolean).join(" · ");
}

/** A source's mark: its connector's logo, else what it is. */
export function SourceMark({ doc }: { doc: SetupDoc | undefined }) {
  if (doc && doc.from !== "said" && doc.from !== "page" && doc.from !== "computer") return <ConnectorLogo id={doc.from} size={16} decorative />;
  const Icon = doc?.from === "said" ? PenLine : doc?.from === "page" ? Globe : FileText;
  return (
    <span className="grid size-[16px] shrink-0 place-items-center rounded-[3px] bg-kh-research/15 text-kh-research">
      <Icon size={11} {...ICON} />
    </span>
  );
}

/** A wire from the right side of one card to the left side of the next. */
function wirePath(a: CanvasNode, b: CanvasNode): string {
  const x1 = a.x + a.w;
  const y1 = a.y + a.h / 2;
  const x2 = b.x;
  const y2 = b.y + b.h / 2;
  const dx = Math.max(36, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export function SetupCanvas({ canvas, selected, onSelect, onOpen, working, act }: { canvas: Canvas; selected: string | null; onSelect: (id: string | null) => void; onOpen: (source: CanvasNode) => void; working: boolean; act: (fn: () => Promise<void>) => void }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // Measured once now, then as the panel changes.
    const at = el.getBoundingClientRect();
    setSize({ w: at.width, h: at.height });
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const commit = useCallback((v: View) => {
    viewRef.current = v;
    setView(v);
  }, []);

  /** Frame everything, never smaller than reads well: a canvas wider than that starts at its sources and pans. `all` zooms out as far as it takes. */
  const fit = useCallback(
    (all = false) => {
      if (!size.w || !canvas.width) return;
      const pad = 24;
      const whole = Math.min((size.w - pad * 2) / canvas.width, (size.h - pad * 2) / canvas.height, 1);
      const k = clampK(all ? whole : Math.max(whole, READABLE));
      const w = canvas.width * k;
      const h = canvas.height * k;
      commit({ k, x: w <= size.w - pad * 2 ? (size.w - w) / 2 : pad, y: h <= size.h - pad * 2 ? (size.h - h) / 2 : pad });
    },
    [size.w, size.h, canvas.width, canvas.height, commit],
  );

  // Frame everything when the panel is measured and whenever cards come or go.
  const shape = canvas.nodes.map((n) => n.id).join("|");
  useEffect(() => fit(), [shape, size.w, size.h]);

  const zoomAt = useCallback(
    (factor: number, sx = size.w / 2, sy = size.h / 2) => {
      const v = viewRef.current;
      const k = clampK(v.k * factor);
      const wx = (sx - v.x) / v.k;
      const wy = (sy - v.y) / v.k;
      commit({ k, x: sx - wx * k, y: sy - wy * k });
    },
    [size, commit],
  );

  // Scroll pans, ⌘/Ctrl (and pinch) zooms around the pointer: a non-passive listener.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
      else {
        const v = viewRef.current;
        commit({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, commit]);

  // Dragging the background pans; a click on it clears the selection.
  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-node]")) return;
    const v = viewRef.current;
    drag.current = { sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    commit({ ...viewRef.current, x: d.vx + dx, y: d.vy + dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(d.id);
    if (!d.moved) onSelect(null);
  };

  // What's lit: the selected card's path, else the hovered one's.
  const focus = selected ?? hovered;
  const lit = useMemo(() => (focus && canvas.nodes.some((n) => n.id === focus) ? pathOf(canvas, focus) : null), [focus, canvas]);
  const byId = useMemo(() => new Map(canvas.nodes.map((n) => [n.id, n])), [canvas]);

  return (
    <div
      ref={host}
      role="group"
      aria-label="Canvas: what you sent, wired to the problems and goals found in it"
      className="relative h-full min-h-0 w-full touch-none overflow-hidden bg-canvas select-none"
      style={{ cursor: drag.current?.moved ? "grabbing" : "default", backgroundImage: "radial-gradient(var(--color-line-subtle) 1px, transparent 1px)", backgroundSize: `${16 * view.k}px ${16 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={(e) => {
        if (e.key === "Escape" && selected) {
          e.stopPropagation();
          onSelect(null);
        }
      }}
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: canvas.width, height: canvas.height }}>
        <svg width={canvas.width} height={canvas.height} className="pointer-events-none absolute left-0 top-0 overflow-visible" aria-hidden>
          {canvas.edges.map((e) => (
            <Wire key={e.id} e={e} a={byId.get(e.from)!} b={byId.get(e.to)!} state={!lit ? "rest" : lit.edges.has(e.id) ? "lit" : "dim"} />
          ))}
        </svg>
        {canvas.nodes.map((n) => (
          <NodeCard
            key={n.id}
            n={n}
            dim={!!lit && !lit.nodes.has(n.id)}
            selected={selected === n.id}
            onHover={(on) => setHovered((h) => (on ? n.id : h === n.id ? null : h))}
            onClick={() => (n.kind === "source" ? onOpen(n) : onSelect(selected === n.id ? null : n.id))}
            working={working}
            act={act}
          />
        ))}
      </div>
      <div className="absolute bottom-[10px] right-[10px] flex items-center gap-[2px] rounded-lg bg-raised p-[2px] shadow-floating">
        <IconBtn size="sm" label="Zoom out" onClick={() => zoomAt(0.8)}>
          <Minus size={13} {...ICON} />
        </IconBtn>
        <IconBtn size="sm" label="Zoom in" onClick={() => zoomAt(1.25)}>
          <Plus size={13} {...ICON} />
        </IconBtn>
        <IconBtn size="sm" label="Show it all" onClick={() => fit(true)}>
          <Maximize size={13} {...ICON} />
        </IconBtn>
      </div>
    </div>
  );
}

function Wire({ e, a, b, state }: { e: CanvasEdge; a: CanvasNode; b: CanvasNode; state: "rest" | "lit" | "dim" }) {
  if (!a || !b) return null;
  const d = wirePath(a, b);
  const tone = state === "lit" ? (e.kind === "under" ? "var(--color-kh-you)" : "var(--color-ai)") : "var(--color-line-strong)";
  return (
    <g opacity={state === "dim" ? 0.25 : 1}>
      <path d={d} fill="none" stroke={tone} strokeWidth={state === "lit" ? 2 : 1.25} strokeDasharray={e.kind === "under" ? "5 4" : undefined} />
      <circle cx={a.x + a.w} cy={a.y + a.h / 2} r={3} fill="var(--color-panel)" stroke={tone} strokeWidth={1.25} />
      <circle cx={b.x} cy={b.y + b.h / 2} r={3} fill="var(--color-panel)" stroke={tone} strokeWidth={1.25} />
    </g>
  );
}

/** A goal's state as the colour of its left edge: Qalam AI's rose while proposed, green once accepted. */
const EDGE: Record<string, string> = { proposed: "before:bg-ai", accepted: "before:bg-success", discarded: "before:bg-transparent", kept: "before:bg-kh-you", seen: "before:bg-transparent" };

function NodeCard({ n, dim, selected, onHover, onClick, working, act }: { n: CanvasNode; dim: boolean; selected: boolean; onHover: (on: boolean) => void; onClick: () => void; working: boolean; act: (fn: () => Promise<void>) => void }) {
  const head: ReactNode =
    n.kind === "source" ? (
      <>
        <SourceMark doc={n.doc} />
        <span className="min-w-0 flex-1 truncate">{sourceLine(n.doc)}</span>
        {n.reading && <Spinner size={10} />}
      </>
    ) : n.kind === "problem" ? (
      <>
        <span className="grid size-[16px] shrink-0 place-items-center rounded-[3px] bg-warning-subtle text-warning">
          <TriangleAlert size={10} {...ICON} />
        </span>
        <span className="min-w-0 flex-1 truncate">Problem</span>
      </>
    ) : (
      <>
        <span className="grid size-[16px] shrink-0 place-items-center rounded-[3px] bg-kh-you/15 text-kh-you">{n.state === "kept" ? <Star size={10} {...ICON} /> : <Target size={10} {...ICON} />}</span>
        <span className="min-w-0 flex-1 truncate">{n.state === "seen" ? "Goal it read" : n.state === "kept" ? "Your goal" : "Goal"}</span>
        {n.state === "proposed" && <QalamAIGlyph size={12} />}
      </>
    );
  return (
    <div
      data-node
      className={clsx(
        "absolute flex flex-col gap-[4px] overflow-hidden rounded-lg bg-raised px-[10px] py-[8px] text-left shadow-[inset_0_0_0_1px_var(--color-line-subtle)] transition-opacity before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
        n.kind === "goal" ? EDGE[n.state ?? "seen"] : "before:bg-transparent",
        n.state === "seen" && "shadow-[inset_0_0_0_1px_var(--color-line)] [background-image:none] outline-dashed outline-1 -outline-offset-1 outline-line-strong",
        selected && "shadow-[inset_0_0_0_2px_var(--color-focus)]",
        dim && "opacity-40",
        n.state === "discarded" && "opacity-55",
      )}
      style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <button type="button" onClick={onClick} aria-label={`${n.kind === "source" ? `Read ${n.title}` : n.title}`} aria-pressed={n.kind === "source" ? undefined : selected} className="absolute inset-0 z-0 cursor-pointer rounded-lg focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)] focus-visible:outline-none" />
      <span className="pointer-events-none relative flex h-[18px] items-center gap-[6px] text-micro font-medium text-fg-subtle">{head}</span>
      <span
        className={clsx("pointer-events-none relative text-body leading-[18px] text-fg", n.reading && "q-shimmer-text", n.state === "discarded" && "line-through", n.kind === "source" && "font-medium")}
        style={{ display: "-webkit-box", WebkitLineClamp: MAX_LINES, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        dir="auto"
      >
        {n.title}
      </span>
      {n.kind === "goal" && n.lineId && n.state !== "seen" && <Settle id={n.lineId} state={n.state!} working={working} act={act} />}
      {n.kind === "goal" && n.goalRef && (
        <span className="relative mt-auto flex justify-end">
          <IconBtn size="sm" label="Leave it out" onClick={() => dropKnown(n.goalRef!)}>
            <X size={13} {...ICON} />
          </IconBtn>
        </span>
      )}
    </div>
  );
}

/** ✓ and ✕ on a proposed goal, or its state once settled. */
function Settle({ id, state, working, act }: { id: string; state: string; working: boolean; act: (fn: () => Promise<void>) => void }) {
  return (
    <span className="relative mt-auto flex h-[26px] items-center justify-end gap-[4px]">
      {state === "accepted" ? (
        <span className="inline-flex h-[22px] items-center gap-[4px] rounded-md bg-success-subtle px-[6px] text-micro font-semibold text-success">
          <Check size={11} strokeWidth={2.25} /> Accepted
        </span>
      ) : state === "discarded" ? (
        <span className="text-micro font-medium text-fg-subtle">Left out</span>
      ) : (
        <>
          <Tip label="Leave it out">
            <button type="button" aria-label="Leave it out" disabled={working} onClick={() => act(() => discardLines([id]))} className="q-item grid size-[24px] place-items-center rounded-md text-fg-subtle shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-danger-subtle hover:text-danger disabled:opacity-50">
              <X size={13} {...ICON} />
            </button>
          </Tip>
          <Tip label="Accept">
            <button type="button" aria-label="Accept" disabled={working} onClick={() => act(() => acceptLines([id]))} className="q-item grid size-[24px] place-items-center rounded-md bg-success-subtle text-success hover:bg-success hover:text-app disabled:opacity-50">
              <Check size={13} strokeWidth={2} />
            </button>
          </Tip>
        </>
      )}
    </span>
  );
}
