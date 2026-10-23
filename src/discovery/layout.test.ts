import { describe, expect, it } from "vitest";
import { GAPS, layoutTree, type LayoutNode, type Orientation } from "./layout";

const node = (id: string, w: number, h: number, kids: LayoutNode[] = []): LayoutNode => ({ id, w, h, kids });

/** Deterministic pseudo-random trees (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomTree(seed: number, size: number): LayoutNode {
  const r = rng(seed);
  let n = 0;
  const make = (depth: number): LayoutNode => {
    const id = `n${n++}`;
    const kids: LayoutNode[] = [];
    const count = depth > 3 ? 0 : Math.floor(r() * (depth === 0 ? 5 : 4));
    for (let i = 0; i < count && n < size; i++) kids.push(make(depth + 1));
    return node(id, 200 + Math.round(r() * 120), 60 + Math.round(r() * 80), kids);
  };
  return make(0);
}

function all(n: LayoutNode): LayoutNode[] {
  return [n, ...n.kids.flatMap(all)];
}

function boxes(root: LayoutNode, o: Orientation) {
  const at = layoutTree(root, { orientation: o });
  return all(root).map((n) => ({ id: n.id, ...at.get(n.id)!, w: n.w, h: n.h }));
}

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;

describe("layoutTree", () => {
  it("puts a lone card at the origin", () => {
    expect(layoutTree(node("a", 240, 80), { orientation: "tb" }).get("a")).toEqual({ x: 0, y: 0 });
  });

  it("hangs children a level below, in order, with the parent centred over the outer two", () => {
    const root = node("r", 320, 100, [node("a", 240, 80), node("b", 240, 80), node("c", 240, 80)]);
    const at = layoutTree(root, { orientation: "tb" });
    const [a, b, c] = ["a", "b", "c"].map((id) => at.get(id)!);
    expect(a.y).toBe(100 + GAPS.tb.levelGap);
    expect(a.x < b.x && b.x < c.x).toBe(true);
    expect(b.x - (a.x + 240)).toBe(GAPS.tb.siblingGap);
    // Centre of the parent = midpoint of the first and last child's centres.
    expect(0 + 160).toBeCloseTo((a.x + 120 + c.x + 120) / 2);
  });

  it("leaves more room between branches than between leaves", () => {
    const root = node("r", 320, 100, [node("a", 240, 80, [node("a1", 200, 60)]), node("b", 240, 80)]);
    const at = layoutTree(root, { orientation: "tb" });
    expect(at.get("b")!.x - (at.get("a")!.x + 240)).toBe(GAPS.tb.branchGap);
  });

  it("never overlaps two cards, top-down or left-to-right", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const root = randomTree(seed, 60);
      for (const o of ["tb", "lr"] as const) {
        const list = boxes(root, o);
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(overlap(list[i], list[j]), `seed ${seed} ${o}: ${list[i].id} × ${list[j].id}`).toBe(false);
      }
    }
  });

  it("is the same tree on its side from left to right", () => {
    const root = randomTree(7, 30);
    const flip = (n: LayoutNode): LayoutNode => node(n.id, n.h, n.w, n.kids.map(flip));
    const tb = layoutTree(root, { orientation: "tb", ...GAPS.lr });
    const lr = layoutTree(flip(root), { orientation: "lr" });
    for (const [id, p] of tb) expect(lr.get(id)).toEqual({ x: p.y, y: p.x });
  });

  it("is deterministic", () => {
    const a = layoutTree(randomTree(3, 40), { orientation: "tb" });
    const b = layoutTree(randomTree(3, 40), { orientation: "tb" });
    expect([...a]).toEqual([...b]);
  });
});
