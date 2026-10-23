import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CanvasKit } from "canvaskit-wasm";
import type { Doc, SceneNode, TextNode } from "@/doc/schema";
import { makeFrame, makeText } from "@/doc/factory";
import { measureText, setTextMeasurer } from "@/doc/measure";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import { FONT_FILES, type Engine } from "@/engine/canvaskit";
import { measureTextProps } from "@/engine/text";
import { buildScreen, type Inst, type ScreenSpec } from "@/design-system/builders";
import { insertScreens } from "@/design-system/place";
import { screenIssues } from "@/ui/ai/repair";
import { DEMO_SCREENS, HERO_DEMO_SCREENS } from "@/ui/demo";
import { auditSubtree } from "./rules";

/**
 * squeezed-text: a text laid out narrower than one of its words breaks that word. Every case runs
 * twice, measured by the fallback measurer (what Node has) and by CanvasKit with the studio's own
 * fonts (what the browser has), and each case is a different kind of product.
 */

// The browser's measurer, run in Node: the engine module hands out a CanvasKit loaded here.
const ck = vi.hoisted(() => ({ engine: null as Engine | null }));
vi.mock("@/engine/canvaskit", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/engine/canvaskit")>()), getEngine: () => ck.engine! }));

async function useCanvasKit() {
  const require = createRequire(import.meta.url);
  const init = require("canvaskit-wasm") as (o: { locateFile: (f: string) => string }) => Promise<CanvasKit>;
  const bin = path.dirname(require.resolve("canvaskit-wasm"));
  const kit = await init({ locateFile: (f) => path.join(bin, f) });
  const fonts = kit.TypefaceFontProvider.Make();
  for (const f of FONT_FILES) fonts.registerFont(readFileSync(path.join("public", f.file)), f.family);
  ck.engine = { ck: kit, fonts };
  setTextMeasurer(measureTextProps);
}

const docOf = (nodes: SceneNode[]): Doc => ({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), roots: nodes.filter((n) => !n.parentId).map((n) => n.id) });
const text = (t: string, style = "body"): Inst => ({ component: "Text", props: { text: t, style } });
const row = (children: Inst[], extra: Record<string, unknown> = {}): Inst => ({ component: "Stack", props: { direction: "horizontal", gap: "200", align: "center", ...extra }, children });
const tag = (label: string, tone: string): Inst => ({ component: "Tag", props: { label, tone } });
const screen = (body: Inst[], extra: Partial<ScreenSpec> = {}): ScreenSpec => ({ name: "Screen", platform: "mobile", body, ...extra });

/** Which texts on a laid out screen the rule flags, and how badly. */
function squeezed(spec: ScreenSpec) {
  const dir = spec.dir ?? "ltr";
  const nodes = layoutToNodes(buildScreen(spec), { dir, lang: spec.lang ?? (dir === "rtl" ? "ar" : "en") }, { x: 0, y: 0 });
  const doc = docOf(nodes);
  return auditSubtree(doc, [nodes[0].id])
    .filter((f) => f.rule === "squeezed-text")
    .map((f) => ({ text: (doc.nodes[f.nodeId] as TextNode).text.content, severity: f.severity, message: f.message }));
}
const texts = (spec: ScreenSpec) => squeezed(spec).map(({ text, severity }) => ({ text, severity }));

// Food: a reorder shelf, as the live Generate drew it: the price, a Tag and the action in one row of a 264px card.
const dish = (name: string, amount: string, note: string, action: "beside" | "below"): Inst => ({
  component: "Card",
  children: [
    { component: "MediaPlaceholder", props: { aspect: "16:9", label: name } },
    text(name, "body-strong"),
    row([text(amount, "headline"), tag(note, "member"), ...(action === "beside" ? [{ component: "Button", props: { label: "Reorder", variant: "tertiary", size: "sm" } }] : [])], { justify: "between" }),
    ...(action === "below" ? [{ component: "Button", props: { label: "Reorder", variant: "secondary", size: "sm", fullWidth: true } }] : []),
  ],
});
const shelf = (action: "beside" | "below") =>
  screen([{ component: "Carousel", props: { title: "Your Tuesday dinner?", itemWidth: 264 }, children: [dish("Chicken shawarma plate", "42.00 AED today", "Free delivery", action), dish("Butter chicken, naan", "38.50 AED today", "3.50 AED less", action)] }]);

