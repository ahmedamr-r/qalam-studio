import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { studio, useStudio } from "./store";
import { emptyDoc, type Doc, type FrameNode, type SceneNode, type TextNode } from "./schema";
import { makeFrame, makeIcon, makeShape, makeText } from "./factory";
import { apply, localMatrix, placementOf, worldBounds, worldCorners, worldMatrix, type Pt } from "./geometry";
import { insertNodes, reparent } from "./ops";
import { fitGroups, groupSelection, isGroup, resizeToFit, ungroupSelection } from "./group";
import { flipNodes, scaleTree } from "./transform";
import { tidyLayout, tidyUp } from "./align";
import { matchingOf } from "./select";
import { copyProps, pasteProps } from "./props-clipboard";
import { detachInstances, instanceRootOf } from "./layer-ops";
import { listLines, toggleDecoration, toggleItalic, toggleJustify, toggleList } from "./text-ops";
import { ensureYoga, setAutoLayoutEnabled } from "./autolayout";
import { setTextMeasurer } from "./measure";
import { wrappingMeasurer } from "./autolayout.fixtures";
import { deepestFrame, hitPath, pickTarget } from "@/engine/hit-test";

const node = (id: string) => studio().doc.nodes[id];
const close = (a: Pt[], b: Pt[]) => a.forEach((p, i) => (expect(p.x).toBeCloseTo(b[i].x, 4), expect(p.y).toBeCloseTo(b[i].y, 4)));

/** A screen with three rectangles side by side (a, b, c). */
function scene() {
  const f = makeFrame({ name: "Screen", x: 100, y: 50, w: 400, h: 800 });
  const kids = ["a", "b", "c"].map((name, i) => makeShape("rect", { name, x: 10 + i * 50, y: 10 + i * 5, w: 20, h: 30, parentId: f.id }));
  f.children = kids.map((k) => k.id);
  const doc: Doc = emptyDoc();
  for (const n of [f, ...kids] as SceneNode[]) doc.nodes[n.id] = n;
  doc.roots = [f.id];
  useStudio.setState({ doc, past: [], future: [], txBase: null, selection: [] });
  const [a, b, c] = kids.map((k) => k.id);
  return { f: f.id, a, b, c };
}

beforeAll(async () => {
  await ensureYoga();
  setTextMeasurer(wrappingMeasurer);
  setAutoLayoutEnabled(true);
});

describe("flips", () => {
  let ids: ReturnType<typeof scene>;
  beforeEach(() => (ids = scene()));

  it("folds flips into the local matrix and reads them back as flipH + rotation", () => {
    const m = localMatrix({ x: 10, y: 20, w: 40, h: 10, rotation: 0, flipH: true });
    expect(apply(m, { x: 0, y: 0 })).toEqual({ x: 50, y: 20 });
    // A vertical flip is a horizontal flip turned 180°, the way Figma shows it.
    const v = placementOf(localMatrix({ x: 10, y: 20, w: 40, h: 10, rotation: 0, flipV: true }), 40, 10);
    expect(v).toEqual({ x: 10, y: 20, rotation: 180, flipH: true });
    const r = placementOf(localMatrix({ x: 5, y: 6, w: 40, h: 10, rotation: 30, flipH: true }), 40, 10);
    expect(r.flipH).toBe(true);
    expect(r.rotation).toBeCloseTo(30, 6);
  });

  it("⇧H flips one layer in place; twice is back to the start", () => {
    const before = worldCorners(studio().doc, ids.a);
    flipNodes([ids.a], "h");
    expect(node(ids.a)).toMatchObject({ x: 10, y: 10, rotation: 0, flipH: true });
    const after = worldCorners(studio().doc, ids.a);
    close([after[0], after[1]], [before[1], before[0]]);
    flipNodes([ids.a], "h");
    expect(node(ids.a).flipH).toBeUndefined();
    expect(node(ids.a)).toMatchObject({ x: 10, y: 10, rotation: 0 });
  });

  it("⇧V on a rotated layer mirrors it across the horizontal line", () => {
    studio().mutate((d) => void (d.nodes[ids.a].rotation = 30));
    flipNodes([ids.a], "v");
    expect(node(ids.a).flipH).toBe(true);
    expect(node(ids.a).rotation).toBeCloseTo(150, 6);
    expect(worldBounds(studio().doc, ids.a).y).toBeCloseTo(worldBounds(useStudio.getState().past.at(-1)!, ids.a).y, 4);
  });

  it("several layers swap places across the selection's centre", () => {
    flipNodes([ids.a, ids.c], "h");
    expect(node(ids.a).x).toBe(110);
    expect(node(ids.c).x).toBe(10);
  });

  it("reparenting keeps a flipped layer where it is", () => {
    flipNodes([ids.a], "h");
    studio().mutate((d) => void (d.nodes[ids.f].rotation = 15));
    const before = worldCorners(studio().doc, ids.a);
    reparent([ids.a], null);
    close(worldCorners(studio().doc, ids.a), before);
    expect(node(ids.a).flipH).toBe(true);
  });
});

