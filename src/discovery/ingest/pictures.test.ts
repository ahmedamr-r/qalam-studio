import { describe, expect, it } from "vitest";
import { findQuote } from "../quotes";
import type { ShotLine } from "@/seen/shot";
import { pageFacts, PICTURE_LIMITS, type Box, type PageFacts } from "./page-facts";
import { freshLines, joinPictures, mergeLines, numbersIn, pagesToSend, pictureAt, picturesFrom, picturesLine, pickPage, printedOf, regionsOf, rowTitle, sanitizeFigures, scaleTicks, scanText, worthReading, type Printed } from "./pictures";

const OPS = { save: 10, restore: 11, transform: 12, constructPath: 91, endPath: 28, fill: 22, paintImageXObject: 85, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75 };
const VIEW = { transform: [1, 0, 0, -1, 0, 792], width: 612, height: 792 };
const facts = (over: Partial<PageFacts> = {}): PageFacts => ({ page: 1, chars: 800, pictures: 0, pictureBoxes: [], drawn: 0, drawnBox: null, ...over });
const line = (text: string, box: Box = [0.1, 0.1, 0.2, 0.02], conf = 1): ShotLine => ({ text, box, conf });
const printed = (lines: ShotLine[], over: Partial<Printed> = {}): Printed => ({ page: 2, why: "picture", w: 1000, h: 1400, lines, layer: "", drawnBox: null, ...over });

/** A bar chart as this Mac reads one: a scale down the side, months along the bottom, numbers over three of its six bars. */
const CHART = [
  line("Monthly churn rate, 2026", [0.15, 0.18, 0.25, 0.02]),
  line("6%", [0.15, 0.22, 0.03, 0.013]),
  line("5.2%", [0.43, 0.24, 0.03, 0.013]),
  line("4.1%", [0.22, 0.28, 0.03, 0.013]),
  line("4%", [0.15, 0.295, 0.03, 0.013]),
  line("3.9%", [0.32, 0.29, 0.03, 0.013]),
  line("2%", [0.15, 0.372, 0.03, 0.013]),
  line("0%", [0.15, 0.449, 0.03, 0.013]),
  line("Jan", [0.22, 0.465, 0.03, 0.013]),
  line("Feb", [0.325, 0.465, 0.03, 0.013]),
  line("Mar", [0.43, 0.465, 0.03, 0.013]),
  line("Apr", [0.538, 0.465, 0.03, 0.013]),
];
const row = (label: string, value: string, more: Record<string, unknown> = {}) => ({ labels: [{ name: "", value: label }], numbers: [{ name: "", value }], from_shape: false, ...more });
const answer = (rows: unknown[], title = "Monthly churn rate, 2026", kind = "chart") => ({ figures: [{ kind, title, rows }] });

