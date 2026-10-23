import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import clsx from "clsx";
import { CircleAlert, TriangleAlert, Wand2 } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { isOnPage } from "@/doc/pages";
import { topFrameOf, worldBounds } from "@/doc/geometry";
import { applyFix, auditNode, lintNodes, type Finding } from "@/lint/rules";
import { Button } from "./controls";
import { usePresence } from "./motion";
import { r } from "./recipes";

/**
 * The linter's marks on the canvas explain themselves: hover one to read what's wrong with that
 * layer (and fix it, when the linter knows how). The marks are drawn by the renderer at each
 * flagged node's top-right corner (renderer.ts drawOverlay); this layer only hit-tests them. The
 * card pops out of the mark and fades away (100ms) after a short grace when the pointer leaves.
 */

interface Dot {
  id: string;
  x: number;
  y: number;
}

const HIT = 9;
const CARD_W = 290;

export default function FlagTips({ vp, host }: { vp: { w: number; h: number }; host: HTMLElement | null }) {
  const doc = useStudio((s) => s.doc);
  const cam = useStudio((s) => s.camera);
  const [open, setOpen] = useState<Dot | null>(null);
  const overCard = useRef(false);
  const hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Where the renderer puts each mark, in canvas px.
  const dots = useMemo(() => {
    const out: Dot[] = [];
    for (const id in doc.nodes) {
      const n = doc.nodes[id];
      if (!n.meta.flags?.length || !n.visible || !isOnPage(doc, id)) continue;
      const b = worldBounds(doc, id);
      const x = (b.x + b.w - cam.x) * cam.zoom - 1;
      const y = (b.y - cam.y) * cam.zoom + 1;
      if (x < -HIT || y < -HIT || x > vp.w + HIT || y > vp.h + HIT) continue;
      out.push({ id, x, y });
    }
    return out;
  }, [doc, cam, vp.w, vp.h]);

  const dotsRef = useRef(dots);
  dotsRef.current = dots;

  useEffect(() => {
    if (!host) return;
    const canvas = host.querySelector("canvas");
    if (!canvas) return;
    const onMove = (e: PointerEvent) => {
      if (e.target !== canvas || e.buttons) return;
      const rect = host.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      let best: Dot | null = null;
      let bestD = HIT * HIT;
      for (const d of dotsRef.current) {
        const dd = (d.x - px) ** 2 + (d.y - py) ** 2;
        if (dd <= bestD) {
          best = d;
          bestD = dd;
        }
      }
      if (best) {
        clearTimeout(hide.current);
        canvas.style.cursor = "help";
        setOpen((cur) => (cur?.id === best!.id ? cur : best));
      } else if (!overCard.current) {
        clearTimeout(hide.current);
        hide.current = setTimeout(() => !overCard.current && setOpen(null), 160);
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [host]);

  // Close when the layer loses its flags (fixed) or goes away.
  const node = open ? doc.nodes[open.id] : undefined;
  const present = !!open && !!node?.meta.flags?.length;
  useEffect(() => {
    if (open && !present) setOpen(null);
  }, [open, present]);

  // The last card shown stays put while it fades out.
  const last = useRef<Dot | null>(null);
  if (present) last.current = open;
  const { mounted, state, ref } = usePresence<HTMLDivElement>(present);
  const shown = last.current;
  if (!mounted || !shown || !doc.nodes[shown.id]) return null;

  // Follow the mark as the camera moves.
  const dot = dots.find((d) => d.id === shown.id) ?? shown;
  const left = Math.min(Math.max(8, dot.x + 12), vp.w - CARD_W - 8);
  const top = Math.min(Math.max(8, dot.y + 10), vp.h - 160);
  return (
    <FlagCard
      key={shown.id}
      id={shown.id}
      cardRef={ref}
      state={state}
      style={{ left, top, width: CARD_W, "--radix-popper-transform-origin": `${Math.round(dot.x - left)}px ${Math.round(dot.y - top)}px` } as CSSProperties}
      onEnter={() => {
        overCard.current = true;
        clearTimeout(hide.current);
      }}
      onLeave={() => {
        overCard.current = false;
        setOpen(null);
      }}
    />
  );
}

function FlagCard({
  id,
  style,
  state,
  cardRef,
  onEnter,
  onLeave,
}: {
  id: string;
  style: CSSProperties;
  state: "open" | "closed";
  cardRef: (el: HTMLDivElement | null) => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const doc = useStudio((s) => s.doc);
  const n = doc.nodes[id];
  const flags = n?.meta.flags ?? [];
  // The linter's findings for this layer carry the fixes it knows.
  const fixes = useMemo(() => (n ? auditNode(doc, n).filter((f): f is Finding & { fix: NonNullable<Finding["fix"]> } => !!f.fix) : []), [doc, n]);
  if (!n) return null;
  const fixFor = (rule: string, message: string) => fixes.find((f) => f.rule === rule && f.message === message) ?? fixes.find((f) => f.rule === rule);
  return (
    <div
      ref={cardRef}
      role="tooltip"
      data-state={state}
      className={clsx(r.card, "q-pop absolute z-[2] flex flex-col gap-[10px] p-[12px] text-caption", state === "open" ? "pointer-events-auto" : "pointer-events-none")}
      style={style}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="-my-[2px] truncate rounded-sm text-left font-semibold text-fg underline decoration-transparent underline-offset-2 hover:decoration-fg/40"
        title="Select this layer"
        onClick={() => studio().select([id])}
        onMouseEnter={() => studio().setHover(id)}
        onMouseLeave={() => studio().setHover(null)}
      >
        {n.name}
        {n.meta.component && n.meta.component !== n.name && <span className="font-normal text-fg-subtle"> · {n.meta.component}</span>}
      </button>
      {flags.map((f, i) => {
        const fix = fixFor(f.rule, f.message);
        const error = f.severity === "error";
        const Icon = error ? CircleAlert : TriangleAlert;
        return (
          <div key={i} className="flex gap-[8px]">
            <Icon size={14} absoluteStrokeWidth strokeWidth={1.25} aria-label={error ? "Error" : "Warning"} className={clsx("mt-[1px] shrink-0", error ? "text-danger" : "text-lint-warning")} />
            <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
              <p className="text-fg-muted">{f.message}</p>
              <div className="flex min-h-[24px] items-center gap-[8px]">
                <span className="min-w-0 truncate text-micro text-fg-subtle">{f.rule}</span>
                {fix && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ml-auto"
                    onClick={() => {
                      applyFix(fix);
                      lintNodes([topFrameOf(studio().doc, id)]);
                    }}
                  >
                    <Wand2 size={12} absoluteStrokeWidth strokeWidth={1.25} /> {fix.fix.label}
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
