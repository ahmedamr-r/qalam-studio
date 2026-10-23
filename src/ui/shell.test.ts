import { describe, expect, it } from "vitest";
import { emptyDoc, type Doc, type SceneNode } from "@/doc/schema";
import { makeFrame, makePath, makeShape } from "@/doc/factory";
import { frameCount, motionArmed, railMarked } from "./shell";

function docOf(...nodes: SceneNode[]): Doc {
  const doc = emptyDoc();
  for (const n of nodes) {
    doc.nodes[n.id] = n;
    doc.roots.push(n.id);
  }
  return doc;
}

describe("frameCount", () => {
  it("counts top-level frames only", () => {
    expect(frameCount(emptyDoc())).toBe(0);
    expect(frameCount(docOf(makePath("M0 0 L10 10"), makePath("M0 0 L5 5")))).toBe(0);
    expect(frameCount(docOf(makeFrame(), makeShape("rect"), makeFrame()))).toBe(2);
  });

  it("leaves groups out", () => {
    const group = makeFrame();
    group.meta.group = true;
    expect(frameCount(docOf(group, makeFrame()))).toBe(1);
  });
});

describe("railMarked", () => {
  it("marks the open panel, or nothing when collapsed", () => {
    expect(railMarked(null, true, "layers")).toBe("layers");
    expect(railMarked(null, false, "layers")).toBeNull();
  });

  it("lets an open workspace stand in for its panel", () => {
    expect(railMarked("tokens", false, "layers")).toBe("tokens");
    expect(railMarked("components", true, "layers")).toBe("components");
  });
});

describe("motionArmed", () => {
  it("is false without a DOM", () => {
    expect(motionArmed()).toBe(false);
  });
});
