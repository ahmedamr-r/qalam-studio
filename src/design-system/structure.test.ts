import { describe, expect, it } from "vitest";
import type { FoundationsResult } from "@/ai/ds-schemas";
import type { StructureResult } from "@/ai/ds-structure";
import foundations from "@/ai/fixtures/ds-foundations.json";
import { designSystemFromExtraction } from "./fromExtraction";
import { isValid, validateTree } from "./contract";
import type { Capture } from "./pixels";
import { TokenSet } from "./resolve";
import { applyStructure, inferStyles, measuredTokens } from "./structure";
import { measureListRow, measureMark, measureNav, measureStructure, measureTile, measureTitle } from "./structure-pixels";
import { styleOf } from "./styles";
import tokens from "./tokens.json";
import type { Tree } from "./resolve";

/** A 390×844 phone capture at 1x (ImageData isn't available in Node) and shapes drawn on it. */
function screen(bg = "#FFFFFF") {
  const w = 390,
    h = 844;
  const data = new Uint8ClampedArray(w * h * 4);
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const put = (x: number, y: number, hex: string) => x >= 0 && y >= 0 && x < w && y < h && data.set([...rgb(hex), 255], (y * w + x) * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, bg);
  const img = { width: w, height: h, data, colorSpace: "srgb" } as ImageData;
  const s = {
    img,
    rect(x0: number, y0: number, rw: number, rh: number, r: number, hex: string) {
      for (let y = y0; y < y0 + rh; y++)
        for (let x = x0; x < x0 + rw; x++) {
          const cx = Math.min(Math.max(x + 0.5, x0 + r), x0 + rw - r);
          const cy = Math.min(Math.max(y + 0.5, y0 + r), y0 + rh - r);
          if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) put(x, y, hex);
        }
      return s;
    },
    /** A line icon: a 2px outline. */
    glyph(x0: number, y0: number, gw: number, gh: number, hex = "#1A1A1A") {
      for (let y = y0; y < y0 + gh; y++) for (let x = x0; x < x0 + gw; x++) if (x < x0 + 2 || x >= x0 + gw - 2 || y < y0 + 2 || y >= y0 + gh - 2) put(x, y, hex);
      return s;
    },
    /** Text: lines of ink every other row. */
    text(x0: number, y0: number, tw: number, th: number, hex = "#1A1A1A") {
      for (let y = y0; y < y0 + th; y += 2) for (let x = x0; x < x0 + tw; x++) put(x, y, hex);
      return s;
    },
  };
  return s;
}
const cap: Capture = { width: 390, height: 844, sentWidth: 390, sentHeight: 844, scale: 1, logicalWidth: 390, confident: true, kind: "phone" };
/** A box in 0–1 image coordinates from px. */
const box = (x: number, y: number, w: number, h: number) => [x / 390, y / 844, (x + w) / 390, (y + h) / 844];

/** A floating, icon-only pill nav like Cash App's: three tabs, a circle behind the active one. */
function floatingNav() {
  const s = screen().rect(100, 760, 190, 60, 30, "#F0F0F0").rect(116, 768, 44, 44, 22, "#D6D6D6");
  for (const cx of [138, 195, 252]) s.glyph(cx - 10, 780, 20, 20);
  return s;
}

