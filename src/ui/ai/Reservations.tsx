import { Lock } from "lucide-react";
import { useStudio } from "@/doc/store";
import { isOnPage } from "@/doc/pages";
import { worldBounds, type Box } from "@/doc/geometry";
import { useReservations, type ReservedBox } from "@/doc/reservations";
import { useGhosts } from "@/doc/ghosts";
import { APP_PANEL_W, SIDEBAR_W } from "@/design-system/platform";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { r as ui } from "../recipes";
import { toScreenBox } from "./anchor";
import { useRetained } from "./AgentCursors";

interface Vp {
  w: number;
  h: number;
}

/** Placeholders and veils fade out over 200ms when the work ends (they fade in over 150ms). */
const LEAVE_MS = 200;

const offscreen = (b: Box, vp: Vp) => b.x > vp.w || b.y > vp.h || b.x + b.w < 0 || b.y + b.h < -24;

interface Held {
  id: string;
  /** Screen box. */
  s: Box;
  /** A new frame waiting for its screen, with its layout sketched (world box), or a layer being worked on. */
  box?: ReservedBox;
  label: string;
}

/**
 * Space held on the canvas for AI work in progress: empty frames where new screens will land,
 * sketched in their platform's layout, and a veil over layers read or rebuilt in place (critique,
 * extraction, restyle, fixes). Both carry Qalam AI's working ring (1px, nacre, 2px outside the
 * frame) with a reflection sweeping across; a veiled layer dims and shows a lock chip, since it
 * can't be edited until the work ends (see isBusy in reservations.ts). Never takes pointer events.
 */
export default function Reservations({ vp }: { vp: Vp }) {
  const list = useReservations((s) => s.list);
  const ghosts = useGhosts((s) => s.list);
  const doc = useStudio((s) => s.doc);
  const cam = useStudio((s) => s.camera);

  const held: Held[] = [];
  for (const r of list) {
    r.boxes.forEach((b, i) => {
      // The screen is being drawn here already (see progressive.ts): the placeholder steps aside.
      if (ghosts.some((g) => g.reservationId === r.id && g.index === i)) return;
      held.push({ id: `${r.id}-${i}`, s: toScreenBox(b, cam), box: b, label: `${r.label}${r.boxes.length > 1 ? ` · ${i + 1} of ${r.boxes.length}` : ""}` });
    });
    for (const id of r.nodeIds) if (doc.nodes[id] && isOnPage(doc, id)) held.push({ id: `${r.id}-${id}`, s: toScreenBox(worldBounds(doc, id), cam), label: r.label });
  }
  const live = useRetained(held, LEAVE_MS);
  if (!live.length) return null;
  return (
    <>
      {live.map(({ item: h, leaving }) =>
        offscreen(h.s, vp) ? null : h.box ? <Placeholder key={h.id} h={h} box={h.box} zoom={cam.zoom} leaving={leaving} /> : <Veil key={h.id} h={h} leaving={leaving} />,
      )}
    </>
  );
}

const fade = "data-[state=open]:animate-[q-fade-in_var(--dur-fast)_var(--ease-out-quad)_both] data-[state=closed]:animate-[q-fade-out_var(--dur-base)_var(--ease-in-quad)_forwards]";

/** A frame being drafted: the light stage with the platform's layout, its name label, the ring and the sweep. */
function Placeholder({ h, box, zoom, leaving }: { h: Held; box: ReservedBox; zoom: number; leaving: boolean }) {
  const { s } = h;
  return (
    <div data-state={leaving ? "closed" : "open"} className={`absolute ${fade}`} style={{ left: s.x, top: s.y, width: s.w, height: s.h }}>
      <Label text={h.label} width={s.w} />
      <div data-busy className={ui.busyFrame} style={{ inset: 0 }} />
      <div className="absolute inset-0 overflow-hidden bg-stage">
        {box.sketch && (
          <div className="absolute top-0 left-0 origin-top-left" style={{ width: box.w, height: box.h, transform: `scale(${zoom})` }}>
            <Sketch box={box} />
          </div>
        )}
        <div className="ds-sweep absolute inset-0" />
      </div>
    </div>
  );
}

/** A layer Qalam AI is reading or rebuilding: dimmed toward the canvas, the ring, a reflection, and a lock chip. */
function Veil({ h, leaving }: { h: Held; leaving: boolean }) {
  const { s } = h;
  // Small layers carry the chip above them instead of covering them (narrow ones truncate it inside,
  // so it doesn't land on the frame's name label).
  const outside = s.w < 72 || s.h < 48;
  return (
    <div data-state={leaving ? "closed" : "open"} className={`absolute ${fade}`} style={{ left: s.x, top: s.y, width: s.w, height: s.h }}>
      <div data-busy className={ui.busyFrame} style={{ inset: 0 }} />
      <div className="absolute inset-0 overflow-hidden">
        {/* The canvas colour over the layer: it reads as the layer at lower opacity. */}
        <div className="absolute inset-0 bg-canvas/55" />
        <div className="ds-reflect absolute inset-0" />
      </div>
      <span
        className={`absolute left-[8px] flex h-[22px] max-w-[calc(100%-16px)] items-center gap-[6px] rounded-md bg-elevated pr-[8px] pl-[6px] text-caption font-medium whitespace-nowrap shadow-popover ${outside ? "-top-[30px] left-0 max-w-none" : "top-[8px]"}`}
        title="Locked until Qalam AI finishes or you stop it"
      >
        <QalamAIGlyph size={12} />
        <span className="q-shimmer-text min-w-0 truncate">{h.label}…</span>
        <Lock size={12} absoluteStrokeWidth strokeWidth={1.25} className="shrink-0 text-fg-subtle" aria-label="Locked" />
      </span>
    </div>
  );
}

