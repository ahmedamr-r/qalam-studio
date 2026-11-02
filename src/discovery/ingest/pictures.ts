import type { ShotLine, ShotRead } from "@/seen/shot";
import { onScreen } from "@/seen/words";
import { normalizeForMatch } from "../quotes";
import type { PictureLeft, SourcePicture, SourcePictures, TextBlock } from "../sources";
import { PICTURE_LIMITS, type Box, type PageFacts } from "./page-facts";
import { shapeLines, type PdfLine } from "./pdf";

export { PICTURE_LIMITS, type Box, type PageFacts } from "./page-facts";

/*
 * What's inside a PDF's pictures (pure; server/pictures.ts runs it). Which pages hold pictures, from
 * pdf.js's drawing commands with no tokens. What each prints, as this Mac read it off the page: that
 * is what code checks against. Qalam AI sees the page and its printed words, and says which label
 * goes with which number; code keeps a row only where its words and numbers are printed on that page
 * (never a number read off a bar's height, or one only on a chart's scale), and says what it left
 * out. What's kept joins the source as text at the end of its page, in the page's own words, so
 * quotes are found in it word for word like anywhere else. What code can't check is the pairing, so
 * a reader shows the page beside it.
 */

export type PickWhy = "scan" | "picture" | "drawn";

/** Whether a page holds something its text doesn't say: a scan, a picture, or a figure drawn in paths. */
export function pickPage(f: PageFacts): PickWhy | null {
  const L = PICTURE_LIMITS;
  const sparse = f.chars < L.scanChars;
  // Text set as outlines is a scan too: lots of paths and no text.
  if (sparse && (f.pictures >= L.scanShare || f.drawn >= L.scanPaths)) return "scan";
  if (f.pictures >= L.pictureShare) return "picture";
  if (f.drawn >= L.paths && f.drawnBox && f.drawnBox[2] * f.drawnBox[3] >= L.pathsBox) return "drawn";
  return null;
}

// ---------------------------------------------------------------------------
// What a page prints

/** A picked page as this Mac read it: its lines sure enough to back a number, and its text. */
export interface Printed {
  /** The page in the document, from 1. */
  page: number;
  why: PickWhy;
  w: number;
  h: number;
  lines: ShotLine[];
  /** The words of the page's text, as pdf.js read them. */
  layer: string;
  drawnBox: Box | null;
}

export function printedOf(f: PageFacts, why: PickWhy, read: Pick<ShotRead, "w" | "h" | "lines">, layer: string, regions: readonly (readonly ShotLine[])[] = []): Printed {
  const sure = (l: ShotLine) => l.conf >= PICTURE_LIMITS.minConf && !!l.text.trim();
  return { page: f.page, why, w: read.w, h: read.h, lines: mergeLines(read.lines.filter(sure), regions.map((r) => r.filter(sure))), layer, drawnBox: f.drawnBox };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Which parts of a page to read again on their own. Read at once, a page often loses a chart's small
 * labels (a bar reads as a giant letter and takes the label beside it). Its own box finds them.
 * A picture's box, or the drawing's; a scan has no boxes inside it, so overlapping bands of it.
 */
export function regionsOf(f: Pick<PageFacts, "pictureBoxes" | "drawnBox">, why: PickWhy): Box[] {
  const pad = (b: Box): Box => {
    const [x, y] = [clamp01(b[0] - 0.01), clamp01(b[1] - 0.01)];
    return [x, y, clamp01(b[0] + b[2] + 0.01) - x, clamp01(b[1] + b[3] + 0.01) - y];
  };
  if (why === "scan") return PICTURE_LIMITS.bands.map((y) => [0, y, 1, PICTURE_LIMITS.bandHeight] as Box);
  if (why === "drawn") return f.drawnBox ? [pad(f.drawnBox)] : [];
  return f.pictureBoxes.slice(0, PICTURE_LIMITS.regions).map(pad);
}

const overlapOfSmaller = (a: Box, b: Box) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w <= 0 || h <= 0 ? 0 : (w * h) / Math.max(1e-9, Math.min(a[2] * a[3], b[2] * b[3]));
};