describe("groups", () => {
  let ids: ReturnType<typeof scene>;
  beforeEach(() => (ids = scene()));

  it("⌘G wraps the layers in a hugging group without moving them", () => {
    const before = [ids.a, ids.b].map((id) => worldCorners(studio().doc, id));
    const g = groupSelection([ids.b, ids.a])!;
    const group = node(g) as FrameNode;
    expect(isGroup(group)).toBe(true);
    expect(group).toMatchObject({ x: 10, y: 10, w: 70, h: 35, clip: false, fill: null, parentId: ids.f });
    // Paint order kept, and the group sits where the top-most of them was.
    expect(group.children).toEqual([ids.a, ids.b]);
    expect(node(ids.f).children).toEqual([g, ids.c]);
    [ids.a, ids.b].forEach((id, i) => close(worldCorners(studio().doc, id), before[i]));
    expect(studio().selection).toEqual([g]);
    expect(studio().past).toHaveLength(1);
  });

  it("follows its children: moving one grows the group and leaves the others in place", () => {
    const g = groupSelection([ids.a, ids.b])!;
    const bWorld = worldCorners(studio().doc, ids.b);
    studio().mutate((d) => void (d.nodes[ids.a].x -= 30));
    expect(node(g)).toMatchObject({ x: -20, w: 100 });
    close(worldCorners(studio().doc, ids.b), bWorld);
    expect(worldBounds(studio().doc, ids.a).x).toBe(100 + 10 - 30);
  });

  it("resizing the group scales its children into the new box", () => {
    const g = groupSelection([ids.a, ids.b])!;
    studio().mutate((d) => void (d.nodes[g].w = 140));
    expect(node(ids.a)).toMatchObject({ x: 0, w: 40 });
    expect(node(ids.b)).toMatchObject({ x: 100, w: 40 });
    expect(node(g).w).toBe(140);
  });

  it("a drag scales from where it started, so rounding never adds up", () => {
    const g = groupSelection([ids.a, ids.b])!;
    studio().beginTx();
    for (const w of [73, 81, 97, 103, 105]) studio().mutate((d) => void (d.nodes[g].w = w));
    studio().commitTx();
    expect(node(ids.a).w).toBe(30);
    expect(node(ids.b)).toMatchObject({ x: 75, w: 30 });
    expect(studio().past).toHaveLength(2);
  });

  it("disappears when its last layer goes", () => {
    const g = groupSelection([ids.a])!;
    studio().mutate((d) => {
      d.nodes[g].children = [];
      delete d.nodes[ids.a];
    });
    expect(node(g)).toBeUndefined();
    expect(node(ids.f).children).toEqual([ids.b, ids.c]);
  });

  it("⇧⌘G releases the layers where the group was, keeping flips and rotation", () => {
    const g = groupSelection([ids.a, ids.b])!;
    studio().mutate((d) => void (d.nodes[g].rotation = 20));
    flipNodes([g], "h");
    const before = [ids.a, ids.b].map((id) => worldCorners(studio().doc, id));
    expect(ungroupSelection([g])).toEqual([ids.a, ids.b]);
    expect(node(g)).toBeUndefined();
    expect(node(ids.f).children).toEqual([ids.a, ids.b, ids.c]);
    [ids.a, ids.b].forEach((id, i) => close(worldCorners(studio().doc, id), before[i]));
    expect(node(ids.a).flipH).toBe(true);
  });

  it("ungroups inside auto layout: the layers take the group's slot", () => {
    studio().mutate((d) => {
      (d.nodes[ids.f] as FrameNode).layout = { direction: "vertical", wrap: false, gap: 10, crossGap: 0, padding: { top: 0, end: 0, bottom: 0, start: 0 }, justify: "start", align: "start" };
    });
    const g = groupSelection([ids.a, ids.b])!;
    expect(node(ids.f).children).toEqual([g, ids.c]);
    ungroupSelection([g]);
    expect(node(ids.f).children).toEqual([ids.a, ids.b, ids.c]);
    expect([node(ids.a).y, node(ids.b).y, node(ids.c).y]).toEqual([0, 40, 80]);
  });

  it("is one layer to click until entered; it gives nothing to drop into", () => {
    const g = groupSelection([ids.a, ids.b])!;
    const doc = studio().doc;
    const path = hitPath(doc, { x: 100 + 15, y: 50 + 15 })!;
    expect(path).toEqual([ids.f, g, ids.a]);
    expect(pickTarget(doc, path, [], false)).toBe(g);
    expect(pickTarget(doc, path, [ids.b], false)).toBe(ids.a);
    expect(pickTarget(doc, path, [], true)).toBe(ids.a);
    expect(deepestFrame(doc, path)).toBe(ids.f);
    // The gap between its layers isn't the group.
    expect(hitPath(doc, { x: 100 + 40, y: 50 + 12 })).toEqual([ids.f]);
    // A group on the canvas itself is still picked whole.
    reparent([g], null);
    const top = hitPath(studio().doc, worldBounds(studio().doc, ids.a))!;
    expect(pickTarget(studio().doc, top, [], false)).toBe(g);
  });

  it("fitGroups leaves untouched documents alone", () => {
    groupSelection([ids.a, ids.b]);
    const doc = studio().doc;
    const same = { ...doc, nodes: { ...doc.nodes } };
    expect(fitGroups(doc, same)).toBe(same);
  });
});

