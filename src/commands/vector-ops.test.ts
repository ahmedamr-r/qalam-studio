import { describe, expect, it } from "vitest";
import "./catalog";
import "./vector-ops";
import { useStudio } from "@/doc/store";
import { emptyDoc } from "@/doc/schema";
import { makeShape } from "@/doc/factory";
import { setPathOps } from "@/doc/path-ops";
import { allCommands, commandState, formatKeys, getCommand, keysOf, runCommand } from "./registry";

const IDS = ["shape.union", "shape.subtract", "shape.intersect", "shape.exclude", "shape.flatten", "shape.outline-stroke", "shape.mask", "transform.rotate"];

describe("vector operation commands", () => {
  it("replace the catalogue's Coming soon entries, keeping their keys", () => {
    const keys = Object.fromEntries(IDS.map((id) => [id, keysOf(getCommand(id)!, true).map((k) => formatKeys(k, true).join(""))]));
    expect(keys).toEqual({
      "shape.union": ["⌥⇧U"],
      "shape.subtract": ["⌥⇧S"],
      "shape.intersect": ["⌥⇧I"],
      "shape.exclude": ["⌥⇧E"],
      "shape.flatten": ["⌘E"],
      "shape.outline-stroke": ["⌥⌘O"],
      "shape.mask": ["⌃⌘M"],
      "transform.rotate": ["⌥⌘↑", "⌥⌘↓"],
    });
    for (const id of IDS) expect(getCommand(id)!.unavailable, id).toBeUndefined();
    expect(getCommand("components.create")!.unavailable).toMatch(/Qalam AI/);
  });

  it("say why they can't run", () => {
    const r = makeShape("rect");
    const d = emptyDoc();
    d.nodes[r.id] = r;
    d.roots = [r.id];
    useStudio.setState({ doc: d, selection: [r.id] });
    setPathOps(null);
    expect(commandState(getCommand("shape.union")!)).toBe("The canvas isn't ready yet");
    setPathOps({ combine: () => null, stroke: () => null });
    expect(commandState(getCommand("shape.union")!)).toBe("Select 2+ layers");
    expect(commandState(getCommand("shape.flatten")!)).toBe(true);
    expect(commandState(getCommand("shape.outline-stroke")!)).toBe("Select a layer with a stroke");
    expect(commandState(getCommand("shape.mask")!)).toBe("Select the mask and the layers it masks");
  });

  it("don't share a key with another working command", () => {
    for (const mac of [true, false]) {
      const seen = new Map<string, string[]>();
      for (const c of allCommands()) {
        if (c.gesture || c.unavailable || (c.context && c.context !== "canvas" && c.context !== "global")) continue;
        for (const k of keysOf(c, mac)) {
          const caps = [...formatKeys({ ...k, key: undefined, code: undefined, label: "" }, mac), k.key ?? k.code].join("");
          seen.set(caps, [...(seen.get(caps) ?? []), c.id]);
        }
      }
      const clashes = [...seen].filter(([caps, ids]) => ids.length > 1 && caps !== "Enter" && ids.some((id) => IDS.includes(id)));
      expect(clashes).toEqual([]);
    }
  });

  it("rotate 90° left on ⌥⌘↑ and right on ⌥⌘↓", () => {
    const r = makeShape("rect", { x: 0, y: 0, w: 40, h: 20 });
    const d = emptyDoc();
    d.nodes[r.id] = r;
    d.roots = [r.id];
    useStudio.setState({ doc: d, selection: [], past: [], future: [] });
    expect(commandState(getCommand("transform.rotate")!)).toBe("Select a layer first");
    useStudio.setState({ selection: [r.id] });
    const rotation = () => useStudio.getState().doc.nodes[r.id].rotation;
    runCommand("transform.rotate", "keyboard", { key: "ArrowDown", altKey: true, metaKey: true } as KeyboardEvent);
    expect(rotation()).toBeCloseTo(90, 6);
    runCommand("transform.rotate", "keyboard", { key: "ArrowUp", altKey: true, metaKey: true } as KeyboardEvent);
    runCommand("transform.rotate", "keyboard", { key: "ArrowUp", altKey: true, metaKey: true } as KeyboardEvent);
    expect(rotation()).toBeCloseTo(-90, 6);
    // Turned about its centre: the box stays where it was.
    expect(useStudio.getState().doc.nodes[r.id]).toMatchObject({ x: 0, y: 0 });
    expect(useStudio.getState().past).toHaveLength(3);
  });
});