/** A page's lines with what its regions found besides: a line goes in only where nothing was read yet, so a cut or a second reading never doubles one. In reading order. */
export function mergeLines(page: readonly ShotLine[], regions: readonly (readonly ShotLine[])[]): ShotLine[] {
  const all = [...page];
  for (const r of regions) for (const l of r) if (!all.some((x) => overlapOfSmaller(x.box, l.box) >= 0.3)) all.push(l);
  if (all.length === page.length) return all;
  // Top to bottom; lines whose middles sit within half a line of a row's are that row, left to right.
  const mid = (l: ShotLine) => l.box[1] + l.box[3] / 2;
  const rows: ShotLine[][] = [];
  for (const l of [...all].sort((a, b) => mid(a) - mid(b))) {
    const first = rows[rows.length - 1]?.[0];
    if (first && Math.abs(mid(l) - mid(first)) < Math.min(l.box[3], first.box[3]) / 2) rows[rows.length - 1].push(l);
    else rows.push([l]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.box[0] - b.box[0]));
}

const folded = (s: string) => normalizeForMatch(s).norm.replace(/٫/g, ".").replace(/٬/g, ",").replace(/٪/g, "%");

const wordsOf = (s: string) => folded(s).match(/[\p{L}\p{N}][\p{L}\p{N}.,'%-]*[\p{L}\p{N}%]|[\p{L}\p{N}]/gu) ?? [];

/** The numbers in a text as they're written: "4.1" and "1,240", never the 4 in 4.1. */
export const numbersIn = (s: string) => folded(s).match(/\d+(?:[.,]\d+)*/g) ?? [];

/** The lines that say something the page's text doesn't. */
export function freshLines(p: Pick<Printed, "lines" | "layer">): ShotLine[] {
  const known = new Set(wordsOf(p.layer));
  return p.lines.filter((l) => wordsOf(l.text).some((w) => !known.has(w)));
}

const SHORT_WITH_NUMBER = 3;

/** Whether a scanned page holds rows of numbers (a table or a chart), not only prose: its short lines with a number in them. */
export function holdsFigures(lines: readonly ShotLine[]): boolean {
  return lines.filter((l) => numbersIn(l.text).length && wordsOf(l.text).length <= 4).length >= SHORT_WITH_NUMBER;
}

/** Whether a page is worth a call, and how much (the numbers it would add). A photo, or a slide's background behind its text, costs nothing. */
export function worthReading(p: Printed): number {
  const L = PICTURE_LIMITS;
  if (p.why === "scan") return holdsFigures(p.lines) ? numbersIn(p.lines.map((l) => l.text).join("\n")).length + 1 : 0;
  if (p.why === "picture") {
    const fresh = freshLines(p);
    const words = fresh.flatMap((l) => wordsOf(l.text));
    const numbers = fresh.flatMap((l) => numbersIn(l.text)).length;
    return words.length >= L.freshWords || numbers ? numbers + 1 : 0;
  }
  const b = p.drawnBox;
  if (!b) return 0;
  const inside = p.lines.filter((l) => l.box[0] + l.box[2] / 2 >= b[0] && l.box[0] + l.box[2] / 2 <= b[0] + b[2] && l.box[1] + l.box[3] / 2 >= b[1] && l.box[1] + l.box[3] / 2 <= b[1] + b[3]);
  const numbers = inside.flatMap((l) => numbersIn(l.text)).length;
  return numbers >= L.drawnNumbers ? numbers : 0;
}

/** The pages to send, within the limit: those adding the most numbers, in the document's order. The rest stay as their printed words. */
export function pagesToSend(pages: readonly Printed[]): { send: Printed[]; over: Printed[] } {
  const worth = pages.map((p) => ({ p, n: worthReading(p) })).filter((x) => x.n > 0);
  const send = new Set([...worth].sort((a, b) => b.n - a.n || a.p.page - b.p.page).slice(0, PICTURE_LIMITS.modelPages).map((x) => x.p));
  return { send: pages.filter((p) => send.has(p)), over: worth.filter((x) => !send.has(x.p)).map((x) => x.p) };
}

const FIGURE_ONLY = /^[\s(]*[-+$€£]?\s*\d[\d.,]*\s*(%|k|m|bn|\$|€|£)?[\s)]*$/i;
const NEAR = 0.015;

/** Whether values run evenly, up or down, at evenly spaced places. */
function evenly(points: readonly { at: number; value: number }[]): boolean {
  if (points.length < 3) return false;
  const sorted = [...points].sort((a, b) => a.at - b.at);
  const gaps = sorted.slice(1).map((p, i) => p.at - sorted[i].at);
  const steps = sorted.slice(1).map((p, i) => p.value - sorted[i].value);
  const gap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const step = steps.reduce((a, b) => a + b, 0) / steps.length;
  if (!gap || !step) return false;
  return gaps.every((g) => Math.abs(g - gap) <= gap * 0.2) && steps.every((s) => Math.abs(s - step) <= Math.abs(step) * 0.01);
}

const valueOf = (s: string) => Number(numbersIn(s)[0]?.replace(/,/g, ""));

/**
 * The numbers on a chart's scale, by how many times each is printed there: three or more plain
 * numbers lined up, evenly spaced, whose values run evenly. They say where the axis is, not what a
 * bar is, so a bar whose height happens to land on one hasn't got that number printed for it.
 */
export function scaleTicks(lines: readonly ShotLine[]): Map<string, number> {
  const out = new Map<string, number>();
  const count = (tokens: readonly string[]) => {
    for (const t of tokens) out.set(t, (out.get(t) ?? 0) + 1);
  };
  // A scale read as one line: "0 10 20 30".
  for (const l of lines) {
    const parts = l.text.trim().split(/\s+/);
    if (parts.length >= 3 && parts.every((p) => FIGURE_ONLY.test(p)) && evenly(parts.map((p, i) => ({ at: i, value: valueOf(p) })))) count(parts.flatMap(numbersIn));
  }
  const plain = lines.filter((l) => FIGURE_ONLY.test(l.text) && numbersIn(l.text).length === 1);
  const taken = new Set<ShotLine>();
  const groupsBy = (key: (l: ShotLine) => number, at: (l: ShotLine) => number) => {
    for (const a of plain) {
      if (taken.has(a)) continue;
      const group = plain.filter((b) => !taken.has(b) && Math.abs(key(a) - key(b)) <= NEAR);
      if (evenly(group.map((l) => ({ at: at(l), value: valueOf(l.text) })))) {
        for (const l of group) taken.add(l);
        count(group.flatMap((l) => numbersIn(l.text)));
      }
    }
  };
  const mid = (a: number, b: number) => a + b / 2;
  // A scale down the side lines up on its right edge (or its left), one along the bottom on its middle.
  groupsBy((l) => l.box[0] + l.box[2], (l) => mid(l.box[1], l.box[3]));
  groupsBy((l) => l.box[0], (l) => mid(l.box[1], l.box[3]));
  groupsBy((l) => mid(l.box[1], l.box[3]), (l) => mid(l.box[0], l.box[2]));
  return out;
}

/** How many times each number is printed on the page: in its reading or in its text, not both over. */
function printedCounts(p: Pick<Printed, "lines" | "layer">): Map<string, number> {
  const tally = (list: readonly string[]) => {
    const m = new Map<string, number>();
    for (const t of list) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  };
  const read = tally(p.lines.flatMap((l) => numbersIn(l.text)));
  const layer = tally(numbersIn(p.layer));
  return new Map([...read, ...layer].map(([k]) => [k, Math.max(read.get(k) ?? 0, layer.get(k) ?? 0)]));
}

// ---------------------------------------------------------------------------
// What the call said, as code keeps it

export type FigureKind = "chart" | "table" | "figure";

export interface KeptFigure {
  kind: FigureKind;
  title: string;
  /** One line each, with the figure's title so it means the same on its own: "Monthly churn · Jan · 4.1%". */
  rows: string[];
}

/** One page's reading as code keeps it. */
export interface PageReading {
  figures: KeptFigure[];
  left: PictureLeft[];
  /** Lines of the picture no row took: read in their own words. */
  rest: string[];
}

const compact = (s: string) => folded(s).replace(/\s+/g, "");

const hayOf = (p: Pick<Printed, "lines" | "layer">) => ({ w: 1, h: 1, dhash: "", lines: [...p.lines, ...(p.layer ? [{ text: p.layer, box: [0, 0, 1, 1] as Box, conf: 1 }] : [])] });

/** The page's own words for `words` when they're printed on it, else null. Set as written where the page has them so ("Plan", not an earlier "plan"). */
function printedWords(words: unknown, p: Pick<Printed, "lines" | "layer">, max: number = PICTURE_LIMITS.title): string | null {
  const hay = hayOf(p);
  const own = onScreen(words, hay, max);
  if (!own) return null;
  const as = (words as string).trim();
  return hay.lines.some((l) => l.text.includes(as)) ? as : own;
}

/** A number's own words when it's printed: spaced either way ("4.1 %"), whole, and on the page. */
function printedNumber(value: string, p: Pick<Printed, "lines" | "layer">): string | null {
  const own = printedWords(value, p, 40);
  if (own) return own;
  const c = compact(value);
  return hayOf(p).lines.some((l) => compact(l.text).includes(c)) ? value.trim() : null;
}

const cellsOf = (raw: unknown): { name: string; value: string }[] => (Array.isArray(raw) ? raw : []).flatMap((c) => {
  const x = c as { name?: unknown; value?: unknown } | null;
  return typeof x?.value === "string" && x.value.trim() ? [{ name: typeof x.name === "string" ? x.name.trim() : "", value: x.value.trim() }] : [];
});

const cellLine = (name: string | null, value: string) => (name ? `${name}: ${value}` : value);

/**
 * One page's figures as code keeps them. A number stays only where it's printed on this page, not
 * more often than it's printed, and not only on a scale; a label only where it's printed. A row the
 * call says it read from a shape never stays. What goes is listed, with why.
 */
export function sanitizeFigures(raw: unknown, p: Printed, fresh: readonly ShotLine[] = freshLines(p)): PageReading {
  const L = PICTURE_LIMITS;
  const left: PictureLeft[] = [];
  const counts = printedCounts(p);
  const ticks = scaleTicks(p.lines);
  // What each number may still be used for: what's printed, less what's only on a scale.
  const budget = new Map([...counts].map(([k, n]) => [k, n - (ticks.get(k) ?? 0)]));
  const leave = (words: string, why: PictureLeft["why"]) => {
    if (left.length < L.left && words.trim()) left.push({ words: words.trim().slice(0, 200), why });
  };
  const figures: KeptFigure[] = [];
  const list = (raw as { figures?: unknown } | null)?.figures;
  for (const f of (Array.isArray(list) ? list : []).slice(0, L.figuresPerPage)) {
    const fig = (f ?? {}) as { kind?: unknown; title?: unknown; rows?: unknown };
    const kind: FigureKind = fig.kind === "chart" || fig.kind === "table" ? fig.kind : "figure";
    const title = (printedWords(fig.title, p) ?? "").replace(/\s*[:：]\s*$/, "");
    const rows: string[] = [];
    for (const r of (Array.isArray(fig.rows) ? fig.rows : []).slice(0, L.rowsPerFigure)) {
      const row = (r ?? {}) as { labels?: unknown; numbers?: unknown; from_shape?: unknown };
      const labels = cellsOf(row.labels);
      const numbers = cellsOf(row.numbers);
      const said = [...labels, ...numbers].map((c) => cellLine(c.name || null, c.value)).join(" · ");
      if (row.from_shape === true) {
        leave(said, "shape");
        continue;
      }
      // A label that isn't printed changes what the row means: the row goes.
      const shown = labels.map((c) => ({ value: printedWords(c.value, p), name: c.name ? printedWords(c.name, p) : null }));
      if (shown.some((c) => !c.value)) {
        leave(said, "not-printed");
        continue;
      }
      const cells = shown.map((c) => cellLine(c.name, c.value!));
      let named = false;
      let kept = 0;
      for (const n of numbers) {
        const tokens = numbersIn(n.value);
        const own = tokens.length ? printedNumber(n.value, p) : null;
        const word = own && !tokens.some((t) => (counts.get(t) ?? 0) <= 0) ? own : null;
        if (!word) {
          leave(cellLine(n.name || null, n.value), "not-printed");
          continue;
        }
        const out = tokens.find((t) => (budget.get(t) ?? 0) <= 0);
        if (out) {
          leave(cellLine(n.name || null, n.value), (ticks.get(out) ?? 0) >= (counts.get(out) ?? 0) ? "scale" : "twice");
          continue;
        }
        for (const t of tokens) budget.set(t, (budget.get(t) ?? 0) - 1);
        const name = n.name ? printedWords(n.name, p) : null;
        named ||= !!name;
        cells.push(cellLine(name, word));
        kept++;
      }
      // A number on its own says nothing; so does a label whose numbers all went.
      if (numbers.length ? kept > 0 && (labels.length > 0 || named) : labels.length >= 2) rows.push([...(title ? [title] : []), ...cells].join(" · "));
    }
    if (rows.length) figures.push({ kind, title, rows });
  }
  const usedWords = new Set(figures.flatMap((f) => [f.title, ...f.rows]).flatMap(wordsOf));
  const rest = fresh.filter((l) => wordsOf(l.text).length >= 3 && wordsOf(l.text).some((w) => !usedWords.has(w))).map((l) => l.text.trim());
  return { figures, left, rest };
}

// ---------------------------------------------------------------------------
// Joining what's kept to the source

/** A scanned page's lines as text and shape, as a page's own lines are (`shapeLines`). */
export function scanText(read: Pick<Printed, "lines" | "w" | "h">): { text: string; blocks: TextBlock[] } {
  // A line's box is only as tall as its letters: a body line with no tall ones isn't another size, so only a clearly larger line stands apart.
  const heights = read.lines.map((l) => l.box[3] * read.h).sort((a, b) => a - b);
  const body = heights[Math.floor((heights.length - 1) / 2)] ?? 0;
  const lines: PdfLine[] = read.lines.map((l) => {
    const h = l.box[3] * read.h;
    return { text: l.text, size: Math.round(h >= body * PICTURE_LIMITS.scanHeading ? h : body), x: l.box[0] * read.w, y: (1 - l.box[1] - l.box[3]) * read.h, w: l.box[2] * read.w };
  });
  return shapeLines(lines);
}

const KIND_WORD: Record<FigureKind, string> = { chart: "Chart", table: "Table", figure: "Figure" };

/** What's added to one page of the source. */
export interface PageAddition {
  page: number;
  /** A scan's words, as its page's text. */
  scan?: { text: string; blocks: TextBlock[] };
  figures?: readonly KeptFigure[];
  /** Printed in its picture, not part of a row. */
  rest?: readonly string[];
  /** What the picture printed when nothing paired its words (over the limit, or an engine that can't see). */
  words?: readonly string[];
  left?: readonly PictureLeft[];
  /** The page's picture, an asset's hash. */
  asset?: string;
}

/**
 * The source's text with each page's additions at the end of that page, its pages and shape moved to
 * fit. Every word added is printed on its page; only the line naming the figure is code's.
 */
export function joinPictures<T extends { text: string; pages: number[]; blocks?: TextBlock[] }>(base: T, adds: readonly PageAddition[], unread: SourcePictures["unread"] = []): T & { blocks?: TextBlock[]; pictures?: SourcePictures } {
  const by = new Map(adds.map((a) => [a.page, a]));
  const parts: string[] = [];
  const pages: number[] = [];
  const blocks: TextBlock[] = [];
  const read: SourcePicture[] = [];
  let at = 0;
  base.pages.forEach((start, i) => {
    const end = i + 1 < base.pages.length ? base.pages[i + 1] - 2 : base.text.length;
    let part = base.text.slice(start, end);
    if (i) at += 2;
    pages.push(at);
    for (const b of base.blocks ?? []) if (b.span[0] >= start && b.span[1] <= end) blocks.push({ ...b, span: [b.span[0] - start + at, b.span[1] - start + at] });
    const add = by.get(i + 1);
    if (add) {
      const write = (words: string, kind?: TextBlock["kind"]): [number, number] => {
        if (part) part += "\n\n";
        const a = at + part.length;
        part += words;
        if (kind) blocks.push({ span: [a, a + words.length], kind });
        return [a, a + words.length];
      };
      const common = { page: i + 1, ...(add.asset ? { asset: add.asset } : {}) };
      let leftShown = false;
      const leftFor = () => {
        if (leftShown || !add.left?.length) return {};
        leftShown = true;
        return { left: [...add.left] };
      };
      if (add.scan?.text) {
        if (part) part += "\n\n";
        const a = at + part.length;
        part += add.scan.text;
        for (const b of add.scan.blocks) blocks.push({ ...b, span: [b.span[0] + a, b.span[1] + a] });
        read.push({ ...common, kind: "scan", span: [a, a + add.scan.text.length], ...leftFor() });
      }
      for (const f of add.figures ?? []) {
        const head = write(`${KIND_WORD[f.kind]} on page ${i + 1}${f.title ? `: ${f.title}` : ""}`, "h3");
        let last = head[1];
        for (const r of f.rows) last = write(r, "li")[1];
        read.push({ ...common, kind: f.kind, span: [head[0], last], ...leftFor() });
      }
      if (add.rest?.length) {
        const head = write(`Also printed in the picture on page ${i + 1}`, "h3");
        let last = head[1];
        for (const r of add.rest) last = write(r)[1];
        if (!add.figures?.length) read.push({ ...common, kind: "words", span: [head[0], last], ...leftFor() });
      }
      if (add.words?.length) {
        const head = write(`Printed in a picture on page ${i + 1}`, "h3");
        let last = head[1];
        for (const r of add.words) last = write(r)[1];
        read.push({ ...common, kind: "words", span: [head[0], last], ...leftFor() });
      }
      // Everything in it was left out: the page is still listed, to say so.
      if (add.left?.length && !leftShown) read.push({ ...common, kind: "figure", ...leftFor() });
    }
    parts.push(part);
    at += part.length;
  });
  const pictures: SourcePictures = { read, ...(unread.length ? { unread } : {}) };
  return { ...base, text: parts.join("\n\n"), pages, ...(blocks.length ? { blocks } : {}), ...(read.length || unread.length ? { pictures } : {}) };
}

// ---------------------------------------------------------------------------
// Saying what happened

export const LEFT_WORDS: Record<PictureLeft["why"], string> = {
  "not-printed": "isn't printed on the page",
  scale: "is only on the chart's scale",
  twice: "is printed fewer times than it was used",
  shape: "has no number printed, only a shape",
};

export const UNREAD_WORDS: Record<NonNullable<SourcePictures["unread"]>[number]["why"], string> = {
  "no-reader": "Reading a picture's words takes Qalam on a Mac.",
  limit: "That's past what's read per document, so at most their printed words are here.",
  "no-vision": "This engine can't see pictures, so only their printed words are here, with nothing pairing them.",
  failed: "Qalam AI couldn't read them this time, so only their printed words are here.",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The picture a quote's words were read from, if any. */
export const pictureAt = (p: SourcePictures | undefined, span: readonly [number, number]) => p?.read.find((x) => x.span && x.span[0] <= span[0] && span[1] <= x.span[1]);

/** "Pages 3 and 5", for a line saying which. */
export function pagesLine(pages: readonly number[]): string {
  if (pages.length === 1) return `Page ${pages[0]}`;
  return `Pages ${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`;
}

/** What came of a PDF's pictures, in a line. Null when it had none to speak of. */
export function picturesLine(p: SourcePictures | undefined): string | null {
  if (!p) return null;
  const read = new Set(p.read.filter((x) => x.span).map((x) => x.page)).size;
  const left = p.read.reduce((n, x) => n + (x.left?.length ?? 0), 0);
  const unread = new Set((p.unread ?? []).flatMap((u) => u.pages));
  const parts = [read ? `Read the pictures on ${plural(read, "page")}` : "", left ? `${left} left out, not printed` : "", unread.size ? `${plural(unread.size, "page")} not read` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

const PICTURE_KINDS = new Set(["scan", "chart", "table", "figure", "words"]);
const LEFT_WHYS = new Set(Object.keys(LEFT_WORDS));
const UNREAD_WHYS = new Set(Object.keys(UNREAD_WORDS));

/** What a window says of a PDF's pictures, as the core takes it: spans inside the text, an asset's name, nothing else. */
export function picturesFrom(raw: unknown, length: number): SourcePictures | undefined {
  const p = raw as { read?: unknown; unread?: unknown } | null;
  if (!p || !Array.isArray(p.read)) return undefined;
  const read = p.read.flatMap((x): SourcePicture[] => {
    const r = x as { page?: unknown; kind?: unknown; span?: unknown; asset?: unknown; left?: unknown } | null;
    if (!r || typeof r.page !== "number" || !PICTURE_KINDS.has(r.kind as string)) return [];
    const [a, z] = Array.isArray(r.span) ? (r.span as unknown[]) : [];
    const span = typeof a === "number" && typeof z === "number" && 0 <= a && a < z && z <= length ? ([a, z] as [number, number]) : undefined;
    const left = (Array.isArray(r.left) ? r.left : []).flatMap((l: { words?: unknown; why?: unknown } | null): PictureLeft[] => (typeof l?.words === "string" && LEFT_WHYS.has(l.why as string) ? [{ words: l.words.slice(0, 200), why: l.why as PictureLeft["why"] }] : []));
    return [{ page: r.page, kind: r.kind as SourcePicture["kind"], ...(span ? { span } : {}), ...(typeof r.asset === "string" && /^[0-9a-f]{24}$/.test(r.asset) ? { asset: r.asset } : {}), ...(left.length ? { left } : {}) }];
  });
  const unread = (Array.isArray(p.unread) ? p.unread : []).flatMap((u: { pages?: unknown; why?: unknown } | null): NonNullable<SourcePictures["unread"]> => (Array.isArray(u?.pages) && u.pages.every((n) => typeof n === "number") && UNREAD_WHYS.has(u.why as string) ? [{ pages: u.pages as number[], why: u.why as NonNullable<SourcePictures["unread"]>[number]["why"] }] : []));
  return read.length || unread.length ? { read, ...(unread.length ? { unread } : {}) } : undefined;
}