describe("where a page's pictures land", () => {
  it("follows the transform to a picture's place on the page, top left", () => {
    const f = pageFacts({ fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore], argsArray: [null, [306, 0, 0, 396, 0, 396], ["img"], null] }, OPS, VIEW);
    expect(f.pictures).toBeCloseTo(0.25);
    expect(f.pictureBoxes[0]).toEqual([0, 0, 0.5, 0.5]);
  });

  it("restores the transform, and goes into a form's own space", () => {
    const f = pageFacts({ fnArray: [OPS.save, OPS.transform, OPS.restore, OPS.paintFormXObjectBegin, OPS.transform, OPS.paintImageXObject, OPS.paintFormXObjectEnd], argsArray: [null, [9, 0, 0, 9, 0, 0], null, [[1, 0, 0, 1, 0, 0], [0, 0, 1, 1]], [612, 0, 0, 79.2, 0, 0], ["img"], null] }, OPS, VIEW);
    expect(f.pictures).toBeCloseTo(0.1);
  });

  it("takes the page's rotation from the viewport", () => {
    const turned = { transform: [0, 1, 1, 0, 0, 0], width: 792, height: 612 };
    const f = pageFacts({ fnArray: [OPS.transform, OPS.paintImageXObject], argsArray: [[100, 0, 0, 100, 0, 0], ["img"]] }, OPS, turned);
    expect(f.pictureBoxes[0]).toEqual([0, 0, 100 / 792, 100 / 612]);
  });

  it("doesn't count a logo", () => {
    const f = pageFacts({ fnArray: [OPS.transform, OPS.paintImageXObject], argsArray: [[40, 0, 0, 40, 0, 0], ["img"]] }, OPS, VIEW);
    expect(f.pictures).toBe(0);
  });

  it("counts painted paths, not a clip or a background", () => {
    const rect = (x: number, y: number, w: number, h: number) => [OPS.fill, [new Float32Array([0, x, y, 1, x + w, y, 1, x + w, y + h, 1, x, y + h, 4])], new Float32Array([x, y, x + w, y + h])];
    const clip = [OPS.endPath, [new Float32Array([0, 0, 0])], new Float32Array([100, 100, 200, 200])];
    const f = pageFacts({ fnArray: [OPS.constructPath, OPS.constructPath, OPS.constructPath, OPS.constructPath], argsArray: [clip, rect(0, 0, 612, 792), rect(100, 100, 50, 200), rect(200, 100, 50, 300)] }, OPS, VIEW);
    expect(f.drawn).toBe(2);
    expect(f.drawnBox?.[2]).toBeCloseTo(150 / 612);
  });
});

describe("which pages are picked, with no tokens", () => {
  it("a page of text with no pictures isn't", () => {
    expect(pickPage(facts())).toBeNull();
    expect(pickPage(facts({ chars: 5 }))).toBeNull();
  });

  it("a page full of picture and no text is a scan; so is text set as outlines", () => {
    expect(pickPage(facts({ chars: 0, pictures: 1 }))).toBe("scan");
    expect(pickPage(facts({ chars: 12, drawn: 400, drawnBox: [0, 0, 1, 1] }))).toBe("scan");
  });

  it("a large picture among text is a picture; a drawn figure is drawn", () => {
    expect(pickPage(facts({ pictures: 0.3 }))).toBe("picture");
    expect(pickPage(facts({ chars: 7, pictures: 0.3 }))).toBe("picture");
    expect(pickPage(facts({ drawn: 8, drawnBox: [0.1, 0.1, 0.8, 0.4] }))).toBe("drawn");
  });

  it("a rule or two under a heading isn't a figure", () => {
    expect(pickPage(facts({ drawn: 2, drawnBox: [0.1, 0.1, 0.8, 0.4] }))).toBeNull();
    expect(pickPage(facts({ drawn: 8, drawnBox: [0.1, 0.1, 0.8, 0.01] }))).toBeNull();
  });
});

