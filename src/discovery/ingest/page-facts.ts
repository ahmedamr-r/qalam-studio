/*
 * Where a PDF page's pictures and drawn paths land, from pdf.js's drawing commands, with no tokens
 * (pure). src/discovery/ingest/pictures.ts decides what to do with it.
 */

export const PICTURE_LIMITS = {
  /** Under this many characters of text, a page full of picture is a scan. */
  scanChars: 40,
  scanShare: 0.6,
  scanPaths: 30,
  /** A scanned line this much taller than the body is a heading. */
  scanHeading: 1.4,
  /** A picture smaller than this share of the page is a logo or an icon. */
  smallPicture: 0.015,
  pictureShare: 0.1,
  /** A drawn figure: this many paths, over this share of the page, with this many numbers in it. */
  paths: 3,
  pathsBox: 0.08,
  drawnNumbers: 3,
  /** A path over this share of the page is a background. */
  background: 0.5,
  /** A picture worth asking about prints this many new words, or any new number. */
  freshWords: 3,
  /** Pages drawn and read on this Mac per document (a second or two each, no tokens). */
  readPages: 60,
  /** Pages Qalam AI is sent per document, and per call. A page of figures came to about 4.8k tokens in and 2k out (a 66-page report, $0.94 on Opus). */
  modelPages: 12,
  perCall: 4,
  /** How many calls run at once, and how many pages are read closer at once. */
  callsAtOnce: 3,
  closerAtOnce: 4,
  /** The longer side a page is drawn at for reading, and sent at. */
  readSide: 2200,
  sendSide: 1568,
  /** The most pictures on a page read on their own, and the bands a scan is read in. */
  regions: 4,
  bands: [0, 0.25, 0.5],
  bandHeight: 0.5,
  /** How sure the reading has to be for a line to back a number. */
  minConf: 0.5,
  /** The most words of a page a call is sent. */
  words: 6000,
  title: 160,
  rowTitle: 70,
  rowsPerFigure: 60,
  figuresPerPage: 6,
  left: 40,
} as const;

export type Box = [number, number, number, number];

/** One page, as its drawing commands say (no tokens). A share is of the page's area; a box is 0..1 from the top left. */
export interface PageFacts {
  page: number;
  /** Its text's characters, spaces left out. */
  chars: number;
  pictures: number;
  /** Where its pictures are, the largest first. */
  pictureBoxes: Box[];
  /** Painted paths that aren't a background, and the box around them. */
  drawn: number;
  drawnBox: Box | null;
}

type Matrix = [number, number, number, number, number, number];

const times = (m: Matrix, n: readonly number[]): Matrix => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

/** A box in a space as it lands on the page, as a share of the page's size, cut to the page. */
function placed(m: Matrix, x0: number, y0: number, x1: number, y1: number, w: number, h: number): Box | null {
  const xs = [x0, x1, x0, x1].map((x, i) => (m[0] * x + m[2] * (i < 2 ? y0 : y1) + m[4]) / w);
  const ys = [x0, x1, x0, x1].map((x, i) => (m[1] * x + m[3] * (i < 2 ? y0 : y1) + m[5]) / h);
  const [a, b] = [Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys))];
  const [c, d] = [Math.min(1, Math.max(...xs)), Math.min(1, Math.max(...ys))];
  return c >= a && d >= b && (c > a || d > b) ? [a, b, c - a, d - b] : null;
}

/** How many separate paths a constructPath's data holds (0 moveTo, 1 lineTo, 2 curveTo, 3 quadratic, 4 close). */
function pathsIn(data: unknown): number {
  const d = data as ArrayLike<number> | null | undefined;
  if (!d?.length) return 0;
  let n = 0;
  for (let i = 0; i < d.length; ) {
    const op = d[i];
    if (op === 0) n++;
    i += op === 2 ? 7 : op === 3 ? 5 : op === 4 ? 1 : 3;
  }
  // A rectangle pdf.js stored without its own moveTo still paints something.
  return n || 1;
}

/**
 * A page's pictures and drawn paths from pdf.js's operator list: where each lands, following the
 * current transform as a canvas would. `base` is the viewport's transform (it takes the page's
 * rotation into account), with the size it draws at.
 */
export function pageFacts(list: { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }, OPS: Record<string, number>, view: { transform: readonly number[]; width: number; height: number }): Pick<PageFacts, "pictures" | "pictureBoxes" | "drawn" | "drawnBox"> {
  const { width: w, height: h } = view;
  const images = new Set(["paintImageXObject", "paintInlineImageXObject", "paintImageMaskXObject", "paintImageXObjectRepeat", "paintImageMaskXObjectRepeat", "paintSolidColorImageMask"].map((k) => OPS[k]).filter((x) => x !== undefined));
  let m = [...view.transform] as Matrix;
  const stack: Matrix[] = [];
  let pictures = 0;
  const pictureBoxes: Box[] = [];
  let drawn = 0;
  let box: [number, number, number, number] | null = null;
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as unknown[] | null;
    if (fn === OPS.save) stack.push(m);
    else if (fn === OPS.restore) m = stack.pop() ?? m;
    else if (fn === OPS.transform && args) m = times(m, args as number[]);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(m);
      if (Array.isArray(args?.[0]) || ArrayBuffer.isView(args?.[0])) m = times(m, args![0] as number[]);
    } else if (fn === OPS.paintFormXObjectEnd) m = stack.pop() ?? m;
    else if (images.has(fn)) {
      const b = placed(m, 0, 0, 1, 1, w, h);
      const share = b ? b[2] * b[3] : 0;
      if (b && share >= PICTURE_LIMITS.smallPicture) {
        pictures = Math.min(1, pictures + share);
        pictureBoxes.push(b);
      }
    } else if (fn === OPS.constructPath && args) {
      // Painted only: a clip ends in endPath.
      if (args[0] === OPS.endPath) continue;
      const mm = args[2] as ArrayLike<number> | null;
      const b = mm && mm.length >= 4 ? placed(m, mm[0], mm[1], mm[2], mm[3], w, h) : null;
      if (!b || b[2] * b[3] > PICTURE_LIMITS.background) continue;
      drawn += pathsIn((args[1] as ArrayLike<unknown> | null)?.[0]);
      box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[0] + b[2]), Math.max(box[3], b[1] + b[3])] : [b[0], b[1], b[0] + b[2], b[1] + b[3]];
    }
  }
  pictureBoxes.sort((a, b) => b[2] * b[3] - a[2] * a[3]);
  return { pictures, pictureBoxes, drawn, drawnBox: box ? [box[0], box[1], box[2] - box[0], box[3] - box[1]] : null };
}
