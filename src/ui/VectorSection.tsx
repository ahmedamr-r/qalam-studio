import type { ReactNode } from "react";
import clsx from "clsx";
import { ArrowLeftRight, ChevronDown, PenTool } from "lucide-react";
import type { Mirror, PathNode, StrokeEnd } from "@/doc/schema";
import { type Mat, apply, invert, localMatrix, mul } from "@/doc/geometry";
import { studio } from "@/doc/store";
import { isEditableVector, movePoints, normalizeVectorNode, setMirror, vectorOf, vectorScale, writeVector } from "@/doc/vector";
import { clampCount, shapeVector } from "@/doc/vector-shapes";
import { exitEdit } from "@/engine/vector-edit";
import { useVectorEdit } from "@/engine/vector-state";
import { Button, Field, Hint, IconBtn, NumberField, Row, Section, Segmented } from "./controls";
import { Menu, MenuItem, MenuLabel } from "./menu";
import { r } from "./recipes";
import { editNow } from "./useSelection";
import { layerKind } from "./layerKind";

/*
 * Design panel section for a selected path: polygon/star parameters, stroke joins and ends (with
 * arrowhead previews), the vector's make-up with an Edit vector button, and, in edit mode, the
 * selected points' position and handle mirroring. Rows sit on the panel's `1fr 1fr 24px` grid.
 */

const END_OPTIONS: { value: StrokeEnd; label: string }[] = [
  { value: "none", label: "None" },
  { value: "round", label: "Round" },
  { value: "square", label: "Square" },
  { value: "arrow-lines", label: "Line arrow" },
  { value: "arrow-triangle", label: "Triangle arrow" },
  { value: "triangle-reversed", label: "Reversed triangle" },
  { value: "circle", label: "Circle arrow" },
  { value: "diamond", label: "Diamond arrow" },
];

// Icons, as in Figma: the words don't fit a third of the panel on one line (the title says them).
const MIRROR_OPTIONS: { value: Mirror; label: ReactNode; title: string }[] = [
  { value: "none", label: <MirrorIcon mirror="none" />, title: "No mirroring" },
  { value: "angle", label: <MirrorIcon mirror="angle" />, title: "Mirror angle" },
  { value: "angle-length", label: <MirrorIcon mirror="angle-length" />, title: "Mirror angle and length" },
];

