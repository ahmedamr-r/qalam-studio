import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { quadtree, type Quadtree } from "d3-quadtree";
import { boundsOf, nodeRadius, type Positions } from "@/knowledge/layout";
import { nearestInDirection, pickLabels, type Direction, type View } from "@/knowledge/lod";
import type { EdgeKind, Group, KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "@/knowledge/types";
import { DECISION_ICON, GROUP_TINT, KIND_ICON } from "./icons";

/**
 * The hub's network, drawn in SVG. Nodes and lines sit in one world group whose transform pans and
 * zooms them; labels are drawn in screen space, chosen so they never overlap. A selected decision
 * lights up its trace (solid = relied on, dashed = given but not used) and dims everything else.
 *
 * Gestures follow the canvas: scroll pans, ⌘/Ctrl-scroll or pinch zooms, drag the background to
 * pan, drag a node to move it. Keys: arrows walk to the nearest node, Esc clears, 0 fits, = and - zoom.
 */

export const GROUP_COLOR: Record<Group, string> = GROUP_TINT;

export interface GraphApi {
  fit: () => void;
  focus: (ref: string) => void;
  zoom: (factor: number) => void;
}

const STRUCTURE = new Set<EdgeKind>(["part", "about", "uses", "mentions", "source", "context", "parent", "produced"]);
const MIN_K = 0.15;
const MAX_K = 3;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));
/** Nodes follow the zoom, but never shrink below ~70% (their icons stay readable) or grow past 140%. */
const dotScale = (k: number) => Math.min(1.4, Math.max(0.7, k));

interface Props {
  graph: KnowledgeGraph;
  positions: Positions;
  selected: string | null;
  onSelect: (ref: string | null) => void;
  /** Refs to keep bright (a group, a status or a search); null: all. */
  highlight: ReadonlySet<string> | null;
  /** Draw every decision's given links, not only the selected one's. */
  showGiven: boolean;
  initialView: View | null;
  onView: (v: View) => void;
  onMove: (ref: string, p: [number, number]) => void;
  onMoveEnd: () => void;
  /** Enter on a node: move focus to the inspector. */
  onOpen?: () => void;
  api?: Ref<GraphApi>;
}

