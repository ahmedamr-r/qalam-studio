import { describe, expect, it } from "vitest";
import { makeFrame } from "@/doc/factory";
import { emptyDoc, type Doc, type SceneNode } from "@/doc/schema";
import { addPage, COMPONENTS_PAGE, pageRoots, switchPage } from "@/doc/pages";
import { COMPONENTS_READ_ONLY, componentsGuard, componentsPass } from "./readonly";

/** A project on its Components page, with one section holding one card. */
function onComponents() {
  const base = emptyDoc();
  const screen = makeFrame({ name: "Home" });
  base.nodes[screen.id] = screen;
  base.roots.push(screen.id);
  const doc = switchPage(addPage(base).doc, COMPONENTS_PAGE);
  const section = makeFrame({ name: "Inputs", meta: { source: "user", showcase: { kind: "section", group: "Inputs", sig: "builtin@1" } } }) as SceneNode;
  section.id = "cmp:section:inputs";
  const card = makeFrame({ name: "Button", parentId: section.id, meta: { source: "user", showcase: { kind: "card", component: "Button" } } }) as SceneNode;
  card.id = "cmp:card:Button";
  section.children = [card.id];
  const d: Doc = { ...doc, nodes: { ...doc.nodes, [section.id]: section, [card.id]: card }, roots: [section.id] };
  return { d, screen, section, card };
}

describe("the Components page stays read-only", () => {
  it("undoes edits and deletions of its drawings", () => {
    const { d, card, section } = onComponents();
    const moved = { ...d, nodes: { ...d.nodes, [card.id]: { ...card, x: 400 } } };
    expect(componentsPass(d, moved).nodes[card.id]).toBe(card);
    const gone: Doc = { ...d, nodes: { ...d.nodes }, roots: [] };
    delete gone.nodes[section.id];
    delete gone.nodes[card.id];
    const back = componentsPass(d, gone);
    expect(back.roots).toEqual([section.id]);
    expect(back.nodes[card.id]).toBe(card);
  });

  it("drops layers added inside its drawings", () => {
    const { d, card } = onComponents();
    const rect = makeFrame({ name: "Stray", parentId: card.id });
    const next: Doc = { ...d, nodes: { ...d.nodes, [rect.id]: rect, [card.id]: { ...card, children: [rect.id] } } };
    const out = componentsPass(d, next);
    expect(out.nodes[rect.id]).toBeUndefined();
    expect(out.nodes[card.id]).toBe(card);
  });

  it("sends new top-level layers to the page it was opened from", () => {
    const { d, screen, section } = onComponents();
    const fresh = makeFrame({ name: "Generated" });
    const next: Doc = { ...d, nodes: { ...d.nodes, [fresh.id]: fresh }, roots: [...d.roots, fresh.id] };
    const out = componentsPass(d, next);
    expect(out.roots).toEqual([section.id]);
    expect(pageRoots(out, "page-1")).toEqual([screen.id, fresh.id]);
  });

  it("leaves page switches and other pages' edits alone", () => {
    const { d, screen } = onComponents();
    const back = switchPage(d, "page-1");
    expect(componentsPass(d, back)).toBe(back);
    const renamed = { ...d, nodes: { ...d.nodes, [screen.id]: { ...screen, name: "Home (synced)" } } };
    expect(componentsPass(d, renamed)).toBe(renamed);
  });

  it("lets only looking around, pages and undo through", () => {
    expect(componentsGuard({ id: "zoom.fit", category: "zoom" })).toBeNull();
    expect(componentsGuard({ id: "page.next", category: "zoom" })).toBeNull();
    expect(componentsGuard({ id: "page.add", category: "file" })).toBeNull();
    expect(componentsGuard({ id: "edit.undo", category: "edit" })).toBeNull();
    expect(componentsGuard({ id: "edit.delete", category: "edit" })).toBe(COMPONENTS_READ_ONLY);
    expect(componentsGuard({ id: "edit.paste", category: "edit" })).toBe(COMPONENTS_READ_ONLY);
    expect(componentsGuard({ id: "tool.rect", category: "tools" })).toBe(COMPONENTS_READ_ONLY);
    expect(componentsGuard({ id: "arrange.group", category: "arrange" })).toBe(COMPONENTS_READ_ONLY);
  });
});
