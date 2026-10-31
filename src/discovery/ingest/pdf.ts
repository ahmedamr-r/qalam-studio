import type { TextBlock } from "../sources";
import { cleanText } from "./text";

/*
 * A PDF's text, from pdf.js (the browser's build in a worker, or Node's legacy build in the core),
 * read the way a PDF-to-Markdown converter reads one, by code and with no tokens: its lines by their
 * size and place on the page, headings by being set larger than the body, list items by their
 * bullet or number, and a paragraph's wrapped lines joined back into one. The words stay as they
 * are; the shape is kept beside them (`blocks`) for the reader to draw. Pages are kept: each page's
 * text in order, and where each starts, so a quote can say which page it's on. A PDF with no text
 * (a scan) says so: there's no OCR.
 */

type PdfJs = Pick<typeof import("pdfjs-dist"), "getDocument">;

/** A line as it sits on the page: its words, its size, where it starts and its baseline (PDF space: y grows up). */
export interface PdfLine {
  text: string;
  size: number;
  x: number;
  y: number;
  /** How far across the page it reaches. */
  w: number;
}

const BULLET = /^[•◦▪▫‣●○■□–—·*-]\s+/;
const NUMBERED = /^(\d{1,3}|[a-zA-Z])[.)]\s+/;
/** A line this much bigger than the body is a heading. */
const HEADING = 1.15;
/** Lines this far apart (in line heights) start a new paragraph. */
const GAP = 1.75;
/** A line that ran this far across the body's width wrapped; a shorter one ended where it meant to. */
const FULL = 0.75;

type Kind = TextBlock["kind"] | "p";

/** One page's lines as text and shape: blocks a blank line apart, the headings' and list items' spans. */
export function shapeLines(lines: readonly PdfLine[]): { text: string; blocks: TextBlock[] } {
  const shown = lines.map((l) => ({ ...l, text: cleanText(l.text) }));
  // The body's size: the one most of the words are set in.
  const chars = new Map<number, number>();
  for (const l of shown) if (l.text) chars.set(round(l.size), (chars.get(round(l.size)) ?? 0) + l.text.length);
  const body = [...chars].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const heads = [...new Set(shown.filter((l) => l.text && l.text.length <= 140 && body && l.size >= body * HEADING).map((l) => round(l.size)))].sort((a, b) => b - a);
  const level = (l: PdfLine): Kind | null => {
    const i = heads.indexOf(round(l.size));
    return i < 0 ? null : (["h1", "h2", "h3"] as const)[Math.min(i, 2)];
  };
  const width = Math.max(0, ...shown.filter((l) => l.text && round(l.size) === body).map((l) => l.w));

  const blocks: { kind: Kind; text: string; x: number }[] = [];
  let prev: PdfLine | null = null;
  for (const l of shown) {
    if (!l.text) {
      prev = null;
      continue;
    }
    const head = level(l);
    const bullet = BULLET.exec(l.text);
    const kind: Kind = head ?? (bullet || NUMBERED.test(l.text) ? "li" : "p");
    const words = bullet ? l.text.slice(bullet[0].length) : l.text;
    const cur = blocks[blocks.length - 1];
    // Close under the line before (a line's height apart or so), on the same page column.
    const near = !!prev && !!cur && prev.y - l.y > 0 && prev.y - l.y <= Math.max(prev.size, l.size) * GAP;
    const goesOn =
      near &&
      ((cur.kind === "p" && kind === "p") ||
        // A list item's next line, indented under its words (not a new bullet).
        (cur.kind === "li" && kind === "p" && l.x >= cur.x - 2) ||
        (cur.kind === head && head !== null));
    if (goesOn) {
      const wrapped = cur.kind !== "p" || !width || prev!.w >= width * FULL;
      cur.text += cur.text.endsWith("-") && /^[a-z]/.test(words) ? words : `${wrapped ? " " : "\n"}${words}`;
    } else blocks.push({ kind, text: words, x: bullet ? l.x + 8 : l.x });
    prev = l;
  }

  let text = "";
  const out: TextBlock[] = [];
  for (const b of blocks) {
    if (text) text += "\n\n";
    if (b.kind !== "p") out.push({ span: [text.length, text.length + b.text.length], kind: b.kind });
    text += b.text;
  }
  return { text, blocks: out };
}

const round = (n: number) => Math.round(n * 2) / 2;

/** pdf.js's text items as lines: an item's size from its transform, a line ending where pdf.js says it does. */
function linesOf(items: readonly unknown[]): PdfLine[] {
  const out: PdfLine[] = [];
  let cur: PdfLine | null = null;
  for (const raw of items) {
    const item = raw as { str?: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean };
    if (typeof item.str !== "string") continue;
    const t = item.transform ?? [0, 0, 0, 0, 0, 0];
    const size = Math.hypot(t[2], t[3]) || item.height || 0;
    if (item.str) {
      if (!cur) cur = { text: "", size: 0, x: t[4], y: t[5], w: 0 };
      cur.text += item.str;
      if (item.str.trim()) cur.size = Math.max(cur.size, size);
      cur.w = Math.max(cur.w, t[4] + (item.width ?? 0) - cur.x);
    }
    if (item.hasEOL) {
      out.push(cur ?? { text: "", size: 0, x: 0, y: 0, w: 0 });
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export async function pdfText(pdfjs: PdfJs, data: ArrayBuffer): Promise<{ text: string; pages: number[]; blocks: TextBlock[]; title?: string }> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  try {
    const doc = await task.promise;
    const parts: string[] = [];
    const pages: number[] = [];
    const blocks: TextBlock[] = [];
    let at = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const shaped = shapeLines(linesOf(content.items));
      page.cleanup();
      // Pages are separated by a blank line; each records where it starts.
      if (parts.length) at += 2;
      pages.push(at);
      for (const b of shaped.blocks) blocks.push({ ...b, span: [b.span[0] + at, b.span[1] + at] });
      parts.push(shaped.text);
      at += shaped.text.length;
    }
    const text = parts.join("\n\n");
    if (!text.replace(/\s+/g, "").length) throw new Error("This PDF has no text to read (it may be scanned pages). Qalam can't read scans: export it with text, or paste what it says.");
    const meta = await doc.getMetadata().catch(() => null);
    const title = (meta?.info as { Title?: unknown } | undefined)?.Title;
    return { text, pages, blocks, ...(typeof title === "string" && title.trim() ? { title: title.trim() } : {}) };
  } finally {
    void task.destroy();
  }
}