describe("resize to fit", () => {
  it("shrinks a frame to its layers without moving them", () => {
    const ids = scene();
    const before = worldCorners(studio().doc, ids.c);
    expect(resizeToFit([ids.f])).toBe(1);
    expect(node(ids.f)).toMatchObject({ x: 110, y: 60, w: 120, h: 40 });
    close(worldCorners(studio().doc, ids.c), before);
    expect(resizeToFit([ids.f])).toBe(0);
  });
});

describe("tidy up", () => {
  it("lays boxes out on a grid with the median gap", () => {
    const b = (x: number, y: number, w = 20, h = 20) => ({ x, y, w, h });
    const spots = tidyLayout([
      { id: "a", b: b(0, 0) },
      { id: "b", b: b(33, 3) },
      { id: "c", b: b(58, -2) },
      { id: "d", b: b(2, 50) },
      { id: "e", b: b(31, 49) },
    ]);
    // Gaps today: 13, 5 and 9 across, 26 down → 9 and 26.
    expect(Object.fromEntries(spots)).toEqual({
      a: { x: 0, y: -2 },
      b: { x: 29, y: -2 },
      c: { x: 58, y: -2 },
      d: { x: 0, y: 44 },
      e: { x: 29, y: 44 },
    });
  });

  it("moves the layers in their frame, in one step", () => {
    const ids = scene();
    expect(tidyUp([ids.a, ids.b, ids.c])).toBe(3);
    expect([ids.a, ids.b, ids.c].map((id) => node(id).y)).toEqual([10, 10, 10]);
    expect(studio().past).toHaveLength(1);
  });
});

describe("selection, properties and instances", () => {
  it("⌥⌘A selects layers that look the same", () => {
    const ids = scene();
    const odd = makeShape("rect", { fill: { color: "#FF0000" } });
    insertNodes([odd], ids.f, undefined, false);
    expect(matchingOf(studio().doc, [ids.a])).toEqual([ids.a, ids.b, ids.c]);
    expect(matchingOf(studio().doc, [odd.id])).toEqual([odd.id]);
  });

  it("⌥⌘C / ⌥⌘V copy a look across, as each layer allows", () => {
    const ids = scene();
    const t = makeText({ text: { content: "Hi", fontSize: 14 } });
    insertNodes([t], ids.f, undefined, false);
    studio().mutate((d) => {
      const a = d.nodes[ids.a];
      a.fill = { color: "#112233" };
      a.stroke = { color: "#445566", width: 3 };
      a.opacity = 0.5;
    });
    expect(copyProps([ids.a])).toBe(true);
    expect(pasteProps([ids.b, t.id])).toBe(2);
    expect(node(ids.b)).toMatchObject({ fill: { color: "#112233" }, stroke: { width: 3 }, opacity: 0.5 });
    // Text keeps its type and never takes a stroke.
    expect(node(t.id)).toMatchObject({ fill: { color: "#112233" }, stroke: null, opacity: 0.5 });
    expect((node(t.id) as TextNode).text.fontSize).toBe(14);
    expect(studio().past.length).toBe(3);
  });

  it("⌥⌘B detaches the instance a layer belongs to", () => {
    const ids = scene();
    studio().mutate((d) => {
      d.nodes[ids.f].meta.specPath = "body.0";
      d.nodes[ids.f].meta.component = "Card";
      d.nodes[ids.f].meta.instFingerprint = "x";
    });
    expect(instanceRootOf(studio().doc, ids.a)).toBe(ids.f);
    expect(detachInstances([ids.a])).toBe(1);
    expect(node(ids.f).meta).toEqual({ source: "user" });
    expect(instanceRootOf(studio().doc, ids.a)).toBeNull();
  });
});