describe("reading structure in the pixels", () => {
  it("sees a floating icon-only bar and the circle behind the active tab", () => {
    const s = floatingNav();
    const nav = measureNav(s.img, box(96, 756, 198, 68), cap)!;
    expect(Math.round(nav.insetStart)).toBe(100);
    expect(Math.round(nav.insetEnd)).toBe(100);
    expect(nav.pill).toBe(true);
    expect(nav.labels).toBe("none");
    const mark = measureMark(s.img, box(114, 766, 48, 48), cap)!;
    expect(Math.round(mark.w)).toBe(44);
    expect(mark.pill).toBe(true);
  });

  it("sees a docked bar with a label under every tab, or under the active one only", () => {
    const bar = (active: boolean) => {
      const s = screen().rect(0, 760, 390, 84, 0, "#F7F7F7");
      [65, 195, 325].forEach((cx, i) => {
        s.glyph(cx - 12, 770, 24, 24);
        if (!active || i === 0) s.text(cx - 20, 800, 40, 9);
      });
      return measureNav(s.img, box(0, 756, 390, 88), cap)!;
    };
    const all = bar(false);
    expect([all.insetStart, all.insetEnd]).toEqual([0, 0]);
    expect(all.labels).toBe("all");
    expect(bar(true).labels).toBe("active");
  });

  it("reads where the title sits and how large it is", () => {
    const at = (x: number, w: number, h: number) => measureTitle(screen().text(x, 100, w, h).img, box(x - 6, 94, w + 12, h + 12), cap)!;
    expect(inferStyles({ title: at(16, 150, 28) })["component.top-bar.style.title"]?.value).toBe("large");
    expect(inferStyles({ title: at(135, 120, 16) })["component.top-bar.style.title"]?.value).toBe("center");
    expect(inferStyles({ title: at(64, 120, 16) })["component.top-bar.style.title"]?.value).toBe("start");
  });

  it("tells an underline from a pill under the selected tab", () => {
    const line = measureMark(screen().rect(40, 300, 100, 2, 0, "#111111").img, box(36, 296, 108, 10), cap)!;
    expect(inferStyles({ tabsActive: line })["component.tabs.style.indicator"]?.value).toBe("underline");
    const pill = measureMark(screen().rect(40, 290, 100, 32, 16, "#EEEEEE").text(60, 300, 60, 11).img, box(36, 286, 108, 40), cap)!;
    expect(inferStyles({ tabsActive: pill })["component.tabs.style.indicator"]?.value).toBe("pill");
  });

  it("reads list rows: bare or contained icons, inset or full dividers, chevrons", () => {
    const rows = (opts: { contained: boolean; inset: boolean; chevron: boolean }) => {
      const s = screen();
      const out = [];
      for (let i = 0; i < 3; i++) {
        const y = 200 + i * 56;
        if (opts.contained) s.rect(16, y + 8, 40, 40, 20, "#EEEEEE").glyph(26, y + 18, 20, 20);
        else s.glyph(18, y + 18, 20, 20);
        s.text(72, y + 20, 140, 9);
        if (opts.chevron) s.glyph(354, y + 21, 8, 14);
        if (i < 2) s.rect(opts.inset ? 72 : 16, y + 55, opts.inset ? 302 : 358, 1, 0, "#E2E2E2");
        out.push(measureListRow(s.img, box(16, y, 358, 56), opts.contained ? box(14, y + 6, 44, 44) : box(16, y + 16, 24, 24), cap));
      }
      return out;
    };
    const a = rows({ contained: true, inset: true, chevron: true });
    expect(a.map((r) => r.leading)).toEqual(["contained", "contained", "contained"]);
    expect(Math.round(a[0].leadingBox!.w)).toBe(40);
    expect(a.slice(0, 2).map((r) => r.divider)).toEqual(["inset", "inset"]);
    expect(a.map((r) => r.chevron)).toEqual(["shown", "shown", "shown"]);
    const b = rows({ contained: false, inset: false, chevron: false });
    expect(b.map((r) => r.leading)).toEqual(["bare", "bare", "bare"]);
    expect(b.slice(0, 2).map((r) => r.divider)).toEqual(["full", "full"]);
    expect(b[2].divider).toBe("none");
    expect(b.map((r) => r.chevron)).toEqual(["hidden", "hidden", "hidden"]);
  });

  it("tells a tile card from a bare tile", () => {
    const s = screen().rect(16, 400, 80, 92, 16, "#F2F2F2").glyph(46, 420, 20, 20);
    expect(measureTile(s.img, box(16, 400, 80, 92))).toBe("card");
    expect(measureTile(screen().glyph(146, 420, 20, 20).text(136, 450, 40, 9).img, box(116, 400, 80, 92))).toBe("bare");
  });
});

