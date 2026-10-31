import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";
import { AudioLines, Check, FileText, Globe, Maximize, Minus, PenLine, Plus, X } from "lucide-react";
import { brandOn, logoFor } from "@/connectors/logos";
import { KIND_LABEL } from "@/discovery/kinds";
import { CARD_LOOK, FOOTER, type Kind, KIND_MARK, KIND_TOKEN, MARK_STROKE, SOURCE, type SourceIcon, sourceMark, sourceTile, STATE, TAG, WIRE, wireCurve, wireIn, wireOut } from "@/discovery/look";
import { titleProps } from "@/discovery/metrics";
import { partLine } from "@/discovery/origin";
import { OST_PALETTE } from "@/engine/ost-palette";
import type { SetupDoc } from "@/org/setup";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { ConnectorLogo } from "../brand/ConnectorLogo";
import { IconBtn, Spinner, Tip } from "../controls";
import { useTheme } from "../theme";
import { dropKnown } from "../setup/know";
import { acceptLines, discardLines } from "../setup/setup";
import { CARD_KIND, hasFooter, pathOf, SETTLE_ROW, titleLines, type Canvas, type CanvasEdge, type CanvasNode } from "./canvas";

/*
 * The setup's canvas (./canvas.ts lays it out): what was sent on the left, wired to the problems and
 * goals Qalam AI found in it, n8n-style. Cards are HTML over a layer of SVG wires in one world that
 * pans and zooms (as the knowledge graph does: scroll pans, ⌘/Ctrl-scroll or pinch zooms, drag the
 * background); it frames everything as nodes arrive. Hovering or selecting a card lights its path and
 * dims the rest; a source opens its reader; a proposed goal is accepted (✓) or left out (✕) on its card.
 *
 * It looks as a board does: sizes, marks and wires come from src/discovery/look.ts and colours from the
 * theme tokens a board's palette repeats, so a source is the same tile with its port, and a card has
 * the same kind's tag over its top edge and footer under a rule, drawn here in HTML.
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

const ICONS: Record<SourceIcon, typeof PenLine> = { "pen-line": PenLine, globe: Globe, "file-text": FileText, "audio-lines": AudioLines };

/** A source's mark, small, beside its name (the reader's head): its connector's logo, else what it is (sourceMark). */
export function SourceMark({ doc }: { doc: SetupDoc | undefined }) {
  const what = sourceMark(doc?.from);
  if ("logo" in what) return <ConnectorLogo id={what.logo} size={16} decorative />;
  const Icon = ICONS[what.icon];
  return (
    <span className="grid size-[16px] shrink-0 place-items-center rounded-[3px] bg-kh-research/15 text-kh-research">
      <Icon size={11} {...ICON} />
    </span>
  );
}

/** A source's mark on its tile, as a board's lane paints it: the logo in its colour where that reads on the card, else ink; else an icon. */
function TileMark({ mark }: { mark: string | undefined }) {
  const card = OST_PALETTE[useTheme((t) => t.resolved)].card;
  const what = sourceMark(mark);
  const logo = "logo" in what ? logoFor(what.logo) : null;
  if (logo?.kind === "mark")
    return (
      <svg width={SOURCE.logo} height={SOURCE.logo} viewBox="0 0 24 24" aria-hidden fill={brandOn(logo.hex, card) ?? "var(--color-fg)"}>
        <path d={logo.path} />
      </svg>
    );
  const Icon = ICONS["icon" in what ? what.icon : "file-text"];
  return <Icon size={SOURCE.icon} absoluteStrokeWidth strokeWidth={1.75} className="text-fg-muted" aria-hidden />;
}

/** A kind's mark (◉ ○ ▸ ◇), in the colour around it. */
function KindMark({ kind, size }: { kind: Kind; size: number }) {
  const m = KIND_MARK[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden className="shrink-0">
      {m.stroke && <path d={m.stroke} fill="none" stroke="currentColor" strokeWidth={MARK_STROKE} />}
      {m.fill && <path d={m.fill} fill="currentColor" />}
    </svg>
  );
}

const pct = (k: number) => `${Math.round(k * 100)}%`;

