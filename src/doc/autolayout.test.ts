import { beforeAll, describe, expect, it } from "vitest";
import { produce } from "immer";
import { ensureYoga, relayoutAll, relayoutDoc, setAutoLayoutEnabled, sizingOf } from "./autolayout";
import { setTextMeasurer } from "./measure";
import { wrappingMeasurer } from "./autolayout.fixtures";
import { makeFrame, makeShape, makeText } from "./factory";
import type { AutoLayout, Doc, FrameNode, SceneNode } from "./schema";

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

/** A document with one auto-layout frame (id "f") and children "a", "b", "c"… */
function docWith(frame: Partial<FrameNode>, kids: Partial<SceneNode>[]): Doc {
  const f = makeFrame({ id: "f", name: "F", x: 100, y: 50, w: 300, h: 200, fill: null, ...frame });
  const nodes: Record<string, SceneNode> = { f };
  kids.forEach((k, i) => {
    const id = String.fromCharCode(97 + i);
    const n = k.type === "text" ? makeText({ ...(k as object), id, parentId: "f" }) : makeShape("rect", { w: 50, h: 20, ...(k as object), id, parentId: "f" });
    nodes[id] = n;
    f.children.push(id);
  });
  return relayoutAll({ nodes, roots: ["f"] });
}

const edit = (doc: Doc, recipe: (d: Doc) => void) => relayoutDoc(doc, produce(doc, recipe));
const box = (d: Doc, id: string) => [d.nodes[id].x, d.nodes[id].y, d.nodes[id].w, d.nodes[id].h];

beforeAll(async () => {
  await ensureYoga();
  setTextMeasurer(wrappingMeasurer);
  setAutoLayoutEnabled(true);
});

describe("auto layout engine", () => {
  it("stacks vertically with gap and padding, hugging its content", () => {
    const d = docWith({ layout: layout({ gap: 8, padding: { top: 10, end: 20, bottom: 30, start: 40 } }), sizeH: "hug", sizeV: "hug" }, [{}, {}, { w: 80 }]);
    expect(box(d, "a")).toEqual([40, 10, 50, 20]);
    expect(box(d, "b")).toEqual([40, 38, 50, 20]);
    expect(box(d, "c")).toEqual([40, 66, 80, 20]);
    expect(box(d, "f")).toEqual([100, 50, 140, 116]);
  });

  it("flows right to left in RTL frames, with logical padding", () => {
    const d = docWith({ dir: "rtl", layout: layout({ direction: "horizontal", gap: 10, padding: { top: 0, end: 20, bottom: 0, start: 10 } }) }, [{}, {}]);
    expect(d.nodes.a.x).toBe(300 - 10 - 50);
    expect(d.nodes.b.x).toBe(300 - 10 - 50 - 10 - 50);
  });

  it("spaces items apart (Auto) and aligns them on the cross axis", () => {
    const d = docWith({ layout: layout({ direction: "horizontal", justify: "between", align: "center", gap: 12 }), h: 100 }, [{}, { h: 40 }]);
    expect(box(d, "a")).toEqual([0, 40, 50, 20]);
    expect(box(d, "b")).toEqual([250, 30, 50, 40]);
  });

  it("fills the container on both axes, sharing space by weight", () => {
    const d = docWith({ layout: layout({ direction: "horizontal", gap: 0 }), h: 100 }, [{ sizeH: "fill" }, { sizeH: "fill", grow: 2, sizeV: "fill" }]);
    expect(box(d, "a")).toEqual([0, 0, 100, 20]);
    expect(box(d, "b")).toEqual([100, 0, 200, 100]);
  });

  it("doesn't collapse a filling text inside a hugging row", () => {
    const d = docWith({ layout: layout({ direction: "horizontal", gap: 4 }), sizeH: "hug", sizeV: "hug" }, [{ w: 30 }, { type: "text", text: { content: "Hello there" }, sizeH: "fill" } as Partial<SceneNode>]);
    expect(d.nodes.b.w).toBeGreaterThan(40);
    expect(d.nodes.f.w).toBe(30 + 4 + d.nodes.b.w);
  });

  it("wraps onto new lines with the cross gap", () => {
    const d = docWith({ layout: layout({ direction: "horizontal", wrap: true, gap: 10, crossGap: 5 }), w: 200, sizeV: "hug" }, [{ w: 60 }, { w: 60 }, { w: 60 }, { w: 60 }, { w: 60 }]);
    expect(box(d, "c")).toEqual([140, 0, 60, 20]);
    expect(box(d, "d")).toEqual([0, 25, 60, 20]);
    expect(d.nodes.f.h).toBe(45);
  });

  it("leaves absolute and hidden layers out of the flow", () => {
    const d = docWith({ layout: layout({ gap: 10 }) }, [{}, { absolute: true, x: 7, y: 9 }, { visible: false, x: 3, y: 3 }, {}]);
    expect(box(d, "b")).toEqual([7, 9, 50, 20]);
    expect([d.nodes.c.x, d.nodes.c.y]).toEqual([3, 3]);
    expect(d.nodes.d.y).toBe(30);
  });

  it("honours min and max sizes", () => {
    const d = docWith({ layout: layout(), sizeH: "hug", sizeV: "hug", minH: 120, maxW: 40 }, [{ w: 50 }]);
    expect(d.nodes.f.h).toBe(120);
    expect(d.nodes.f.w).toBe(40);
  });

  it("wraps text to a fixed-width column and grows the hugging frame", () => {
    const d = docWith({ layout: layout({ gap: 0 }), w: 120, sizeV: "hug" }, [{ type: "text", text: { content: "one two three four five six seven" }, sizeH: "fill" } as Partial<SceneNode>]);
    expect(d.nodes.a.w).toBe(120);
    expect(d.nodes.f.h).toBe(d.nodes.a.h);
    expect(d.nodes.a.h).toBeGreaterThan(d.nodes.a.h / 2 + 1); // more than one line
  });
});

