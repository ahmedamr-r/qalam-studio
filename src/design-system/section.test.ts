import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import type { Doc } from "@/doc/schema";
import { buildScreenNodes } from "./place";
import type { ScreenSpec } from "./builders";
import { selectedSection, spliceSection } from "./section";

const SPEC: ScreenSpec = {
  name: "Order ticket",
  platform: "mobile",
  header: [{ component: "TopBar", props: { title: "Buy EMAAR" } }],
  body: [
    { component: "SegmentedControl", props: { options: ["Market", "Limit"], selected: 0 } },
    { component: "Card", props: {}, children: [{ component: "Text", props: { text: "Shares", style: "body" } }, { component: "Text", props: { text: "174", style: "body" } }] },
    { component: "Button", props: { label: "Review buy", variant: "primary" } },
  ],
};

let doc: Doc;
const byPath = (p: string) => Object.values(doc.nodes).find((n) => n.meta.specPath === p)!.id;
const byName = (name: string) => Object.values(doc.nodes).find((n) => n.name === name)!.id;

describe("sections", () => {
  beforeAll(async () => {
    await ensureYoga();
    const nodes = buildScreenNodes(SPEC, "builtin", { x: 0, y: 0 }, "ai");
    doc = { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), roots: [nodes[0].id] };
  });

  it("reads the selected components of a generated screen", () => {
    const s = selectedSection(doc, [byPath("body.1")])!;
    expect(s.paths).toEqual(["body.1"]);
    expect(s.names).toEqual(["Card"]);
    expect(s.rootId).toBe(doc.roots[0]);
  });

  it("counts a layer inside a component as that component, and a child of a selected one as part of it", () => {
    const inner = doc.nodes[byPath("body.1.children.0")].children[0] ?? byPath("body.1.children.0");
    expect(selectedSection(doc, [inner])!.paths).toEqual(["body.1.children.0"]);
    expect(selectedSection(doc, [byPath("body.1"), byPath("body.1.children.1")])!.paths).toEqual(["body.1"]);
  });

  it("treats a region wrapper as the components in it", () => {
    expect(selectedSection(doc, [byName("Content")])!.paths).toEqual(["body.0", "body.1", "body.2"]);
  });

  it("is about the whole screen when the screen itself is selected", () => {
    expect(selectedSection(doc, [doc.roots[0]])).toBeNull();
    expect(selectedSection(doc, [doc.roots[0], byPath("body.1")])).toBeNull();
  });

  it("replaces only the edited components", () => {
    const card = { component: "Card", props: {}, children: [{ component: "Text", props: { text: "Shares 200", style: "body" } }] };
    const out = spliceSection(SPEC, [{ path: "body.1", items: [card] }]);
    expect(out.oneForOne).toBe(true);
    expect(out.spec.body[1]).toEqual(card);
    expect(out.spec.body[0]).toEqual(SPEC.body[0]);
    expect(out.spec.body[2]).toEqual(SPEC.body[2]);
    expect(out.spec.header).toEqual(SPEC.header);
    expect(out.paths).toEqual(["body.1", "body.1.children.0"]);
    expect(SPEC.body[1].children).toHaveLength(2);
  });

  it("splices several items and several edits at their original positions", () => {
    const a = { component: "Text", props: { text: "A", style: "body" } };
    const b = { component: "Text", props: { text: "B", style: "body" } };
    const out = spliceSection(SPEC, [
      { path: "body.0", items: [a, b] },
      { path: "body.2", items: [] },
    ]);
    expect(out.oneForOne).toBe(false);
    expect(out.spec.body.map((i) => i.component)).toEqual(["Text", "Text", "Card"]);
    expect(out.paths).toEqual(["body.0", "body.1"]);
  });
});