describe("what's worth a call, with no tokens", () => {
  it("a photo prints nothing, and costs nothing", () => {
    expect(worthReading(printed([]))).toBe(0);
    expect(worthReading(printed([line("ACME")]))).toBe(0);
  });

  it("a slide's background behind its text prints nothing the text doesn't say", () => {
    const layer = "Churn rose to 5.2% in March after the price change";
    expect(worthReading(printed([line("Churn rose to 5.2% in March"), line("after the price change")], { layer }))).toBe(0);
  });

  it("a chart's picture does", () => {
    expect(worthReading(printed(CHART, { layer: "Churn by month" }))).toBeGreaterThan(0);
    expect(freshLines({ lines: [line("Churn by month"), line("4.1%")], layer: "Churn by month" }).map((l) => l.text)).toEqual(["4.1%"]);
  });

  it("a decorative banner doesn't bring the page's own wrapped lines in as new", () => {
    // Read as words, a body line breaks where it wraps: "Con-" isn't in the text, which has "Consumer".
    const body = [line("prepared by the Con-", [0.1, 0.5, 0.4, 0.02]), line("sumer and Community section, 2017", [0.1, 0.53, 0.4, 0.02])];
    const banner: Box = [0, 0, 1, 0.16];
    const p = printed(body, { layer: "prepared by the Consumer and Community section, 2017", pictureBoxes: [banner] });
    expect(freshLines(p)).toEqual([]);
    expect(worthReading(p)).toBe(0);
    // A word in the banner itself is the picture's.
    const inBanner = line("Survey 2017", [0.1, 0.05, 0.2, 0.02]);
    expect(freshLines({ ...p, lines: [...body, inBanner] })).toEqual([inBanner]);
  });

  it("a scan's prose needs no call; its rows of numbers do", () => {
    const prose = [line("We asked every customer who cancelled in 2026."), line("214 answered, out of 560 who cancelled.")];
    expect(worthReading(printed(prose, { why: "scan" }))).toBe(0);
    expect(worthReading(printed([...prose, line("Price 81"), line("Setup 47"), line("Other 47")], { why: "scan" }))).toBeGreaterThan(0);
  });

  it("a drawn page needs numbers inside the drawing, not elsewhere on the page", () => {
    const inside = [line("3,120", [0.3, 0.3, 0.05, 0.01]), line("2,154", [0.3, 0.35, 0.05, 0.01]), line("668", [0.3, 0.4, 0.05, 0.01])];
    const outside = [line("In 2026 we had 3 of 12", [0.1, 0.9, 0.5, 0.01])];
    expect(worthReading(printed(inside, { why: "drawn", drawnBox: [0.2, 0.2, 0.6, 0.3] }))).toBe(3);
    expect(worthReading(printed(outside, { why: "drawn", drawnBox: [0.2, 0.2, 0.6, 0.3] }))).toBe(0);
  });

  it("sends the pages adding the most numbers, within the limit, in the document's order", () => {
    const pages = Array.from({ length: PICTURE_LIMITS.modelPages + 3 }, (_, i) => printed(Array.from({ length: i + 1 }, (_, k) => line(`${i}${k}`, [0.1, k * 0.05, 0.1, 0.02])), { page: i + 1 }));
    const { send, over } = pagesToSend(pages);
    expect(send).toHaveLength(PICTURE_LIMITS.modelPages);
    expect(send.map((p) => p.page)).toEqual([...send.map((p) => p.page)].sort((a, b) => a - b));
    expect(over.map((p) => p.page)).toEqual([1, 2, 3]);
  });
});

describe("reading a page in parts", () => {
  it("reads a picture's box, or the drawing's, or a scan in overlapping bands", () => {
    expect(regionsOf({ pictureBoxes: [[0.2, 0.2, 0.5, 0.3]], drawnBox: null }, "picture")[0].map((n) => +n.toFixed(2))).toEqual([0.19, 0.19, 0.52, 0.32]);
    expect(regionsOf({ pictureBoxes: [], drawnBox: [0, 0, 1, 0.5] }, "drawn")[0].map((n) => +n.toFixed(2))).toEqual([0, 0, 1, 0.51]);
    expect(regionsOf({ pictureBoxes: [], drawnBox: null }, "scan")).toEqual([[0, 0, 1, 0.5], [0, 0.25, 1, 0.5], [0, 0.5, 1, 0.5]]);
  });

  it("adds what a part found only where nothing was read, in reading order", () => {
    const page = [line("Jan", [0.2, 0.46, 0.03, 0.01]), line("Feb", [0.3, 0.46, 0.03, 0.01])];
    const merged = mergeLines(page, [[line("Jan", [0.2, 0.46, 0.03, 0.01]), line("4.1%", [0.2, 0.3, 0.03, 0.01]), line("470", [0.3, 0.461, 0.03, 0.01])]]);
    expect(merged.map((l) => l.text)).toEqual(["4.1%", "Jan", "Feb"]);
  });

  it("leaves out a reading it isn't sure of, so it can't back a number", () => {
    const f = facts({ page: 2 });
    const p = printedOf(f, "picture", { w: 1000, h: 1400, lines: [line("ilnl", [0.2, 0.2, 0.6, 0.2], 0.3), line("Jan")] }, "");
    expect(p.lines.map((l) => l.text)).toEqual(["Jan"]);
  });
});

