import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { studio, useStudio } from "./store";
import { makeFrame } from "./factory";
import { emptyDoc, type ProtoLink, type Prototype } from "./schema";
import { registerProtoPass } from "./proto-pass";

function addFrame() {
  const f = makeFrame({ name: "Screen" });
  studio().mutate((d) => {
    d.nodes[f.id] = f;
    d.roots.push(f.id);
  });
  return f.id;
}

const link = (from: string, to: string): ProtoLink => ({ from: { screen: from }, on: "tap", to: { screen: to }, transition: { kind: "smart", motion: "native" } });

describe("prototype in undo history", () => {
  beforeAll(() => registerProtoPass());
  beforeEach(() => useStudio.setState({ doc: emptyDoc(), past: [], future: [], txBase: null, selection: [] }));

  it("undoes and redoes prototype edits like canvas edits", () => {
    const a = addFrame();
    const b = addFrame();
    studio().mutate((d) => {
      d.proto = { links: [link(a, b)], states: {}, tracks: [] };
    });
    studio().undo();
    expect(studio().doc.proto).toBeUndefined();
    studio().redo();
    expect(studio().doc.proto?.links).toEqual([link(a, b)]);
  });

  it("brings a screen and the links to it back in the same step", () => {
    const a = addFrame();
    const b = addFrame();
    studio().mutate((d) => {
      d.proto = { links: [link(a, b)], states: {}, tracks: [] };
    });
    // Deleting a screen drops the links that point at it, in the same step.
    studio().mutate((d) => {
      delete d.nodes[b];
      d.roots = d.roots.filter((id) => id !== b);
    });
    expect(studio().doc.proto?.links).toEqual([]);
    studio().undo();
    expect(studio().doc.nodes[b]).toBeDefined();
    expect(studio().doc.proto?.links).toEqual([link(a, b)]);
  });

  it("keeps a prototype through a document file, and drops a broken one", () => {
    const proto: Prototype = { start: "s1", links: [link("s1", "s2")], states: { s1: { done: { "body.1.props.current": 3 } } }, tracks: [] };
    studio().openDoc(JSON.parse(JSON.stringify({ nodes: {}, roots: ["s1", "s2"], proto })));
    expect(studio().doc.proto).toEqual(proto);
    // Links to screens the file doesn't have are dropped.
    studio().openDoc(JSON.parse(JSON.stringify({ nodes: {}, roots: ["s1"], proto })));
    expect(studio().doc.proto?.links).toEqual([]);
    studio().openDoc(JSON.parse(JSON.stringify({ nodes: {}, roots: [], proto: { links: "nope" } })));
    expect(studio().doc.proto).toBeUndefined();
  });

  it("leaves a document without a prototype as it is", () => {
    const a = addFrame();
    const before = studio().doc;
    studio().mutate((d) => {
      d.nodes[a].name = "Home";
    });
    expect(studio().doc.proto).toBeUndefined();
    expect(studio().doc).not.toBe(before);
  });
});