export default function GraphView({ graph, positions, selected, onSelect, highlight, showGiven, initialView, onView, onMove, onMoveEnd, onOpen, api }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600, measured: false });
  const [view, setView] = useState<View>(initialView ?? { x: 400, y: 300, k: 0.8 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [hovered, setHovered] = useState<string | null>(null);
  /** false: frame the graph once measured; true: a saved view to check; "checked": done. */
  const fitted = useRef<boolean | "checked">(!!initialView);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height, measured: true }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const commitView = useCallback(
    (v: View) => {
      viewRef.current = v;
      setView(v);
      onView(v);
    },
    [onView],
  );

  const visible = useMemo(() => graph.nodes.filter((n) => positions[n.ref]), [graph, positions]);
  const tree = useMemo<Quadtree<KnowledgeNode>>(
    () =>
      quadtree<KnowledgeNode>()
        .x((n) => positions[n.ref][0])
        .y((n) => positions[n.ref][1])
        .addAll(visible),
    [visible, positions],
  );

  const fit = useCallback(() => {
    const b = boundsOf(positions, visible.map((n) => n.ref));
    if (!b || !size.w) return;
    const pad = 80;
    const k = clampK(Math.min((size.w - pad * 2) / Math.max(b.w, 1), (size.h - pad * 2) / Math.max(b.h, 1), 1.2));
    commitView({ k, x: size.w / 2 - (b.x + b.w / 2) * k, y: size.h / 2 - (b.y + b.h / 2) * k });
  }, [positions, visible, size, commitView]);

  const focus = useCallback(
    (r: string) => {
      const p = positions[r];
      if (!p) return;
      const v = viewRef.current;
      const k = Math.max(v.k, 0.9);
      commitView({ k, x: size.w / 2 - p[0] * k, y: size.h / 2 - p[1] * k });
    },
    [positions, size, commitView],
  );

  const zoomAt = useCallback(
    (factor: number, sx = size.w / 2, sy = size.h / 2) => {
      const v = viewRef.current;
      const k = clampK(v.k * factor);
      const wx = (sx - v.x) / v.k;
      const wy = (sy - v.y) / v.k;
      commitView({ k, x: sx - wx * k, y: sy - wy * k });
    },
    [size, commitView],
  );

  useImperativeHandle(api, () => ({ fit, focus, zoom: (f) => zoomAt(f) }), [fit, focus, zoomAt]);

  // The first time there are positions and a measured size, frame everything.
  useEffect(() => {
    if (!visible.length || !size.measured || size.w < 10) return;
    if (fitted.current) {
      // A saved view that shows none of the graph (the panel was another size then) frames it again.
      if (fitted.current === "checked") return;
      fitted.current = "checked";
      const v = viewRef.current;
      const onScreen = visible.some((n) => {
        const sx = positions[n.ref][0] * v.k + v.x;
        const sy = positions[n.ref][1] * v.k + v.y;
        return sx > 0 && sy > 0 && sx < size.w && sy < size.h;
      });
      if (onScreen) return;
    }
    fitted.current = "checked";
    fit();
  }, [visible, positions, size.measured, size.w, size.h, fit]);

  // Wheel: scroll pans, ⌘/Ctrl (and trackpad pinch) zooms around the pointer. Needs a non-passive listener.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
      else {
        const v = viewRef.current;
        commitView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, commitView]);

  const toWorld = (clientX: number, clientY: number): [number, number] => {
    const rect = host.current!.getBoundingClientRect();
    const v = viewRef.current;
    return [(clientX - rect.left - v.x) / v.k, (clientY - rect.top - v.y) / v.k];
  };
  const nodeAt = (clientX: number, clientY: number): KnowledgeNode | null => {
    const [x, y] = toWorld(clientX, clientY);
    const k = viewRef.current.k;
    const hit = tree.find(x, y, (14 * dotScale(k)) / k + 4 / k);
    return hit ?? null;
  };

  const drag = useRef<{ kind: "pan" | "node"; ref?: string; sx: number; sy: number; vx: number; vy: number; moved: boolean; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    host.current?.focus({ preventScroll: true });
    const n = nodeAt(e.clientX, e.clientY);
    const v = viewRef.current;
    drag.current = { kind: n ? "node" : "pan", ref: n?.ref, sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      const n = nodeAt(e.clientX, e.clientY);
      setHovered(n?.ref ?? null);
      return;
    }
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    if (d.kind === "pan") commitView({ ...viewRef.current, x: d.vx + dx, y: d.vy + dy });
    else if (d.ref) onMove(d.ref, toWorld(e.clientX, e.clientY));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(d.id);
    if (d.moved) {
      if (d.kind === "node") onMoveEnd();
      return;
    }
    onSelect(d.kind === "node" ? (d.ref ?? null) : null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const dirs: Record<string, Direction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    if (dirs[e.key]) {
      e.preventDefault();
      const items = visible.map((n) => ({ ref: n.ref, x: positions[n.ref][0], y: positions[n.ref][1] }));
      const v = viewRef.current;
      const from = selected && positions[selected] ? { x: positions[selected][0], y: positions[selected][1] } : { x: (size.w / 2 - v.x) / v.k, y: (size.h / 2 - v.y) / v.k };
      const next = selected ? nearestInDirection(from, items, dirs[e.key], selected) : (items.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0]?.ref ?? null);
      if (next) {
        onSelect(next);
        const p = positions[next];
        const sx = p[0] * v.k + v.x;
        const sy = p[1] * v.k + v.y;
        if (sx < 40 || sy < 40 || sx > size.w - 40 || sy > size.h - 40) focus(next);
      }
    } else if (e.key === "Escape" && selected) {
      e.preventDefault();
      onSelect(null);
    } else if (e.key === "Enter" && selected) {
      e.preventDefault();
      onOpen?.();
    } else if (e.key === "0" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      fit();
    } else if ((e.key === "=" || e.key === "+") && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      zoomAt(1.25);
    } else if (e.key === "-" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      zoomAt(0.8);
    }
  };

  // What the selection lights up: a node and everything it links to.
  const lit = useMemo(() => {
    if (!selected) return null;
    const s = new Set([selected]);
    for (const e of graph.edges) {
      if (e.kind === "given" && !showGiven && !(e.to === selected && graph.byRef.get(selected)?.kind === "decision")) continue;
      if (e.from === selected) s.add(e.to);
      if (e.to === selected) s.add(e.from);
    }
    return s;
  }, [selected, graph, showGiven]);

  const kq = Math.round(view.k * 100) / 100;
  const labelItems = useMemo(
    () =>
      visible.map((n) => ({
        ref: n.ref,
        x: positions[n.ref][0],
        y: positions[n.ref][1],
        r: (nodeRadius(n) * dotScale(kq)) / kq,
        label: n.label,
        weight: (n.kind === "decision" ? 6 : n.kind === "system" ? 8 : 0) + n.usage.relied * 2 + (n.group === "anchor" ? 0 : 1),
      })),
    [visible, positions, kq],
  );
  // Always labelled: the selection, the hovered node and (for a decision) what it relied on. The rest of
  // what the selection lights up goes first among the others, but never on top of another label.
  const strongRefs = useMemo(() => {
    const s = new Set<string>();
    if (!selected) return s;
    const decision = graph.byRef.get(selected)?.kind === "decision";
    for (const e of graph.edges) {
      if (decision ? e.to === selected && e.kind === "relied" : e.from === selected || e.to === selected) s.add(e.from === selected ? e.to : e.from);
      if (s.size >= 12) break;
    }
    return s;
  }, [selected, graph]);
  const labels = useMemo(() => {
    const must = new Set<string>(strongRefs);
    if (selected) must.add(selected);
    if (hovered) must.add(hovered);
    const pool = (lit ? labelItems.filter((it) => lit.has(it.ref)) : highlight ? labelItems.filter((it) => highlight.has(it.ref)) : labelItems).map((it) => ({ ...it, weight: it.weight + 100 }));
    const rest = lit || highlight ? labelItems.filter((it) => !(lit ?? highlight)!.has(it.ref)) : [];
    return pickLabels([...pool, ...rest], view, size, must);
  }, [labelItems, view, size, selected, hovered, lit, highlight, strongRefs]);

  const sel = selected ? graph.byRef.get(selected) : null;

  return (
    <div
      ref={host}
      tabIndex={0}
      role="application"
      aria-label="Knowledge graph. Arrow keys move between nodes, Enter opens the details."
      aria-roledescription="graph"
      className="relative h-full w-full touch-none overflow-hidden bg-canvas outline-none select-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)]"
      style={{ cursor: drag.current?.kind === "pan" && drag.current.moved ? "grabbing" : hovered ? "pointer" : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => !drag.current && setHovered(null)}
      onKeyDown={onKeyDown}
    >
      <svg width={size.w} height={size.h} className="block">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <Edges graph={graph} positions={positions} selected={selected} showGiven={showGiven} dim={!!lit || !!highlight} highlight={highlight} />
          <Nodes nodes={visible} positions={positions} k={kq} lit={lit} highlight={highlight} />
          <Rings positions={positions} k={kq} selected={sel ?? null} hovered={hovered && hovered !== selected ? (graph.byRef.get(hovered) ?? null) : null} />
        </g>
        <g aria-hidden>
          {labelItems.map((it) => {
            if (!labels.has(it.ref)) return null;
            const n = graph.byRef.get(it.ref)!;
            const strong = it.ref === selected || it.ref === hovered || (lit?.has(it.ref) ?? false);
            const faded = (lit && !lit.has(it.ref)) || (!lit && highlight && !highlight.has(it.ref));
            return (
              <text
                key={it.ref}
                x={it.x * view.k + view.x + it.r * view.k + 5}
                y={it.y * view.k + view.y}
                dominantBaseline="central"
                className="text-[11px]"
                style={{ paintOrder: "stroke", stroke: "var(--color-canvas)", strokeWidth: 3, strokeLinejoin: "round", fill: strong ? "var(--color-fg)" : "var(--color-fg-muted)", fontWeight: n.kind === "decision" || it.ref === selected ? 500 : 400, opacity: faded ? 0.35 : 1 }}
              >
                {n.label.length > 40 ? `${n.label.slice(0, 39)}…` : n.label}
              </text>
            );
          })}
        </g>
      </svg>
      <p className="sr-only" aria-live="polite">
        {sel ? `${sel.label}. ${sel.kind}.` : ""}
      </p>
    </div>
  );
}