describe("a chart's scale", () => {
  it("finds the numbers lined up, evenly spaced, running evenly", () => {
    expect([...scaleTicks(CHART).keys()].sort()).toEqual(["0", "2", "4", "6"]);
  });

  it("finds a scale along the bottom, and one read as a single line", () => {
    const bottom = [line("0", [0.1, 0.9, 0.02, 0.01]), line("100", [0.3, 0.9, 0.02, 0.01]), line("200", [0.5, 0.9, 0.02, 0.01]), line("300", [0.7, 0.9, 0.02, 0.01])];
    expect([...scaleTicks(bottom).keys()]).toEqual(["0", "100", "200", "300"]);
    expect([...scaleTicks([line("0 10 20 30")]).keys()]).toEqual(["0", "10", "20", "30"]);
  });

  it("leaves numbers that don't run evenly alone", () => {
    const col = [line("1,240", [0.5, 0.2, 0.05, 0.01]), line("862", [0.5, 0.25, 0.05, 0.01]), line("97", [0.5, 0.3, 0.05, 0.01])];
    expect(scaleTicks(col).size).toBe(0);
    expect(scaleTicks([line("4.1%", [0.1, 0.28, 0.03, 0.01]), line("3.9%", [0.2, 0.29, 0.03, 0.01])]).size).toBe(0);
  });
});

