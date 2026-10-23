import { describe, expect, it } from "vitest";
import { studio, useStudio } from "./store";
import { emptyDoc, type SceneNode } from "./schema";
import { makeFrame, makeShape } from "./factory";
import { worldBounds } from "./geometry";
import { rotateNodes } from "./rotate";

/** A screen holding a 40 × 20 bar (a) and a square (b) to its right. */
function scene() {
  const f = makeFrame({ name: "Screen", x: 100, y: 50, w: 400, h: 400 });
  const a = makeShape("rect", { name: "a", x: 0, y: 0, w: 40, h: 20, parentId: f.id });
  const b = makeShape("rect", { name: "b", x: 100, y: 0, w: 20, h: 20, parentId: f.id });
  f.children = [a.id, b.id];
  const doc = emptyDoc();
  for (const n of [f, a, b] as SceneNode[]) doc.nodes[n.id] = n;
  doc.roots = [f.id];
  useStudio.setState({ doc, past: [], future: [], txBase: null, selection: [] });
  return { a: a.id, b: b.id };
}

describe("rotate 90°", () => {
  it("turns one layer about its centre", () => {
    const { a } = scene();
    expect(rotateNodes([a], 90)).toBe(1);
    expect(studio().doc.nodes[a]).toMatchObject({ x: 0, y: 0, w: 40, h: 20, rotation: 90 });
    const box = worldBounds(studio().doc, a);
    expect(box.w).toBeCloseTo(20, 6);
    expect(box.h).toBeCloseTo(40, 6);
  });

  it("turns several layers about the selection's centre, so they swap places", () => {
    const { a, b } = scene();
    rotateNodes([a, b], 180);
    // Bounds 0…120: the bar lands on the right, the square on the left.
    expect(worldBounds(studio().doc, a).x).toBeCloseTo(100 + 80, 6);
    expect(worldBounds(studio().doc, b).x).toBeCloseTo(100, 6);
    expect(useStudio.getState().past).toHaveLength(1);
  });

  it("leaves locked layers alone", () => {
    const { a } = scene();
    studio().mutate((d) => void (d.nodes[a].locked = true));
    expect(rotateNodes([a], 90)).toBe(0);
  });
});