/** A card's kind as a tag on its top edge, half above it, in the kind's colour (TAG); quiet while it's only been read. A click on it is a click on its card. */
function KindTag({ kind, label, quiet, onClick }: { kind: Kind; label: string; quiet?: boolean; onClick: () => void }) {
  const hue = `var(${KIND_TOKEN[kind]})`;
  return (
    <span
      aria-hidden
      onClick={onClick}
      className="absolute flex cursor-pointer items-center whitespace-nowrap"
      style={{
        left: CARD_LOOK.pad,
        top: -TAG.h / 2,
        height: TAG.h,
        paddingInline: TAG.pad,
        gap: TAG.mark - TAG.markSize,
        borderRadius: TAG.radius,
        color: hue,
        background: `color-mix(in srgb, ${hue} ${pct(quiet ? TAG.quietFill : TAG.fill)}, var(--color-card))`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hue} ${pct(quiet ? TAG.quietEdge : TAG.edge)}, transparent)`,
        fontSize: TAG.size,
        fontWeight: TAG.weight,
        letterSpacing: TAG.tracking,
      }}
    >
      <KindMark kind={kind} size={TAG.markSize} />
      {label}
    </span>
  );
}

/** Where something stands, at its footer's end: a dot (a ring when it's out) and a word (STATE). */
function StateWord({ tone, out, children }: { tone: string; out?: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap" style={{ color: tone, fontSize: STATE.size, fontWeight: STATE.weight, gap: STATE.room - STATE.dot * 2 }}>
      <span className="shrink-0 rounded-full" style={{ width: STATE.dot * 2, height: STATE.dot * 2, ...(out ? { boxShadow: "inset 0 0 0 1.25px currentColor" } : { background: "currentColor" }) }} />
      {children}
    </span>
  );
}

/** A card's surface, as a board paints one: dashed while it's only been read (subtle) or proposed (Qalam AI's colour). */
function surface(dashed: string | null, ring: number): CSSProperties {
  return {
    background: "var(--color-card)",
    borderRadius: CARD_LOOK.radius,
    border: dashed ? `1.25px dashed ${dashed}` : "1px solid var(--color-card-line)",
    boxShadow: [ring ? `0 0 0 ${ring}px var(--color-selection)` : "", "0 2px 12px var(--color-card-shadow)", "inset 0 1px 0 var(--color-card-edge)"].filter(Boolean).join(", "),
  };
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
            hot={(!!lit && lit.nodes.has(n.id)) || hovered === n.id}
            hovered={hovered === n.id}
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

/** A wire as a board draws one (look.ts): out of a source's port or a card's right edge, into a card's left, level with its title. */
function Wire({ e, a, b, state }: { e: CanvasEdge; a: CanvasNode; b: CanvasNode; state: "rest" | "lit" | "dim" }) {
  if (!a || !b) return null;
  const from = a.kind === "source" ? sourceTile(a).port : wireOut(a);
  const to = wireIn(b);
  const [c1x, c1y, c2x, c2y] = wireCurve(from.x, from.y, to.x, to.y);
  const tone = state === "lit" ? "var(--color-selection)" : "var(--color-wire)";
  return (
    <g opacity={state === "dim" ? WIRE.dim : 1}>
      <path d={`M ${from.x} ${from.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${to.x} ${to.y}`} fill="none" stroke={tone} strokeWidth={state === "lit" ? WIRE.lit : WIRE.width} strokeDasharray={e.kind === "under" ? "5 4" : undefined} />
      {/* A dot where it meets a card (and leaves one); a source's port is drawn on its tile. */}
      {a.kind !== "source" && <circle cx={from.x} cy={from.y} r={WIRE.dot} fill="var(--color-card)" stroke={tone} strokeWidth={WIRE.width} />}
      <circle cx={to.x} cy={to.y} r={WIRE.dot} fill="var(--color-card)" stroke={tone} strokeWidth={WIRE.width} />
    </g>
  );
}

interface NodeProps {
  n: CanvasNode;
  /** Off the lit path. */
  dim: boolean;
  /** On it, or under the pointer: a source's tile and port take the selection's colour. */
  hot: boolean;
  hovered: boolean;
  selected: boolean;
  onHover: (on: boolean) => void;
  onClick: () => void;
  working: boolean;
  act: (fn: () => Promise<void>) => void;
}

function NodeCard(props: NodeProps) {
  return props.n.kind === "source" ? <SourceNode {...props} /> : <Card {...props} />;
}

/** A source, as a board's lane draws one (SOURCE): its tile with its mark and port, its title and where it's from under it. */
function SourceNode({ n, dim, hot, onHover, onClick }: NodeProps) {
  const t = sourceTile({ x: 0, y: 0, w: n.w });
  return (
    <div data-node className="absolute transition-opacity" style={{ left: n.x, top: n.y, width: n.w, height: n.h, opacity: dim ? WIRE.dimItem : 1 }} onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}>
      <button type="button" onClick={onClick} aria-label={`Read ${n.title}`} className="absolute inset-0 z-0 cursor-pointer rounded-lg focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)] focus-visible:outline-none" />
      <span
        className="pointer-events-none absolute grid place-items-center"
        style={{
          left: t.x,
          top: 0,
          width: t.s,
          height: t.s,
          borderRadius: SOURCE.radius,
          background: "var(--color-card)",
          border: hot ? "1.5px solid var(--color-selection)" : "1px solid var(--color-card-line)",
          boxShadow: `0 2px 12px var(--color-card-shadow)${hot ? "" : ", inset 0 1px 0 var(--color-card-edge)"}`,
        }}
      >
        <TileMark mark={n.doc?.from} />
        {n.reading && (
          <span className="absolute right-[5px] top-[5px] text-fg-subtle">
            <Spinner size={10} />
          </span>
        )}
      </span>
      {/* Its port, where its wires leave. */}
      <span className="pointer-events-none absolute rounded-full" style={{ left: t.port.x - SOURCE.port, top: t.port.y - SOURCE.port, width: SOURCE.port * 2, height: SOURCE.port * 2, background: hot ? "var(--color-selection)" : "var(--color-wire)", boxShadow: "0 0 0 1.5px var(--color-card)" }} />
      <span className="pointer-events-none absolute left-0 flex w-full flex-col items-center text-center" style={{ top: SOURCE.tile + SOURCE.labelGap, gap: SOURCE.lineGap }}>
        <span className={clsx("w-full font-medium text-fg", n.reading && "q-shimmer-text")} style={{ fontSize: SOURCE.titleSize, lineHeight: "16px", display: "-webkit-box", WebkitLineClamp: SOURCE.titleLines, WebkitBoxOrient: "vertical", overflow: "hidden" }} dir="auto">
          {n.title}
        </span>
        <span className="w-full truncate font-mono text-fg-subtle" style={{ fontSize: SOURCE.lineSize, lineHeight: "14px" }}>
          {partLine(n.doc)}
        </span>
      </span>
    </div>
  );
}

/** A problem or a goal, as a board paints a card: its kind's tag over its top edge, its title, and a goal's state in a footer under a rule. */
function Card({ n, dim, hovered, selected, onHover, onClick, working, act }: NodeProps) {
  const kind: Kind = n.kind === "problem" ? "problem" : "goal";
  const label = n.number ? "Number" : KIND_LABEL[CARD_KIND[n.kind as "problem" | "goal"]];
  const title = titleProps({ kind: CARD_KIND[n.kind as "problem" | "goal"], title: n.title });
  const dashed = n.state === "seen" ? "var(--color-fg-subtle)" : n.state === "proposed" ? "var(--color-ai)" : null;
  return (
    <div
      data-node
      className="absolute flex flex-col text-left transition-opacity"
      style={{ left: n.x, top: n.y, width: n.w, height: n.h, opacity: dim ? WIRE.dimItem : n.state === "discarded" ? 0.55 : 1, ...surface(dashed, selected ? 2 : hovered ? 1.5 : 0) }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <button type="button" onClick={onClick} aria-label={`${label}: ${n.title}`} aria-pressed={selected} className="absolute inset-0 z-0 cursor-pointer rounded-[inherit] focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)] focus-visible:outline-none" />
      <KindTag kind={kind} label={label} quiet={n.state === "seen"} onClick={onClick} />
      <span
        className={clsx("pointer-events-none relative text-fg", n.state === "discarded" && "line-through")}
        style={{
          margin: `${CARD_LOOK.top}px ${CARD_LOOK.pad}px 0`,
          fontSize: title.fontSize,
          fontWeight: title.fontWeight,
          lineHeight: `${title.lineHeight}px`,
          letterSpacing: title.letterSpacing,
          display: "-webkit-box",
          WebkitLineClamp: titleLines(n.kind as "problem" | "goal", n.title),
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
        dir="auto"
      >
        {n.title}
      </span>
      {hasFooter(n) && <Footer n={n} working={working} act={act} />}
    </div>
  );
}

/** A goal's footer: Qalam AI's proposal with ✕ and ✓, where it stands once settled, or their own goal with ✕. */
function Footer({ n, working, act }: { n: CanvasNode; working: boolean; act: (fn: () => Promise<void>) => void }) {
  return (
    <span
      className="relative mt-auto flex items-center justify-between gap-[8px]"
      style={{ height: SETTLE_ROW + FOOTER.pad * 2 + 1, padding: `${FOOTER.pad}px ${CARD_LOOK.pad}px`, borderTop: "1px solid var(--color-card-line)", background: "var(--color-card-footer)", borderRadius: `0 0 ${CARD_LOOK.radius - 1}px ${CARD_LOOK.radius - 1}px` }}
    >
      {n.state === "proposed" ? (
        <span className="pointer-events-none inline-flex items-center gap-[5px] text-ai" style={{ fontSize: STATE.size, fontWeight: STATE.weight }}>
          <QalamAIGlyph size={12} /> Proposed
        </span>
      ) : n.state === "kept" ? (
        <span className="pointer-events-none text-fg-muted" style={{ fontSize: STATE.size, fontWeight: STATE.weight }}>
          In your words
        </span>
      ) : (
        <span />
      )}
      {n.state === "accepted" ? (
        <StateWord tone="var(--color-success)">Accepted</StateWord>
      ) : n.state === "discarded" ? (
        <StateWord tone="var(--color-fg-subtle)" out>
          Left out
        </StateWord>
      ) : n.state === "kept" ? (
        <IconBtn size="sm" label="Leave it out" onClick={() => dropKnown(n.goalRef!)}>
          <X size={13} {...ICON} />
        </IconBtn>
      ) : n.lineId ? (
        <Settle id={n.lineId} working={working} act={act} />
      ) : null}
    </span>
  );
}

/** ✕ and ✓ on a proposed goal. */
function Settle({ id, working, act }: { id: string; working: boolean; act: (fn: () => Promise<void>) => void }) {
  return (
    <span className="flex items-center gap-[4px]">
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
    </span>
  );
}
