import { beforeEach, describe, expect, it } from "vitest";
import { studio, useStudio } from "./store";
import { emptyDoc, type Doc, type SceneNode } from "./schema";
import { makeShape } from "./factory";
import { groupSelection } from "./group";
import { apply, invert, parentWorldMatrix, worldBounds } from "./geometry";

/*
 * A group hugs its children after every edit, so a child dragged past the group's left or top edge
 * moves the group's origin (the space the child's x/y live in) mid-drag. Canvas drags therefore
 * keep where they started in world space and convert into the parent's space as it is on each
 * frame (engine/controller.ts); adding a delta to the start x/y drifts by the group's shift.
 */

function setup() {
  const a = makeShape("rect", { name: "a", x: 100, y: 100, w: 20, h: 20 });
  const b = makeShape("rect", { name: "b", x: 200, y: 140, w: 20, h: 20 });
  const doc: Doc = emptyDoc();
  for (const n of [a, b] as SceneNode[]) doc.nodes[n.id] = n;
  doc.roots = [a.id, b.id];
  useStudio.setState({ doc, past: [], future: [], txBase: null, selection: [] });
  const g = groupSelection([a.id, b.id])!;
  return { a: a.id, g };
}

/** The controller's move drag: each frame puts the layer's start world point, moved, into its parent's space now. */
function drag(id: string, steps: { x: number; y: number }[]) {
  const doc = studio().doc;
  const at = apply(parentWorldMatrix(doc, id), doc.nodes[id]);
  studio().beginTx();
  for (const d of steps) {
    studio().mutate((draft) => {
      const p = apply(invert(parentWorldMatrix(draft, id)), { x: at.x + d.x, y: at.y + d.y });
      draft.nodes[id].x = p.x;
      draft.nodes[id].y = p.y;
    });
  }
  studio().commitTx();
}

describe("dragging a layer inside a group", () => {
  beforeEach(() => useStudio.setState({ doc: emptyDoc(), past: [], future: [], txBase: null, selection: [] }));

  it("follows the pointer while the group grows past its left and top edges", () => {
    const { a, g } = setup();
    drag(a, [
      { x: -10, y: -5 },
      { x: -20, y: -10 },
      { x: -30, y: -15 },
    ]);
    const box = worldBounds(studio().doc, a);
    expect([box.x, box.y]).toEqual([70, 85]);
    // The group hugs the result, in one undo step.
    expect(worldBounds(studio().doc, g)).toMatchObject({ x: 70, y: 85 });
    expect(studio().past).toHaveLength(2);
  });

  it("follows the pointer while the group shrinks back", () => {
    const { a } = setup();
    drag(a, [
      { x: -40, y: 0 },
      { x: 30, y: 60 },
    ]);
    expect(worldBounds(studio().doc, a)).toMatchObject({ x: 130, y: 160 });
  });
});