/** Mimics the canvas's frame name label (11px, 18px above the frame, clipped to its width), with the AI glyph and a shimmer. */
function Label({ text, width }: { text: string; width: number }) {
  return (
    <span className="absolute -top-[18px] left-0 flex items-center gap-[4px] overflow-hidden text-micro font-medium whitespace-nowrap text-canvas-label" style={{ maxWidth: Math.max(40, width) }}>
      <QalamAIGlyph size={12} className="shrink-0" />
      <span className="q-shimmer-text truncate">{text}…</span>
    </span>
  );
}

// The sketch is user content on the light stage, so its greys are literal (they stay light in both themes).
const block = "absolute rounded-[6px] bg-[#EEF1EF]";
const band = "absolute bg-[#F5F7F6]";

/** The platform's layout, roughly, in world px: what's coming, before it arrives. */
function Sketch({ box }: { box: ReservedBox }) {
  const { w, h } = box;
  if (box.sketch === "mobile")
    return (
      <>
        <div className={block} style={{ left: 16, top: 60, width: w - 32, height: 40 }} />
        <div className={block} style={{ left: 16, top: 124, width: w * 0.55, height: 28 }} />
        <div className={block} style={{ left: 16, top: 168, width: w - 32, height: 180, borderRadius: 16 }} />
        <div className={block} style={{ left: 16, top: 368, width: w - 32, height: 72, borderRadius: 16 }} />
        <div className={block} style={{ left: 16, top: 456, width: w - 32, height: 72, borderRadius: 16 }} />
        <div className={block} style={{ left: 16, top: h - 96, width: w - 32, height: 52, borderRadius: 999 }} />
      </>
    );
  if (box.sketch === "web")
    return (
      <>
        <div className={block} style={{ left: 120, top: 24, width: 140, height: 24 }} />
        <div className={block} style={{ left: w / 2 - 180, top: 28, width: 360, height: 16 }} />
        <div className={block} style={{ left: w - 280, top: 18, width: 160, height: 36, borderRadius: 999 }} />
        <div className={block} style={{ left: 120, top: 150, width: 560, height: 56 }} />
        <div className={block} style={{ left: 120, top: 222, width: 460, height: 56 }} />
        <div className={block} style={{ left: 120, top: 310, width: 500, height: 20 }} />
        <div className={block} style={{ left: 120, top: 380, width: 180, height: 48, borderRadius: 999 }} />
        <div className={block} style={{ left: w / 2 + 40, top: 130, width: w / 2 - 160, height: 340, borderRadius: 20 }} />
        {[0, 1, 2].map((i) => (
          <div key={i} className={block} style={{ left: 120 + i * 408, top: 560, width: 384, height: 220, borderRadius: 16 }} />
        ))}
      </>
    );
  if (box.sketch === "app")
    return (
      <>
        <div className={`${band} top-0 left-0`} style={{ width: w, height: 56 }} />
        <div className={block} style={{ left: 16, top: 16, width: 160, height: 24 }} />
        <div className={block} style={{ left: w / 2 - 90, top: 12, width: 180, height: 32, borderRadius: 999 }} />
        <div className={block} style={{ left: w - 196, top: 12, width: 180, height: 32, borderRadius: 999 }} />
        <div className={`${band} left-0`} style={{ top: 56, width: APP_PANEL_W, height: h - 56 - 260 }} />
        {[0, 1, 2].map((i) => (
          <div key={i} className="contents">
            <div className={block} style={{ left: 16, top: 120 + i * 92, width: (APP_PANEL_W - 40) / 2, height: 80 }} />
            <div className={block} style={{ left: 24 + (APP_PANEL_W - 40) / 2, top: 120 + i * 92, width: (APP_PANEL_W - 40) / 2, height: 80 }} />
          </div>
        ))}
        <div className={block} style={{ left: APP_PANEL_W + 16, top: 72, width: w - APP_PANEL_W - 348, height: h - 56 - 260 - 72, borderRadius: 16 }} />
        <div className={block} style={{ left: w - 316, top: 72, width: 300, height: h - 56 - 260 - 32, borderRadius: 16 }} />
        <div className={`${band} left-0`} style={{ top: h - 260, width: w, height: 260 }} />
        {[0, 1, 2].map((i) => (
          <div key={i} className={block} style={{ left: 136, top: h - 212 + i * 60, width: w - 152 - i * 180, height: 44 }} />
        ))}
      </>
    );
  const main = SIDEBAR_W + 32;
  const col = (w - main - 32 - 24 * 3) / 4;
  return (
    <>
      <div className={`${band} top-0 left-0`} style={{ width: SIDEBAR_W, height: h }} />
      <div className={block} style={{ left: 16, top: 24, width: 140, height: 24 }} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className={block} style={{ left: 16, top: 80 + i * 48, width: SIDEBAR_W - 32, height: 36 }} />
      ))}
      <div className={block} style={{ left: main, top: 22, width: 240, height: 28 }} />
      <div className={block} style={{ left: w - 32 - 320, top: 18, width: 320, height: 36, borderRadius: 999 }} />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={block} style={{ left: main + i * (col + 24), top: 96, width: col, height: 120, borderRadius: 16 }} />
      ))}
      <div className={block} style={{ left: main, top: 240, width: col * 2.5 + 36, height: 340, borderRadius: 16 }} />
      <div className={block} style={{ left: main + col * 2.5 + 60, top: 240, width: w - 32 - (main + col * 2.5 + 60), height: 340, borderRadius: 16 }} />
      <div className={block} style={{ left: main, top: 604, width: w - main - 32, height: 280, borderRadius: 16 }} />
    </>
  );
}