describe("what code keeps of a reading", () => {
  it("keeps numbers printed on the page, each line carrying its figure's title", () => {
    const r = sanitizeFigures(answer([row("Jan", "4.1%"), row("Feb", "3.9%"), row("Mar", "5.2%")]), printed(CHART));
    expect(r.figures).toEqual([{ kind: "chart", title: "Monthly churn rate, 2026", rows: ["Monthly churn rate, 2026 · Jan · 4.1%", "Monthly churn rate, 2026 · Feb · 3.9%", "Monthly churn rate, 2026 · Mar · 5.2%"] }]);
    expect(r.left).toEqual([]);
  });

  it("leaves out a number read off a bar's height, even when the model doesn't say so", () => {
    const r = sanitizeFigures(answer([row("Jan", "4.1%"), row("Apr", "4.7%")]), printed(CHART));
    expect(r.figures[0].rows).toEqual(["Monthly churn rate, 2026 · Jan · 4.1%"]);
    expect(r.left).toEqual([{ words: "4.7%", why: "not-printed" }]);
  });

  it("leaves out what the model says it read from a shape, even when that number is printed elsewhere", () => {
    const r = sanitizeFigures(answer([row("Apr", "4.1%", { from_shape: true })]), printed(CHART));
    expect(r.figures).toEqual([]);
    expect(r.left).toEqual([{ words: "Apr · 4.1%", why: "shape" }]);
  });

  it("leaves out a bar's height that lands on the scale, though the number is printed", () => {
    const r = sanitizeFigures(answer([row("Apr", "6%")]), printed(CHART));
    expect(r.figures).toEqual([]);
    expect(r.left).toEqual([{ words: "6%", why: "scale" }]);
  });

  it("keeps a number on the scale when it's printed on a bar too", () => {
    const r = sanitizeFigures(answer([row("Apr", "6%"), row("Mar", "6%")]), printed([...CHART, line("6%", [0.54, 0.2, 0.03, 0.013])]));
    expect(r.figures[0].rows).toEqual(["Monthly churn rate, 2026 · Apr · 6%"]);
    expect(r.left).toEqual([{ words: "6%", why: "twice" }]);
  });

  it("doesn't use a number more often than it's printed", () => {
    const r = sanitizeFigures(answer([row("Jan", "4.1%"), row("Feb", "4.1%")]), printed(CHART));
    expect(r.figures[0].rows).toHaveLength(1);
    expect(r.left).toEqual([{ words: "4.1%", why: "twice" }]);
  });

  it("never finds a number inside a longer one", () => {
    const r = sanitizeFigures(answer([row("Jan", "4.1"), row("Feb", "1"), row("Mar", "3,9")]), printed([line("Jan"), line("Feb"), line("Mar"), line("14.1"), line("1,240"), line("3.9")]));
    expect(r.figures).toEqual([]);
    expect(r.left.map((l) => l.words)).toEqual(["4.1", "1", "3,9"]);
    expect(numbersIn("1,240 and 4.1%")).toEqual(["1,240", "4.1"]);
  });

  it("drops a row whose label isn't printed: it would mean something else", () => {
    const r = sanitizeFigures(answer([row("July", "4.1%")]), printed(CHART));
    expect(r.figures).toEqual([]);
    expect(r.left).toEqual([{ words: "July · 4.1%", why: "not-printed" }]);
  });

  it("a number on its own says nothing; a name that isn't printed just falls away", () => {
    const lone = sanitizeFigures(answer([{ labels: [], numbers: [{ name: "", value: "4.1%" }], from_shape: false }]), printed(CHART));
    expect(lone.figures).toEqual([]);
    const unnamed = sanitizeFigures(answer([{ labels: [{ name: "Month", value: "Jan" }], numbers: [{ name: "Loss", value: "4.1%" }], from_shape: false }], ""), printed(CHART));
    expect(unnamed.figures[0].rows).toEqual(["Jan · 4.1%"]);
  });

  it("reads a table's row with its printed names, as the page sets them", () => {
    const table = [line("Refunds by plan, Q3 2026"), line("Plan"), line("Customers"), line("Refund rate"), line("Starter"), line("1,240"), line("7.4%")];
    const r = sanitizeFigures(answer([{ labels: [{ name: "Plan", value: "Starter" }], numbers: [{ name: "Customers", value: "1,240" }, { name: "Refund rate", value: "7.4%" }], from_shape: false }], "Refunds by plan, Q3 2026", "table"), printed(table));
    expect(r.figures[0].rows).toEqual(["Refunds by plan, Q3 2026 · Plan: Starter · Customers: 1,240 · Refund rate: 7.4%"]);
  });

  it("takes a number spaced another way, and keeps a number from the page's own text", () => {
    const r = sanitizeFigures(answer([row("Jan", "4.1%"), row("Feb", "668")], ""), printed([line("Jan"), line("Feb"), line("4.1 %")], { layer: "Paid 668" }));
    expect(r.figures[0].rows).toEqual(["Jan · 4.1%", "Feb · 668"]);
  });

  it("reads Arabic and its digits, either way a model writes them, in the page's own", () => {
    const page = [line("عدد الطلبات المتأخرة"), line("٣٤٠"), line("275"), line("الرياض"), line("جدة"), line("مكة")];
    const r = sanitizeFigures(answer([row("الرياض", "٣٤٠"), row("جدة", "٢٧٥"), row("مكة", "113")], "عدد الطلبات المتأخرة"), printed(page));
    expect(r.figures[0].rows.map((x) => x.split(" · ").slice(1).join(" · "))).toEqual(["الرياض · ٣٤٠", "جدة · 275"]);
    expect(r.left).toEqual([{ words: "113", why: "not-printed" }]);
  });

  it("says what else the picture prints, in its own words, and not what a row took", () => {
    const lines = [...CHART, line("Source: billing system, active subscriptions", [0.15, 0.49, 0.3, 0.01])];
    const r = sanitizeFigures(answer([row("Jan", "4.1%")]), printed(lines));
    expect(r.rest).toEqual(["Source: billing system, active subscriptions"]);
  });

  it("keeps a row on one line, however the page wrapped its words", () => {
    const r = sanitizeFigures(answer([{ labels: [{ name: "", value: "Jan" }], numbers: [{ name: "Change from 2016", value: "4.1%" }], from_shape: false }], ""), printed(CHART, { layer: "Change\nfrom 2016" }));
    expect(r.figures[0].rows).toEqual(["Jan · Change from 2016: 4.1%"]);
  });

  it("carries a short form of a long title on each row, and the whole title once", () => {
    const title = "Table 1. Share of adults at least doing okay financially (by demographic characteristics)";
    const r = sanitizeFigures(answer([row("Jan", "4.1%")], title, "table"), printed([...CHART, line(title)]));
    expect(r.figures[0].title).toBe(title);
    expect(r.figures[0].rows).toEqual(["Table 1. Share of adults at least doing okay financially · Jan · 4.1%"]);
    expect(rowTitle("A very long title with no aside in it that goes on and on and on and on and on past the limit")).toBe("A very long title with no aside in it that goes on and on and on and");
  });

  it("makes nothing of an answer that isn't one", () => {
    for (const raw of [null, "x", {}, { figures: "x" }, { figures: [null] }, { figures: [{ rows: [null, { numbers: "x" }] }] }]) expect(sanitizeFigures(raw, printed(CHART)).figures).toEqual([]);
  });
});