describe("deciding structure", () => {
  it("only decides what the pixels show clearly", () => {
    const nav = { width: 190, height: 60, radius: 30, pill: true, fill: "#F0F0F0", logicalWidth: 390 };
    expect(inferStyles({ nav: { ...nav, insetStart: 100, insetEnd: 100 } })["component.nav-bar.style.placement"]?.value).toBe("floating");
    expect(inferStyles({ nav: { ...nav, insetStart: 0, insetEnd: 0, pill: false, radius: 0 } })["component.nav-bar.style.placement"]?.value).toBe("docked");
    // Off to one side, or square: not clear.
    expect(inferStyles({ nav: { ...nav, insetStart: 12, insetEnd: 60 } })["component.nav-bar.style.placement"]).toBeUndefined();
    expect(inferStyles({ nav: { ...nav, insetStart: 16, insetEnd: 16, pill: false, radius: 4 } })["component.nav-bar.style.placement"]).toBeUndefined();
    // One list row isn't enough to call the list's style.
    expect(inferStyles({ list: { rows: 1, heights: [56], leading: ["bare"], divider: ["inset"], chevron: ["shown"] } })).toEqual({});
  });

  it("writes the model's structure, and lets clear pixels overrule it with a note", () => {
    const tree = structuredClone(tokens) as unknown as Tree;
    const model = { "nav-bar": { visible: true, placement: "docked", labels: "all", indicator: "none", evidence: "" }, "top-bar": { visible: true, title: "large", evidence: "" } } as unknown as StructureResult;
    const s = floatingNav();
    const evidence = measureStructure(
      [
        { kind: "nav-bar", image: 1, bbox: box(96, 756, 198, 68) },
        { kind: "nav-active", image: 1, bbox: box(114, 766, 48, 48) },
      ],
      [s.img],
      [cap],
    );
    const notes: string[] = [];
    applyStructure(tree, { model, evidence }, notes);
    const ts = new TokenSet(tree);
    expect(styleOf(ts, "component.nav-bar.style.placement")).toBe("floating");
    expect(styleOf(ts, "component.nav-bar.style.labels")).toBe("none");
    expect(styleOf(ts, "component.nav-bar.style.indicator")).toBe("pill");
    expect(styleOf(ts, "component.top-bar.style.title")).toBe("large");
    expect(ts.get("component.nav-bar.radius")?.authored).toBe("{radius.pill}");
    expect(ts.dimension("component.nav-bar.indicator-size")).toBe(44);
    expect(notes.join("\n")).toMatch(/Corrected by the pixels: BottomNav placement: the model said docked, but the bar is inset 100\/100px/);
    expect(isValid(validateTree(tree))).toBe(true);
  });

  it("measures the active marker's width and the list's row height", () => {
    const ts = new TokenSet(structuredClone(tokens) as unknown as Tree);
    const styles = (p: string) => (p === "component.nav-bar.style.indicator" ? "pill" : p === "component.list-item.style.leading" ? "bare" : "");
    const list = (heights: number[]) => ({ rows: heights.length, heights, leading: [], divider: [], chevron: [] });
    const m = measuredTokens({ navActive: { w: 91, h: 59, radius: 29, pill: true, fill: "#E9E9E9" }, list: list([70, 71, 69]) }, ts, styles);
    expect(m["component.nav-bar.indicator-width"]).toBe("91px");
    expect(m["component.nav-bar.indicator-size"]).toBe("59px");
    expect(m["component.list-item.min-height"]).toBe("70px");
    // Rows that don't agree say nothing about the row height.
    expect(measuredTokens({ list: list([56, 90]) }, ts, styles)["component.list-item.min-height"]).toBeUndefined();
  });

  it("ignores what the model can't see, values it can't draw, and components the designer didn't choose", () => {
    const tree = structuredClone(tokens) as unknown as Tree;
    const model = { "nav-bar": { visible: false, placement: "floating", labels: "none", indicator: "pill", evidence: "" }, tabs: { visible: true, indicator: "sideways", evidence: "" }, "top-bar": { visible: true, title: "start", evidence: "" } } as unknown as StructureResult;
    applyStructure(tree, { model, chosen: new Set(["component.nav-bar", "component.tabs"]) }, []);
    const ts = new TokenSet(tree);
    expect(styleOf(ts, "component.nav-bar.style.placement")).toBe("docked");
    expect(styleOf(ts, "component.tabs.style.indicator")).toBe("underline");
    expect(styleOf(ts, "component.top-bar.style.title")).toBe("center");
  });

  it("builds a valid system from an extraction with structure, and from older recordings without", () => {
    const f = { ...(foundations as unknown as FoundationsResult), structure: { "nav-bar": { visible: true, placement: "floating", labels: "active", indicator: "pill", evidence: "" } } as unknown as StructureResult };
    const ds = designSystemFromExtraction({ foundations: f });
    expect(isValid(validateTree(ds.tree))).toBe(true);
    expect(styleOf(new TokenSet(ds.tree), "component.nav-bar.style.placement")).toBe("floating");
    const old = designSystemFromExtraction({ foundations: foundations as unknown as FoundationsResult });
    expect(styleOf(new TokenSet(old.tree), "component.nav-bar.style.placement")).toBe("docked");
    expect(old.notes?.join(" ") ?? "").not.toMatch(/fell back.*style/);
  });
});
