import { describe, expect, it } from "vitest";
import { BUILTIN } from "./resolve";
import { cleanReading, componentName, cutTexts, overflowing, fidelity, keepRevision, missingColours, nearestRoles, patternFromReading, snapWidth, type Pixels } from "./component-import";
import type { SceneNode } from "@/doc/schema";
import { setTextMeasurer } from "@/doc/measure";

type RGB = [number, number, number];

/** A test image: `paint` gives each pixel's colour, or null for transparent. */
function image(width: number, height: number, paint: (x: number, y: number) => RGB | null): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const c = paint(x, y);
      const o = (y * width + x) * 4;
      if (c) [data[o], data[o + 1], data[o + 2], data[o + 3]] = [...c, 255];
    }
  return { width, height, data };
}

const WHITE: RGB = [255, 255, 255];
const INK: RGB = [28, 28, 28];
const GREEN: RGB = [0, 231, 132];

/** A card: a green picture on the left, two dark text bars on the right. */
const card = (w: number, h: number, margin = 0, bg: RGB = WHITE) =>
  image(w + margin * 2, h + margin * 2, (x0, y0) => {
    const x = x0 - margin,
      y = y0 - margin;
    if (x < 0 || y < 0 || x >= w || y >= h) return bg;
    if (x >= w * 0.04 && x < w * 0.3 && y >= h * 0.15 && y < h * 0.85) return GREEN;
    if (x >= w * 0.36 && x < w * 0.8 && y >= h * 0.25 && y < h * 0.38) return INK;
    if (x >= w * 0.36 && x < w * 0.6 && y >= h * 0.55 && y < h * 0.65) return INK;
    return [244, 244, 245];
  });

const text = (t: string) => ({ component: "Text", props: { text: t, style: "body" } });

describe("component names", () => {
  it("keeps the model's name when it's free", () => {
    expect(componentName("Ride Option", [])).toBe("Ride Option");
  });

  it("never takes a catalog component's name", () => {
    expect(componentName("Button", [], { systemName: "Talabat" })).toBe("Talabat Button");
    expect(componentName("ListItem", [])).not.toBe("ListItem");
  });

  it("numbers a name the system already has, matching loosely", () => {
    expect(componentName("Ride option", ["RideOption"])).toBe("Ride option 2");
    expect(componentName("Ride Option", ["Ride Option", "Ride Option 2"])).toBe("Ride Option 3");
  });

  it("keeps the name of the component a revision replaces", () => {
    expect(componentName("Something else", ["Ride Option"], { keep: "Ride Option" })).toBe("Ride Option");
  });
});

describe("cleaning Qalam AI's reading", () => {
  const reading = {
    read: "A ride option row.",
    name: "Ride Option",
    purpose: "One ride type with its fare.",
    width: 358,
    props: [
      { name: "title", kind: "text", maxChars: 24, example: "Comfort" },
      { name: "unused", kind: "text", maxChars: 24, example: "Never shown" },
    ],
    composition: { component: "Stack", props: { direction: "horizontal" }, children: [text("{title}"), text("AED 24.50")] },
    guide: { whenToUse: ["Choosing a ride"], whenNotToUse: [], content: "", placement: "", states: "", dos: [], donts: [] },
    differences: [{ part: "Fare", note: "The screenshot's fare is orange; drawn with text.brand." }, { part: "", note: "" }],
  };

  it("keeps declared props the composition shows and drops the rest", () => {
    const r = cleanReading(reading, { taken: [] });
    if ("error" in r) throw new Error(r.error);
    expect(r.def.props?.map((p) => p.name)).toEqual(["title"]);
    expect(r.differences).toHaveLength(1);
  });

  it("reads props from the parts when none are declared", () => {
    const r = cleanReading({ ...reading, props: [] }, { taken: [] });
    if ("error" in r) throw new Error(r.error);
    expect(r.def.props?.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.def.composition)).toContain("{value}");
  });

  it("refuses parts outside the catalog, and a system component nested inside", () => {
    expect(cleanReading({ ...reading, composition: { component: "Marquee", props: {} } }, { taken: [] })).toHaveProperty("error");
    expect(cleanReading({ ...reading, composition: { component: "Stack", props: {}, children: [{ component: "Custom", props: { name: "Rating" } }] } }, { taken: [] })).toHaveProperty("error");
    expect(cleanReading({ ...reading, composition: undefined }, { taken: [] })).toHaveProperty("error");
  });

  it("becomes a system component that keeps its screenshot and its guide", () => {
    const r = cleanReading(reading, { taken: [] });
    if ("error" in r) throw new Error(r.error);
    const p = patternFromReading(r, "asset:abc");
    expect(p.reference).toBe("asset:abc");
    expect(p.guide.observed).toBe(true);
    expect(p.guide.whenToUse).toEqual(["Choosing a ride"]);
    expect(p.guide.anatomy.length).toBeGreaterThan(0);
  });
});