describe("joining it to the source", () => {
  const base = { text: "First page.\n\nSecond page.\n\nThird page.", pages: [0, 13, 27], blocks: [{ span: [0, 11] as [number, number], kind: "h1" as const }, { span: [27, 38] as [number, number], kind: "h2" as const }] };
  const figure = { kind: "chart" as const, title: "Churn", rows: ["Churn · Jan · 4.1%", "Churn · Feb · 3.9%"] };

  it("puts it at the end of its page, with pages and shape moved to fit", () => {
    const r = joinPictures(base, [{ page: 2, figures: [figure], left: [{ words: "Apr · 6%", why: "shape" }], asset: "abc" }]);
    expect(r.text).toBe("First page.\n\nSecond page.\n\nChart on page 2: Churn\n\nChurn · Jan · 4.1%\n\nChurn · Feb · 3.9%\n\nThird page.");
    expect(r.pages).toEqual([0, 13, r.text.indexOf("Third page.")]);
    expect(r.blocks?.map((b) => [b.kind, r.text.slice(...b.span)])).toEqual([["h1", "First page."], ["h3", "Chart on page 2: Churn"], ["li", "Churn · Jan · 4.1%"], ["li", "Churn · Feb · 3.9%"], ["h2", "Third page."]]);
    expect(r.pictures?.read).toEqual([{ page: 2, asset: "abc", kind: "chart", span: [27, r.text.indexOf("\n\nThird")], left: [{ words: "Apr · 6%", why: "shape" }] }]);
  });

  it("keeps quotes found word for word in what joined", () => {
    const r = joinPictures(base, [{ page: 2, figures: [figure] }]);
    expect(findQuote(r.text, "Churn · Jan · 4.1%")?.words).toBe("Churn · Jan · 4.1%");
  });

  it("makes an empty page's text its scan's, with its shape", () => {
    const r = joinPictures({ text: "\n\nAfter.", pages: [0, 2] }, [{ page: 1, scan: { text: "Exit survey\n\nPrice 81", blocks: [{ span: [0, 11], kind: "h1" }] } }]);
    expect(r.text).toBe("Exit survey\n\nPrice 81\n\nAfter.");
    expect(r.pages).toEqual([0, 23]);
    expect(r.blocks).toEqual([{ span: [0, 11], kind: "h1" }]);
    expect(r.pictures?.read[0]).toMatchObject({ page: 1, kind: "scan", span: [0, 21] });
  });

  it("still lists a page where everything was left out, with no words to point at", () => {
    const r = joinPictures(base, [{ page: 1, left: [{ words: "May · 3%", why: "shape" }] }]);
    expect(r.text).toBe(base.text);
    expect(r.pictures?.read).toEqual([{ page: 1, kind: "figure", left: [{ words: "May · 3%", why: "shape" }] }]);
  });

  it("says which pages weren't read, and adds nothing where there's nothing", () => {
    expect(joinPictures(base, [], [{ pages: [3], why: "no-reader" }]).pictures).toEqual({ read: [], unread: [{ pages: [3], why: "no-reader" }] });
    expect(joinPictures(base, []).pictures).toBeUndefined();
  });

  it("knows which picture a quote's words came from", () => {
    const r = joinPictures(base, [{ page: 2, figures: [figure] }]);
    const at = findQuote(r.text, "Churn · Jan · 4.1%")!.span;
    expect(pictureAt(r.pictures, at)).toMatchObject({ page: 2, kind: "chart" });
    expect(pictureAt(r.pictures, [0, 11])).toBeUndefined();
  });

  it("says it in a line", () => {
    expect(picturesLine(undefined)).toBeNull();
    expect(picturesLine({ read: [] })).toBeNull();
    expect(picturesLine({ read: [{ page: 2, kind: "chart", span: [0, 1], left: [{ words: "x", why: "shape" }] }, { page: 2, kind: "table", span: [2, 3] }, { page: 4, kind: "scan", span: [4, 5] }], unread: [{ pages: [7], why: "limit" }] })).toBe("Read the pictures on 2 pages · 1 left out, not printed · 1 page not read");
  });
});