/** Lines: structure faint, relied on solid, given dashed (the selected decision's, or all when asked); the selection's own on top. */
const Edges = memo(function Edges({ graph, positions, selected, showGiven, dim, highlight }: { graph: KnowledgeGraph; positions: Positions; selected: string | null; showGiven: boolean; dim: boolean; highlight: ReadonlySet<string> | null }) {
  const paths = useMemo(() => {
    const seg = (e: KnowledgeEdge) => {
      const a = positions[e.from];
      const b = positions[e.to];
      return a && b ? `M${a[0]} ${a[1]}L${b[0]} ${b[1]}` : "";
    };
    const out = { structure: "", relied: "", given: "", selRelied: "", selGiven: "", selOther: "" };
    for (const e of graph.edges) {
      const mine = !!selected && (e.from === selected || e.to === selected);
      const faded = highlight && !(highlight.has(e.from) && highlight.has(e.to));
      if (e.kind === "given") {
        if (mine && graph.byRef.get(selected!)?.kind === "decision") out.selGiven += seg(e);
        else if (showGiven && !faded) out.given += seg(e);
        continue;
      }
      if (mine) {
        if (e.kind === "relied") out.selRelied += seg(e);
        else out.selOther += seg(e);
        continue;
      }
      if (faded) continue;
      if (e.kind === "relied") out.relied += seg(e);
      else if (STRUCTURE.has(e.kind)) out.structure += seg(e);
    }
    return out;
  }, [graph, positions, selected, showGiven, highlight]);
  const base = { fill: "none", vectorEffect: "non-scaling-stroke" as const, strokeLinecap: "round" as const };
  return (
    <g style={{ opacity: 1 }}>
      <path d={paths.structure} {...base} stroke="var(--color-line)" strokeWidth={1} opacity={dim ? 0.45 : 1} />
      <path d={paths.relied} {...base} stroke="var(--color-fg-faint)" strokeWidth={1.25} opacity={dim ? 0.45 : 1} />
      <path d={paths.given} {...base} stroke="var(--color-fg-faint)" strokeWidth={1} strokeDasharray="3 4" opacity={dim ? 0.35 : 0.7} />
      <path d={paths.selOther} {...base} stroke="var(--color-fg-muted)" strokeWidth={1.25} />
      <path d={paths.selGiven} {...base} stroke="var(--color-ai)" strokeWidth={1.25} strokeDasharray="3 4" opacity={0.7} />
      <path d={paths.selRelied} {...base} stroke="var(--color-ai)" strokeWidth={2} />
    </g>
  );
});