describe("relayout after edits", () => {
  it("reflows siblings and hugging ancestors when a text changes", () => {
    const inner = makeFrame({ id: "inner", name: "Inner", fill: null, parentId: "f", layout: layout({ direction: "horizontal", gap: 4 }), sizeH: "hug", sizeV: "hug" });
    const t = makeText({ id: "t", parentId: "inner", text: { content: "Hi" } });
    const r = makeShape("rect", { id: "r", parentId: "f", w: 50, h: 20 });
    const f = makeFrame({ id: "f", name: "F", fill: null, layout: layout({ gap: 10 }), sizeH: "hug", sizeV: "hug", children: ["inner", "r"] });
    inner.children = ["t"];
    let d = relayoutAll({ nodes: { f, inner, t, r }, roots: ["f"] });
    const y0 = d.nodes.r.y;
    d = edit(d, (x) => void ((x.nodes.t as { text: { content: string } }).text.content = "Hi\nthere"));
    d = edit(d, (x) => {
      const n = x.nodes.t;
      if (n.type === "text") n.text = { ...n.text, lineHeight: n.text.lineHeight * 2 };
    });
    expect(d.nodes.inner.h).toBe(d.nodes.t.h);
    expect(d.nodes.r.y).toBe(d.nodes.inner.h + 10);
    expect(d.nodes.r.y).toBeGreaterThan(y0);
  });

  it("returns the same document when nothing that affects layout changed", () => {
    const d = docWith({ layout: layout({ gap: 8 }) }, [{}, {}]);
    expect(relayoutAll(d)).toBe(d);
    const recolored = edit(d, (x) => void (x.nodes.a.fill = { color: "#FF0000" }));
    expect(recolored.nodes.b).toBe(d.nodes.b);
    expect(recolored.nodes.f).toBe(d.nodes.f);
  });

  it("snaps in-flow layers back but keeps absolute ones and moved screens", () => {
    const d = docWith({ layout: layout({ gap: 8 }) }, [{}, { absolute: true, x: 5, y: 5 }]);
    expect(edit(d, (x) => void (x.nodes.a.x += 30)).nodes.a.x).toBe(0);
    expect(edit(d, (x) => void (x.nodes.b.x += 30)).nodes.b.x).toBe(35);
    const moved = edit(d, (x) => void (x.nodes.f.x += 30));
    expect(moved.nodes.f.x).toBe(130);
    expect(moved.nodes.a).toBe(d.nodes.a);
  });

  it("drops fill when a layer leaves the flow", () => {
    const d = docWith({ layout: layout() }, [{ sizeH: "fill" }]);
    const out = edit(d, (x) => {
      x.nodes.f.children = [];
      x.nodes.a.parentId = null;
      x.roots.push("a");
    });
    expect(out.nodes.a.sizeH).toBe("fixed");
  });

  it("turns a flex weight into Fill when a layer moves to another parent", () => {
    const d = docWith({ layout: layout({ direction: "horizontal" }) }, [{ grow: 1, sizeH: "hug" }]);
    const col = makeFrame({ id: "col", name: "Col", fill: null, layout: layout(), w: 200, h: 100 });
    const out = edit({ ...d, nodes: { ...d.nodes, col }, roots: [...d.roots, "col"] }, (x) => {
      x.nodes.f.children = [];
      x.nodes.col.children = ["a"];
      x.nodes.a.parentId = "col";
    });
    expect([out.nodes.a.grow, out.nodes.a.sizeH, out.nodes.a.w]).toEqual([undefined, "fill", 200]);
  });

  it("keeps explicit text sizing in step with its autoSize", () => {
    const d = docWith({ layout: layout() }, [{ type: "text", text: { content: "Label" }, sizeH: "hug", sizeV: "hug" } as Partial<SceneNode>]);
    const out = edit(d, (x) => {
      const n = x.nodes.a;
      if (n.type === "text") n.text.autoSize = "fixed";
    });
    expect([out.nodes.a.sizeH, out.nodes.a.sizeV]).toEqual(["fixed", "fixed"]);
  });

  it("does nothing while disabled, then reports the missed edits", () => {
    const d = docWith({ layout: layout({ gap: 8 }) }, [{}, {}]);
    setAutoLayoutEnabled(false);
    const out = edit(d, (x) => void (x.nodes.a.h = 50));
    expect(out.nodes.b.y).toBe(28);
    expect(setAutoLayoutEnabled(true)).toBe(true);
    expect(relayoutAll(out).nodes.b.y).toBe(58);
  });

  it("treats fill outside auto layout and hug without content as fixed", () => {
    const d = docWith({ layout: layout() }, [{ sizeH: "fill", absolute: true }]);
    expect(sizingOf(d, d.nodes.a, "h")).toBe("fixed");
    const plain = makeFrame({ sizeH: "hug" });
    expect(sizingOf({ nodes: { [plain.id]: plain }, roots: [plain.id] }, plain, "h")).toBe("fixed");
  });
});