describe("what a window says of a PDF's pictures", () => {
  it("keeps what fits the text, and nothing else", () => {
    const asset = "0123456789abcdef01234567";
    expect(picturesFrom({ read: [{ page: 2, kind: "chart", span: [0, 5], asset, left: [{ words: "Apr", why: "shape" }, { words: "x", why: "because" }], extra: 1 }, { page: 3, kind: "chart", span: [0, 99], asset: "../../secret" }, { page: 4, kind: "nope" }], unread: [{ pages: [7], why: "limit" }, { pages: ["x"], why: "limit" }, { pages: [8], why: "bored" }] }, 10)).toEqual({
      read: [{ page: 2, kind: "chart", span: [0, 5], asset, left: [{ words: "Apr", why: "shape" }] }, { page: 3, kind: "chart" }],
      unread: [{ pages: [7], why: "limit" }],
    });
    for (const raw of [null, "x", {}, { read: "x" }, { read: [] }]) expect(picturesFrom(raw, 10)).toBeUndefined();
  });
});

describe("a scanned page's shape", () => {
  it("doesn't take a line for a heading because its letters run a little taller", () => {
    const r = scanText({ w: 1000, h: 1000, lines: [line("We asked every customer who cancelled in September", [0.1, 0.2, 0.8, 0.02]), line("214 customers answered, out of 560 who cancelled.", [0.1, 0.225, 0.8, 0.025]), line("Most named the price.", [0.1, 0.255, 0.3, 0.02])] });
    expect(r.blocks).toEqual([]);
    expect(r.text).toBe("We asked every customer who cancelled in September 214 customers answered, out of 560 who cancelled. Most named the price.");
  });

  it("reads its lines as a page's: a heading by size, wrapped lines joined", () => {
    const r = scanText({ w: 1000, h: 1000, lines: [line("Exit survey", [0.1, 0.1, 0.3, 0.04]), line("We asked every customer who cancelled in September", [0.1, 0.2, 0.8, 0.02]), line("why they left.", [0.1, 0.225, 0.2, 0.02])] });
    expect(r.text).toBe("Exit survey\n\nWe asked every customer who cancelled in September why they left.");
    expect(r.blocks).toEqual([{ span: [0, 11], kind: "h1" }]);
  });
});