/**
 * Nodes: a round chip per fact with the icon of its kind, in the colour of its group. Anchors
 * (screens, tokens, components, systems) are outlined; forgotten facts dashed, removed ones dotted.
 * Zoomed far out the icons give way to plain dots.
 */
const Nodes = memo(function Nodes({ nodes, positions, k, lit, highlight }: { nodes: KnowledgeNode[]; positions: Positions; k: number; lit: ReadonlySet<string> | null; highlight: ReadonlySet<string> | null }) {
  const s = dotScale(k) / k;
  return (
    <g>
      {nodes.map((n) => {
        const [x, y] = positions[n.ref];
        const r = nodeRadius(n) * s;
        const color = GROUP_TINT[n.group];
        const faded = lit ? !lit.has(n.ref) : highlight ? !highlight.has(n.ref) : false;
        const op = faded ? 0.16 : n.status === "capped" ? 0.55 : 1;
        const stroke = { vectorEffect: "non-scaling-stroke" as const };
        const outline = n.group === "anchor" || n.status === "forgotten" || n.status === "ghost" || !!n.decision?.legacy;
        const I = n.kind === "decision" && n.decision ? DECISION_ICON[n.decision.kind] : KIND_ICON[n.kind];
        const is = r * 1.15;
        return (
          <g key={n.ref} opacity={n.status === "forgotten" && !faded ? 0.55 : op}>
            <circle
              cx={x}
              cy={y}
              r={r}
              fill={outline ? "var(--color-canvas)" : color}
              stroke={outline ? color : "none"}
              strokeWidth={n.kind === "system" ? 1.75 : 1.25}
              strokeDasharray={n.status === "ghost" ? "1 2.5" : n.status === "forgotten" ? "2.5 2.5" : undefined}
              {...stroke}
            />
            {nodeRadius(n) * dotScale(k) >= 6 && <I x={x - is / 2} y={y - is / 2} width={is} height={is} color={outline ? color : "var(--color-canvas)"} strokeWidth={2.25} aria-hidden />}
            {n.pinned && <circle cx={x} cy={y} r={r + 3 / k} fill="none" stroke={color} strokeWidth={1} {...stroke} />}
          </g>
        );
      })}
    </g>
  );
});

/** Selection and hover rings, constant on screen. */
function Rings({ positions, k, selected, hovered }: { positions: Positions; k: number; selected: KnowledgeNode | null; hovered: KnowledgeNode | null }) {
  const ring = (n: KnowledgeNode, w: number, op: number) => {
    const p = positions[n.ref];
    if (!p) return null;
    const r = (nodeRadius(n) * dotScale(k)) / k + 4 / k;
    return <circle key={`${n.ref}:${w}`} cx={p[0]} cy={p[1]} r={r} fill="none" stroke="var(--color-selection)" strokeWidth={w} opacity={op} vectorEffect="non-scaling-stroke" />;
  };
  return (
    <g pointerEvents="none">
      {hovered && ring(hovered, 1.5, 0.6)}
      {selected && ring(selected, 2, 1)}
    </g>
  );
}