describe("measured colours against the system's roles", () => {
  it("finds the role a colour is, and says how far the nearest one is when none is", () => {
    const role = BUILTIN.semanticColors().find((t) => typeof t.value === "string" && /^#[0-9A-F]{6}$/.test(t.value as string))!;
    const [same] = nearestRoles([role.value as string], BUILTIN);
    expect(same.deltaE).toBe(0);
    expect(BUILTIN.color(same.role)?.slice(0, 7)).toBe((role.value as string).slice(0, 7));
    const [far] = nearestRoles(["#7A00FF"], BUILTIN);
    expect(far.deltaE).toBeGreaterThan(0);
  });
});

describe("the component's width at 1x", () => {
  it("snaps the model's judgement to the screenshot's 1x, 2x or 3x width", () => {
    expect(snapWidth(360, 1074)).toEqual({ width: 358, scale: 3 });
    expect(snapWidth(520, 1074)).toEqual({ width: 537, scale: 2 });
    expect(snapWidth(0, 1074).scale).toBe(2);
  });
});

describe("fidelity to the screenshot", () => {
  it("scores a faithful drawing near zero, margins and transparency aside", () => {
    const shot = card(300, 80, 24);
    // Drawn tight, on a transparent frame wider than the component (the preview pads for shadows).
    const tight = card(300, 80);
    const render = image(340, 120, (x, y) => {
      if (x < 20 || y < 20 || x >= 320 || y >= 100) return null;
      const o = ((y - 20) * 300 + (x - 20)) * 4;
      return [tight.data[o], tight.data[o + 1], tight.data[o + 2]];
    });
    expect(fidelity(shot, render).score).toBeLessThan(2);
  });

  it("costs more for a missing part, a different shape or a wrong fill", () => {
    const shot = card(300, 80);
    const same = fidelity(shot, card(300, 80)).score;
    const noPicture = fidelity(
      shot,
      image(300, 80, (x, y) => {
        const o = (y * 300 + x) * 4;
        return x < 90 ? [244, 244, 245] : [shot.data[o], shot.data[o + 1], shot.data[o + 2]];
      }),
    ).score;
    const taller = fidelity(shot, card(300, 140)).score;
    const recoloured = fidelity(shot, image(300, 80, () => [0, 73, 62])).score;
    for (const worse of [noPicture, taller, recoloured]) expect(worse).toBeGreaterThan(same + 1);
  });

  it("keeps a correction only when it has fewer defects, else when it measures clearly closer", () => {
    const m = (score: number, broken = 0) => ({ fit: { score, colour: score, aspect: 0 }, broken });
    expect(keepRevision(m(10), m(6))).toBe(true);
    expect(keepRevision(m(10), m(9.8))).toBe(false);
    expect(keepRevision(m(10), { fit: null, broken: 0 })).toBe(false);
    expect(keepRevision({ fit: null, broken: 0 }, m(10))).toBe(true);
    // Closer in pixels but cutting labels off: broken, so not kept; fixing the defects wins even if the picture moves.
    expect(keepRevision(m(10, 0), m(4, 3))).toBe(false);
    expect(keepRevision(m(6, 3), m(9, 0))).toBe(true);
  });
});

describe("measuring the drawing", () => {
  const textNode = (content: string, w: number, maxLines?: number) =>
    ({ id: content, type: "text", w, h: 20, text: { content, fontSize: 16, fontWeight: 600, lineHeight: 20, letterSpacing: 0, align: "start", direction: "auto", autoSize: "height", ...(maxLines ? { maxLines } : {}) } }) as unknown as SceneNode;

  it("finds copy cut off to its lines, and leaves copy that fits", () => {
    // ~0.55em per character, wrapping at the width (the engine measures with CanvasKit).
    setTextMeasurer((t, w) => {
      const width = t.content.length * t.fontSize * 0.55;
      return { w: w === null ? width : Math.min(w, width), h: t.lineHeight * (w === null ? 1 : Math.max(1, Math.ceil(width / w))) };
    });
    try {
      expect(cutTexts([textNode("Top up", 20, 1), textNode("Top up", 200, 1), textNode("Wraps freely", 20)])).toEqual(["Top up"]);
    } finally {
      setTextMeasurer((t) => ({ w: t.content.length * t.fontSize * 0.55, h: t.lineHeight }));
    }
  });

  it("lists a gradient's colours once, not once per step", () => {
    const miss = (hex: string) => ({ hex, role: "bg.brand", roleHex: "#8E9CFF", deltaE: 30 });
    const out = missingColours([miss("#BB2793"), miss("#B52896"), miss("#BD2A90"), miss("#2C4A13"), { hex: "#8E9CFF", role: "bg.brand", roleHex: "#8E9CFF", deltaE: 0 }]);
    expect(out.map((c) => c.hex)).toEqual(["#BB2793", "#2C4A13"]);
  });
});

describe("parts that stick out", () => {
  const frame = (id: string, parentId: string | null, x: number, w: number, extra: Record<string, unknown> = {}) =>
    ({ id, type: "frame", name: id, parentId, children: [], x, y: 0, w, h: 40, ...extra }) as unknown as SceneNode;

  it("finds a part in the flow wider than its container, not one placed to overhang", () => {
    const nodes = [frame("Card", null, 0, 300), frame("Row", "Card", 16, 268), frame("Swap", "Row", 200, 98), frame("Badge", "Card", 280, 30, { absolute: true })];
    expect(overflowing(nodes)).toEqual([{ name: "Swap", by: 30 }]);
  });
});
