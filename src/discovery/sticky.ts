import type { FrameNode, TextNode } from "@/doc/schema";
import type { Pt } from "@/doc/geometry";
import { makeFrame, makeText } from "@/doc/factory";
import { uniformRadius } from "@/doc/schema";
import type { StickyColor } from "./types";

/**
 * Sticky notes for the board (FigJam's): a note-coloured auto-layout frame that hugs a text. Plain
 * layers with their own colours, so they look the same in either theme and in exports.
 */

export const STICKY_COLORS: Record<StickyColor, { fill: string; label: string }> = {
  yellow: { fill: "#FFE59A", label: "Yellow" },
  green: { fill: "#BFEBC2", label: "Green" },
  blue: { fill: "#BFE3F7", label: "Blue" },
  pink: { fill: "#FFCBDD", label: "Pink" },
  violet: { fill: "#DCD2FF", label: "Violet" },
  gray: { fill: "#E9E6E2", label: "Gray" },
};

const INK = "#1C1A18";
export const STICKY_W = 200;

/** A sticky (and its text) centred on `at`, ready to type in. */
export function makeSticky(at: Pt, color: StickyColor = "yellow"): { frame: FrameNode; text: TextNode } {
  const frame = makeFrame({
    name: "Sticky",
    x: Math.round(at.x - STICKY_W / 2),
    y: Math.round(at.y - 60),
    w: STICKY_W,
    h: 120,
    minH: 120,
    clip: false,
    fill: { color: STICKY_COLORS[color].fill },
    radius: uniformRadius(4),
    effects: [{ kind: "drop", x: 0, y: 2, blur: 8, spread: 0, color: "#0000001F" }],
    sizeH: "fixed",
    sizeV: "hug",
    layout: { direction: "vertical", wrap: false, gap: 0, crossGap: 0, padding: { top: 16, end: 16, bottom: 16, start: 16 }, justify: "start", align: "start" },
    meta: { source: "user", note: { kind: "sticky", color } },
  });
  const text = makeText({
    name: "Note",
    x: 16,
    y: 16,
    w: STICKY_W - 32,
    h: 22,
    sizeH: "fill",
    fill: { color: INK },
    text: { content: "", fontFamily: "Inter", fontSize: 16, fontWeight: 400, lineHeight: 22, letterSpacing: 0, autoSize: "height", typeToken: undefined },
  });
  text.parentId = frame.id;
  frame.children = [text.id];
  return { frame, text };
}

/** A sticky's colour changed: its fill follows. */
export function stickyFill(color: StickyColor): string {
  return STICKY_COLORS[color].fill;
}

export const SOURCE_NOTE_W = 240;

/**
 * A source on the board (dragged from the Sources tab): a paper-white card with what it is and its
 * title, linked to the source by id (double-click opens it there). Plain layers, like stickies.
 */
export function makeSourceNote(at: Pt, source: { id: string; title: string }, kicker: string): { frame: FrameNode; texts: TextNode[] } {
  const frame = makeFrame({
    name: source.title.slice(0, 80) || "Source",
    x: Math.round(at.x - SOURCE_NOTE_W / 2),
    y: Math.round(at.y - 30),
    w: SOURCE_NOTE_W,
    h: 64,
    clip: false,
    fill: { color: "#FFFFFF" },
    stroke: { color: "#DDD8D1", width: 1 },
    radius: uniformRadius(8),
    effects: [{ kind: "drop", x: 0, y: 1, blur: 4, spread: 0, color: "#0000001A" }],
    sizeH: "fixed",
    sizeV: "hug",
    layout: { direction: "vertical", wrap: false, gap: 4, crossGap: 0, padding: { top: 12, end: 14, bottom: 12, start: 14 }, justify: "start", align: "start" },
    meta: { source: "user", note: { kind: "source", sourceId: source.id } },
  });
  const line = (content: string, size: number, weight: number, lh: number, color: string, maxLines?: number) => {
    const t = makeText({
      name: content.slice(0, 32),
      w: SOURCE_NOTE_W - 28,
      h: lh,
      sizeH: "fill",
      fill: { color },
      text: { content, fontFamily: "Inter", fontSize: size, fontWeight: weight, lineHeight: lh, letterSpacing: 0, autoSize: "height", typeToken: undefined, ...(maxLines ? { maxLines } : {}) },
    });
    t.parentId = frame.id;
    return t;
  };
  const texts = [line(kicker.toUpperCase(), 10.5, 600, 14, "#77706A"), line(source.title || "Source", 14, 600, 20, INK, 3)];
  frame.children = texts.map((t) => t.id);
  return { frame, texts };
}