/** Vector space → the parent's space (where the panel's X/Y live). */
function parentMatrix(n: PathNode): Mat {
  const { sx, sy } = vectorScale(n);
  return mul(localMatrix(n), [sx, 0, 0, sy, 0, 0]);
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function edit(id: string, fn: (n: PathNode) => void) {
  studio().beginTx();
  studio().mutate((d) => {
    const n = d.nodes[id];
    if (n?.type === "path") fn(n);
  });
}
const commit = () => studio().commitTx();

export default function VectorSection({ node }: { node: PathNode }) {
  const editId = useVectorEdit((s) => s.nodeId);
  const points = useVectorEdit((s) => s.points);
  const editing = editId === node.id;
  const id = node.id;
  const v = vectorOf(node);
  const anchors = v.paths.reduce((k, p) => k + p.points.length, 0);
  const open = v.paths.some((p) => !p.closed);
  const shape = node.shape;

  const sel = editing ? points.filter((p) => v.paths[p.path]?.points[p.point]) : [];
  const m = parentMatrix(node);
  const pos = sel.map((p) => apply(m, v.paths[p.path].points[p.point]));
  const same = (k: "x" | "y") => (pos.length && pos.every((p) => Math.abs(p[k] - pos[0][k]) < 0.005) ? round2(pos[0][k]) : null);
  const mirrors = sel.map((p) => v.paths[p.path].points[p.point].mirror);
  const mirror = mirrors.length && mirrors.every((x) => x === mirrors[0]) ? mirrors[0] : null;

  /** Move the selected points so the first lands on `value` along one axis (the rest follow). */
  const movePointsTo = (axis: "x" | "y", value: number) =>
    edit(id, (n) => {
      const cur = vectorOf(n);
      const pm = parentMatrix(n);
      const first = sel[0] && cur.paths[sel[0].path]?.points[sel[0].point];
      if (!first) return;
      const at = apply(pm, first);
      const d = { x: axis === "x" ? value - at.x : 0, y: axis === "y" ? value - at.y : 0 };
      const inv = invert(pm);
      const dv = { x: inv[0] * d.x + inv[2] * d.y, y: inv[1] * d.x + inv[3] * d.y };
      delete n.shape;
      // Edited by hand: an ordinary vector now, no longer rebuilt from its parts.
      delete n.recipe;
      delete n.fillParent;
      normalizeVectorNode(n, movePoints(cur, sel, dv.x, dv.y));
    });

  const ends = node.ends ?? { start: "round" as StrokeEnd, end: "round" as StrokeEnd };
  const setEnds = (next: { start: StrokeEnd; end: StrokeEnd }) => editNow([id], (n) => void (n.type === "path" && (n.ends = next)));

  return (
    <Section
      title={layerKind(node).label}
      actions={
        editing ? (
          <Button size="sm" variant="primary" onClick={() => exitEdit()}>
            Done
          </Button>
        ) : (
          <IconBtn size="sm" label="Edit vector" command="vector.edit" onClick={() => useVectorEdit.getState().enter(id)}>
            <PenTool size={14} />
          </IconBtn>
        )
      }
    >
      <p className="-mt-[4px] text-micro text-fg-subtle tnum">
        {anchors} {anchors === 1 ? "point" : "points"} · {v.paths.length} {v.paths.length === 1 ? "path" : "paths"} · {open ? "open" : "closed"}
      </p>

      {(shape?.kind === "polygon" || shape?.kind === "star") && (
        <Field label={shape.kind === "star" ? "Points · ratio" : "Sides"}>
          <Row>
            <NumberField
              label="#"
              title="Count (3–60)"
              value={shape.count}
              min={3}
              max={60}
              onChange={(c) =>
                edit(id, (n) => {
                  if (n.shape?.kind !== "polygon" && n.shape?.kind !== "star") return;
                  n.shape.count = clampCount(c);
                  // Regenerate in the vector box so a non-uniform resize is kept.
                  writeVector(n, shapeVector(n.shape, n.vw, n.vh));
                })
              }
              onCommit={commit}
            />
            {shape.kind === "star" && (
              <NumberField
                label={<StarRatioIcon />}
                title="Ratio: inner radius over outer radius"
                value={round2(shape.ratio * 1000) / 10}
                min={0}
                max={100}
                step={1}
                suffix="%"
                onChange={(ratio) =>
                  edit(id, (n) => {
                    if (n.shape?.kind !== "star") return;
                    n.shape.ratio = Math.max(0, Math.min(1, ratio / 100));
                    writeVector(n, shapeVector(n.shape, n.vw, n.vh));
                  })
                }
                onCommit={commit}
              />
            )}
          </Row>
        </Field>
      )}

      {editing && sel.length > 0 && (
        <>
          <Field label={sel.length === 1 ? "Point" : `${sel.length} points`}>
            <Row>
              <NumberField label="X" value={same("x")} onChange={(x) => movePointsTo("x", x)} onCommit={commit} />
              <NumberField label="Y" value={same("y")} onChange={(y) => movePointsTo("y", y)} onCommit={commit} />
            </Row>
          </Field>
          <Field label="Mirroring">
            <Row>
              <Segmented
                className="col-span-2"
                value={mirror}
                options={MIRROR_OPTIONS}
                onChange={(mode) =>
                  editNow([id], (n) => {
                    if (n.type !== "path") return;
                    delete n.shape;
                    // Edited by hand: an ordinary vector now, no longer rebuilt from its parts.
                    delete n.recipe;
                    delete n.fillParent;
                    normalizeVectorNode(n, setMirror(vectorOf(n), sel, mode));
                  })
                }
              />
            </Row>
          </Field>
        </>
      )}

      {node.stroke && (
        <Field label="Join">
          <Row>
            <Segmented
              className="col-span-2"
              value={node.join ?? "round"}
              options={[
                { value: "miter", label: <JoinIcon join="miter" />, title: "Miter join" },
                { value: "round", label: <JoinIcon join="round" />, title: "Round join" },
                { value: "bevel", label: <JoinIcon join="bevel" />, title: "Bevel join" },
              ]}
              onChange={(join) => editNow([id], (n) => void (n.type === "path" && (n.join = join)))}
            />
          </Row>
        </Field>
      )}

      {node.stroke && open && (
        <Field label="Ends">
          <Row>
            <EndSelect side="start" value={ends.start} onChange={(start) => setEnds({ ...ends, start })} />
            <EndSelect side="end" value={ends.end} onChange={(end) => setEnds({ ...ends, end })} />
            <IconBtn size="sm" label="Swap ends" onClick={() => setEnds({ start: ends.end, end: ends.start })}>
              <ArrowLeftRight size={14} />
            </IconBtn>
          </Row>
        </Field>
      )}

      {node.fill && isEditableVector(node) && !v.paths.some((p) => p.closed) && <Hint tone="info">Fill shows on closed paths only. Close the path or use the paint bucket.</Hint>}
    </Section>
  );
}

/** Start / end decoration picker: every option shows its arrowhead, drawn on the side it applies to. */
function EndSelect({ side, value, onChange }: { side: "start" | "end"; value: StrokeEnd; onChange: (v: StrokeEnd) => void }) {
  const label = END_OPTIONS.find((o) => o.value === value)?.label ?? value;
  return (
    // Drops below its field like Figma's field menus (the start menu from the left edge, the end menu from the right).
    <Menu
      label={side === "start" ? "Start point" : "End point"}
      checks
      align={side === "start" ? "start" : "end"}
      sideOffset={4}
      className="w-[208px]"
      trigger={
        <button type="button" aria-label={`${side === "start" ? "Start" : "End"}: ${label}`} title={label} className={clsx(r.selectTrigger, "pl-[6px] text-fg")}>
          <EndGlyph end={value} side={side} />
          <ChevronDown size={12} />
        </button>
      }
    >
      <MenuLabel>{side === "start" ? "Start point" : "End point"}</MenuLabel>
      {END_OPTIONS.map((o) => (
        <MenuItem key={o.value} checked={o.value === value} onSelect={() => onChange(o.value)}>
          <span className="flex min-w-0 items-center gap-[8px]">
            <EndGlyph end={o.value} side={side} />
            <span className="min-w-0 truncate">{o.label}</span>
          </span>
        </MenuItem>
      ))}
    </Menu>
  );
}

/** A 28×12 stroke with the decoration at its start (left) or end (right). */
function EndGlyph({ end, side }: { end: StrokeEnd; side: "start" | "end" }) {
  const tip = 22;
  const head = (() => {
    switch (end) {
      case "arrow-lines":
        return <path d={`M${tip - 5} 2 ${tip} 6 ${tip - 5} 10`} fill="none" />;
      case "arrow-triangle":
        return <path d={`M${tip - 6} 1.5 ${tip + 1} 6 ${tip - 6} 10.5Z`} fill="currentColor" stroke="none" />;
      case "triangle-reversed":
        return <path d={`M${tip + 1} 1.5 ${tip - 6} 6 ${tip + 1} 10.5Z`} fill="currentColor" stroke="none" />;
      case "circle":
        return <circle cx={tip - 1} cy={6} r={3.25} fill="currentColor" stroke="none" />;
      case "diamond":
        return <path d={`M${tip - 1} 2 ${tip + 3} 6 ${tip - 1} 10 ${tip - 5} 6Z`} fill="currentColor" stroke="none" />;
      default:
        return null;
    }
  })();
  const cap = end === "round" ? "round" : end === "square" ? "square" : "butt";
  const lineEnd = end === "arrow-triangle" || end === "triangle-reversed" || end === "circle" || end === "diamond" ? tip - 3 : end === "none" || end === "arrow-lines" ? tip : tip - 2;
  return (
    <svg width="28" height="12" viewBox="0 0 28 12" aria-hidden className="shrink-0 text-fg-muted" style={side === "start" ? { transform: "scaleX(-1)" } : undefined}>
      <g stroke="currentColor" strokeWidth={end === "round" || end === "square" ? 3 : 1.5} strokeLinejoin="round">
        <line x1={3} y1={6} x2={lineEnd} y2={6} strokeLinecap={cap} />
      </g>
      <g stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        {head}
      </g>
    </svg>
  );
}

function JoinIcon({ join }: { join: "miter" | "round" | "bevel" }) {
  const d = join === "miter" ? "M3 13V3h10" : join === "round" ? "M3 13V8a5 5 0 0 1 5-5h5" : "M3 13V6l3-3h7";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin={join === "miter" ? "miter" : "round"}>
      <path d={d} />
    </svg>
  );
}

/** An anchor and its two handles: broken, collinear, or collinear and equal. */
function MirrorIcon({ mirror }: { mirror: Mirror }) {
  const [a, b] = mirror === "none" ? [[3, 3], [13.5, 9.5]] : mirror === "angle" ? [[2.5, 10.75], [11, 6.5]] : [[2.5, 10.75], [13.5, 5.25]];
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
      <path d={`M${a[0]} ${a[1]}L8 8L${b[0]} ${b[1]}`} />
      <circle cx={a[0]} cy={a[1]} r="1.25" fill="currentColor" stroke="none" />
      <circle cx={b[0]} cy={b[1]} r="1.25" fill="currentColor" stroke="none" />
      <rect x="6.25" y="6.25" width="3.5" height="3.5" rx="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function StarRatioIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round">
      <path d="M6 1.2 7.3 4.6 10.8 4.8 8.1 7 9 10.5 6 8.6 3 10.5 3.9 7 1.2 4.8 4.7 4.6Z" />
    </svg>
  );
}