// Analytics: KPI tiles sharing a phone's width, three to a row or two.
const kpi = (label: string, value: string, delta: string): Inst => ({ component: "Card", children: [text(label, "caption"), text(value, "title-lg"), tag(delta, "success")] });
const revenue = kpi("Revenue", "1,284,930", "+12%");
const orders = kpi("Orders", "18,402", "+4%");
const refunds = kpi("Refunds", "312", "-2%");
const sales = (rows: Inst[][]) => screen([text("Sales this week", "title-md"), ...rows.map((r) => row(r, { align: "stretch" }))]);

// Pharmacy back office (a desktop app, in Arabic): low stock in a narrow side panel of list rows.
const stock = (item: (title: string, count: string) => Inst) =>
  screen([{ component: "Panel", props: { title: "مخزون منخفض", width: 200 }, children: [item("هيدروكلوروثيازيد", "١٢ علبة"), item("زنك", "٣ علب")] }], { name: "المخزون", platform: "app", dir: "rtl", lang: "ar" });
const listRow = (title: string, trailingText: string): Inst => ({ component: "ListItem", props: { title, leadingIcon: "pill", trailing: "text", trailingText } });
const madeRow = (title: string, count: string): Inst => row([{ component: "Icon", props: { name: "pill" } }, text(title, "body-strong"), tag(count, "warning")]);

const MEASURERS = [
  ["the fallback measurer", async () => {}],
  ["CanvasKit", useCanvasKit],
] as const;

describe.each(MEASURERS)("squeezed text, measured by %s", (_, use) => {
  beforeAll(async () => {
    await ensureYoga();
    await use();
  });

  it("food: a price beside a Tag and an action in a 264px card breaks mid-word", () => {
    expect(texts(shelf("beside"))).toEqual([
      { text: "42.00 AED today", severity: "error" },
      { text: "38.50 AED today", severity: "error" },
    ]);
    expect(squeezed(shelf("beside"))[0].message).toMatch(/^"42\.00" needs \d+px on one line but its text is laid out \d+px wide, so the word breaks mid-word/);
  });

  it("food: with the action on a line of its own, the price keeps its words whole", () => {
    expect(texts(shelf("below"))).toEqual([]);
  });

  it("analytics: a KPI value wider than its tile, three tiles to a row; the values that fit aren't flagged", () => {
    expect(texts(sales([[revenue, orders, refunds]]))).toEqual([{ text: "1,284,930", severity: "error" }]);
    expect(texts(sales([[revenue, orders], [refunds]]))).toEqual([]);
  });

  it("pharmacy, RTL Arabic: a medicine's one-word name longer than its list row in a narrow panel is cut off", () => {
    expect(texts(stock(listRow))).toEqual([{ text: "هيدروكلوروثيازيد", severity: "warning" }]);
    // In a row made of Stack parts, free to wrap, the same name breaks mid-word.
    expect(texts(stock(madeRow))).toEqual([{ text: "هيدروكلوروثيازيد", severity: "error" }]);
  });

  it("words end where a line may break: at a space or after a hyphen, not at a no-break space", () => {
    const style = { fontFamily: "Inter", fontSize: 16, fontWeight: 600, lineHeight: 24, letterSpacing: 0, autoSize: "height" as const };
    const one = (content: string) => measureText({ ...makeText({ text: style }).text, content }, null).w;
    const flagged = (content: string, w: number) => {
      const f = makeFrame({ w: 200, h: 100 });
      const t = makeText({ w, text: { ...style, content } });
      t.parentId = f.id;
      f.children.push(t.id);
      return auditSubtree(docOf([f, t]), [f.id]).filter((x) => x.rule === "squeezed-text").length;
    };
    const room = (...words: string[]) => Math.max(...words.map(one)) + 1;
    expect(flagged("Late check-in", room("Late", "check-", "in"))).toBe(0);
    expect(flagged("42.00 AED", room("42.00", "AED"))).toBe(0);
    expect(flagged(`42.00${String.fromCharCode(0xa0)}AED`, room("42.00", "AED"))).toBe(1);
    expect(flagged("42.00 AED", one("42.00") - 2)).toBe(1);
  });

  it("leaves the demo screens clean", () => {
    for (const spec of [...DEMO_SCREENS, ...HERO_DEMO_SCREENS]) expect(squeezed(spec), spec.name).toEqual([]);
  });

  it("reaches the self-check at the price's spec path, so the repair can act on it", async () => {
    const [id] = await insertScreens([shelf("beside")], "ai", "builtin");
    const issues = screenIssues(id).filter((i) => i.rule === "squeezed-text");
    expect(issues.map((i) => [i.path, i.severity])).toEqual([
      ["body.0.children.0.children.2.children.0", "error"],
      ["body.0.children.1.children.2.children.0", "error"],
    ]);
  });
});