describe("text styles", () => {
  let t: string;
  beforeEach(() => {
    useStudio.setState({ doc: emptyDoc(), past: [], future: [], txBase: null, selection: [] });
    const n = makeText({ text: { content: "one\ntwo\n\nthree" } });
    insertNodes([n], null);
    t = n.id;
  });
  const text = () => (node(t) as TextNode).text;

  it("toggles underline, strikethrough, italic and justify", () => {
    expect(toggleDecoration([t], "underline")).toBe(true);
    expect(text().decoration).toBe("underline");
    expect(toggleDecoration([t], "strikethrough")).toBe(true);
    expect(text().decoration).toBe("strikethrough");
    expect(toggleDecoration([t], "strikethrough")).toBe(false);
    expect(text().decoration).toBeUndefined();
    toggleItalic([t]);
    expect(text().italic).toBe(true);
    toggleItalic([t]);
    expect(text().italic).toBeUndefined();
    toggleJustify([t]);
    expect(text().align).toBe("justify");
    toggleJustify([t]);
    expect(text().align).toBe("start");
    // Styling never detaches the type style.
    expect(text().typeToken).toBe("type.body");
  });

  it("adds and removes list markers per line", () => {
    expect(listLines("one\ntwo\n\nthree", "bullet")).toBe("• one\n• two\n\n• three");
    expect(listLines("• one\n• two", "bullet")).toBe("one\ntwo");
    expect(listLines("• one\n• two", "number")).toBe("1. one\n2. two");
    toggleList([t], "number");
    expect(text().content).toBe("1. one\n2. two\n\n3. three");
  });
});

describe("scale tool", () => {
  it("scales strokes, corners, type, effects, spacing and every layer inside", () => {
    const f = makeFrame({ x: 0, y: 0, w: 100, h: 50, stroke: { color: "#000000", width: 2, widthToken: "border-width.default" }, effects: [{ kind: "drop", x: 0, y: 2, blur: 4, spread: 0, color: "#00000033" }] });
    f.radius = { linked: true, circular: true, tl: { rx: 8, ry: 8 }, tr: { rx: 8, ry: 8 }, br: { rx: 8, ry: 8 }, bl: { rx: 8, ry: 8 }, token: "radius.md" };
    const t = makeText({ x: 10, y: 10, w: 40, h: 20, text: { content: "Hi", fontSize: 14, lineHeight: 20 }, parentId: f.id });
    const icon = makeIcon("star", { x: 60, y: 10, parentId: f.id });
    f.children = [t.id, icon.id];
    const base: Doc = { nodes: { [f.id]: f, [t.id]: t, [icon.id]: icon }, roots: [f.id] };
    const d: Doc = JSON.parse(JSON.stringify(base));
    d.nodes[f.id].w = 200;
    d.nodes[f.id].h = 100;
    scaleTree(d, base, f.id, 2);
    expect(d.nodes[f.id].stroke).toEqual({ color: "#000000", width: 4 });
    expect(d.nodes[f.id].radius).toMatchObject({ tl: { rx: 16, ry: 16 } });
    expect(d.nodes[f.id].radius?.token).toBeUndefined();
    expect(d.nodes[f.id].effects?.[0]).toMatchObject({ y: 4, blur: 8 });
    expect(d.nodes[t.id]).toMatchObject({ x: 20, y: 20, w: 80, h: 40 });
    expect((d.nodes[t.id] as TextNode).text).toMatchObject({ fontSize: 28, lineHeight: 40, typeToken: undefined });
    expect(d.nodes[icon.id]).toMatchObject({ x: 120, y: 20, w: 48, h: 48 });
    // Back to 1: tokens come back as they were.
    scaleTree(d, base, f.id, 1);
    expect(d.nodes[f.id].stroke).toEqual(base.nodes[f.id].stroke);
    expect(worldMatrix(d, t.id)).toEqual(worldMatrix(base, t.id));
  });
});
