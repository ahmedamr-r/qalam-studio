import { describe, expect, it } from "vitest";
import { makeFrame, makeShape, makeText } from "@/doc/factory";
import type { AutoLayout, FrameNode, SceneNode } from "@/doc/schema";
import { uniformRadius } from "@/doc/schema";
import { BUILTIN } from "@/design-system/resolve";
import { nodeCSS, type Placement } from "./css";
import { TokenTable } from "./tokens";

const layout = (p: Partial<AutoLayout> = {}): AutoLayout => ({
  direction: "vertical",
  wrap: false,
  gap: 0,
  crossGap: 0,
  padding: { top: 0, end: 0, bottom: 0, start: 0 },
  justify: "start",
  align: "start",
  ...p,
});

const column = (p: Partial<FrameNode> = {}, l: Partial<AutoLayout> = {}) => makeFrame({ fill: null, w: 300, h: 600, sizeH: "fixed", sizeV: "fixed", layout: layout(l), ...p }, BUILTIN);
const rect = (p: Partial<SceneNode> = {}) => makeShape("rect", { w: 40, h: 20, fill: null, radius: uniformRadius(0), ...p } as never, BUILTIN);
const css = (n: SceneNode, parent: SceneNode | null, t = new TokenTable()) => nodeCSS(n, { parent, dir: "ltr" } satisfies Placement, t);

describe("auto layout sizing as flexbox", () => {
  it("fill on the main axis grows from a zero basis; in a hugging parent it keeps its content basis", () => {
    const n = rect({ sizeV: "fill", sizeH: "fixed" });
    expect(css(n, column()).style).toMatchObject({ width: 40, flexGrow: 1, flexShrink: 1, flexBasis: 0 });
    const hugging = column({ sizeV: "hug" });
    const s = css(n, hugging).style;
    expect(s).toMatchObject({ flexGrow: 1, flexShrink: 1 });
    expect(s.flexBasis).toBeUndefined();
  });

  it("fill across the axis stretches, hug sets no size, fixed sets one", () => {
    expect(css(rect({ sizeH: "fill", sizeV: "fixed" }), column()).style).toMatchObject({ alignSelf: "stretch", height: 20 });
    const hug = css(makeFrame({ fill: null, sizeH: "hug", sizeV: "hug", layout: layout() }, BUILTIN), column()).style;
    expect(hug.width).toBeUndefined();
    expect(hug.height).toBeUndefined();
    // Yoga's items don't shrink (the stylesheet sets flex-shrink: 0); nothing to say here.
    expect(css(rect({ sizeH: "fixed", sizeV: "fixed" }), column()).style.flexShrink).toBeUndefined();
  });

  it("text gives way on the main axis unless its size there is fixed", () => {
    const t = makeText({ text: { content: "Hello", autoSize: "height" } as never }, BUILTIN);
    const row = column({}, { direction: "horizontal" });
    expect(css({ ...t, sizeH: "hug" } as SceneNode, row).style.flexShrink).toBe(1);
    expect(css({ ...t, sizeH: "fixed" } as SceneNode, row).style.flexShrink).toBeUndefined();
  });

  it("writes padding as logical sides, gaps and alignment as flexbox", () => {
    const f = column({}, { direction: "horizontal", gap: 12, padding: { top: 8, end: 24, bottom: 8, start: 16 }, justify: "between", align: "center" });
    expect(css(f, null).style).toMatchObject({
      display: "flex",
      flexDirection: "row",
      gap: 12,
      paddingBlock: 8,
      paddingInlineStart: 16,
      paddingInlineEnd: 24,
      justifyContent: "space-between",
      alignItems: "center",
    });
    const wrap = css(column({}, { direction: "horizontal", wrap: true, gap: 8, crossGap: 12 }), null).style;
    expect(wrap).toMatchObject({ flexWrap: "wrap", alignContent: "flex-start", columnGap: 8, rowGap: 12 });
  });

  it("binds spacing to tokens as CSS variables", () => {
    const t = new TokenTable();
    const f = column({}, { gap: 16, gapToken: "space.400", padding: { top: 16, end: 16, bottom: 16, start: 16 }, paddingTokens: { top: "space.400", end: "space.400", bottom: "space.400", start: "space.400" } });
    expect(css(f, null, t).style).toMatchObject({ gap: "var(--space-400)", padding: "var(--space-400)" });
    expect(t.css()).toContain("--space-400: 16px;");
  });

  it("keeps a token's literal value when a node disagrees with its first use", () => {
    const t = new TokenTable();
    expect(t.value("bg.canvas", "#FFFFFF")).toBe("var(--bg-canvas)");
    expect(t.value("bg.canvas", "#000000")).toBe("#000000");
  });
});

describe("absolute layers and paints", () => {
  it("places absolute layers where they were laid out, hugging ones from the nearer side", () => {
    const parent = makeFrame({ w: 300, h: 200, fill: null }, BUILTIN);
    expect(css(rect({ x: 10, y: 20 }), parent).style).toMatchObject({ position: "absolute", left: 10, top: 20, width: 40, height: 20 });
    const chip = makeFrame({ x: 230, y: 12, w: 58, h: 32, sizeH: "hug", sizeV: "fixed", layout: layout({ direction: "horizontal" }), fill: null }, BUILTIN);
    const s = css({ ...chip, absolute: true } as SceneNode, column());
    expect(s.style).toMatchObject({ position: "absolute", right: 12, top: 12, height: 32 });
    expect(s.style.width).toBeUndefined();
  });

  it("strokes sit inside the box, and drop shadows need a fill (as the renderer draws them)", () => {
    const shadow = [{ kind: "drop" as const, x: 0, y: 2, blur: 8, spread: 0, color: "#1C1C1C1A" }];
    const filled = css(rect({ fill: { color: "#FFFFFF" }, stroke: { color: "#D3D3D3", width: 1 }, effects: shadow }), null).style;
    expect(filled).toMatchObject({ outline: "1px solid #D3D3D3", outlineOffset: -1, boxShadow: "0px 2px 8px 0px #1C1C1C1A" });
    expect(css(rect({ effects: shadow }), null).style.boxShadow).toBeUndefined();
  });

  it("gives text its type token as a class and keeps only what differs from it", () => {
    const t = new TokenTable((p) => BUILTIN.typography(p));
    const body = BUILTIN.typography("type.body")!;
    const plain = makeText({ fill: { color: "#1C1C1C", token: "text.primary" }, text: { content: "Hi", ...body, typeToken: "type.body" } as never }, BUILTIN);
    const out = css(plain, null, t);
    expect(out.className).toBe("type-body");
    expect(out.style.color).toBe("var(--text-primary)");
    expect(out.style.fontSize).toBeUndefined();
    expect(out.style.lineHeight).toBeUndefined();
    const arabic = makeText({ text: { content: "مرحبا", ...body, fontFamily: "IBM Plex Sans Arabic", lineHeight: 24, letterSpacing: 0, typeToken: "type.body" } as never }, BUILTIN);
    const ar = css(arabic, column(), t).style;
    expect(ar).toMatchObject({ fontFamily: "'IBM Plex Sans Arabic', sans-serif", lineHeight: "24px" });
    expect(ar.fontSize).toBeUndefined();
  });
});
