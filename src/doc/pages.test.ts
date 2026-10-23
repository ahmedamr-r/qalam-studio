import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { studio, useStudio } from "./store";
import { makeFrame } from "./factory";
import { emptyDoc, type Doc, type ProtoLink, type Prototype, type RouteProto, type SceneNode } from "./schema";
import { registerProtoPass } from "./proto-pass";
import { frameCount } from "@/projects/migrate";
import {
  activePage,
  clearPage,
  addPage,
  allScreenRoots,
  COMPONENTS_PAGE,
  deletePage,
  forStorage,
  isOnPage,
  moveToPage,
  normalizePages,
  pageOf,
  pageRoots,
  renamePage,
  reorderPage,
  switchPage,
  wholeDoc,
} from "./pages";

const link = (from: string, to: string): ProtoLink => ({ from: { screen: from }, on: "tap", to: { screen: to }, transition: { kind: "smart", motion: "native" } });

const route = (sheet: string): RouteProto => ({
  overlays: { options: { frame: sheet, kind: "sheet", dismiss: ["scrim"] } },
  addOns: {},
  rules: [{ id: "r1", when: { on: "tap", ref: {} }, then: [{ do: "open", part: "options" }] }],
});

function frame(d: Doc, name: string, parentId: string | null = null): string {
  const f = makeFrame({ name, parentId });
  d.nodes[f.id] = f;
  if (parentId) d.nodes[parentId].children.push(f.id);
  else d.roots.push(f.id);
  return f.id;
}

/** Page 1: a menu screen with a sheet part and a basket screen linked from it. */
function menuDoc() {
  const d = emptyDoc();
  const menu = frame(d, "Menu");
  const child = frame(d, "Header", menu);
  const sheet = frame(d, "Options sheet");
  const basket = frame(d, "Basket");
  d.proto = { links: [link(menu, basket)], states: {}, tracks: [], routes: { [menu]: route(sheet) } };
  return { d, menu, child, sheet, basket };
}

describe("pages (pure)", () => {
  it("treats a document without pages as one page", () => {
    const { d, menu } = menuDoc();
    expect(activePage(d)).toBe("page-1");
    expect(allScreenRoots(d)).toBe(d.roots);
    expect(wholeDoc(d)).toBe(d);
    expect(pageOf(d, menu)).toBe("page-1");
  });

  it("keeps each page's layers and prototype through a round trip", () => {
    const { d, menu, child, sheet, basket } = menuDoc();
    const { doc: withTwo, id: two } = addPage(d);
    expect(withTwo.pages!.map((p) => p.name)).toEqual(["Page 1", "Page 2"]);
    const onTwo = switchPage(withTwo, two);
    expect(onTwo.roots).toEqual([]);
    expect(onTwo.proto).toBeUndefined();
    expect(pageRoots(onTwo, "page-1")).toEqual([menu, sheet, basket]);
    expect(onTwo.pages![0].proto?.routes?.[menu]).toBeDefined();
    expect(allScreenRoots(onTwo)).toEqual([menu, sheet, basket]);
    expect(isOnPage(onTwo, child)).toBe(false);
    expect(pageOf(onTwo, child)).toBe("page-1");
    const back = switchPage(onTwo, "page-1");
    expect(back.roots).toEqual([menu, sheet, basket]);
    expect(back.proto).toEqual(d.proto);
    expect(back.pages!.every((p) => p.roots.length === 0 && !p.proto)).toBe(true);
  });

  it("renames, reorders and deletes pages; the last one stays", () => {
    const { d, menu } = menuDoc();
    let doc = addPage(d, "  Flows  ").doc;
    const flows = doc.pages![1].id;
    expect(doc.pages![1].name).toBe("Flows");
    doc = renamePage(doc, flows, "Checkout");
    doc = reorderPage(doc, flows, 0);
    expect(doc.pages!.map((p) => p.name)).toEqual(["Checkout", "Page 1"]);
    // Deleting the page showing shows its neighbour and removes what was on it.
    doc = deletePage(doc, "page-1");
    expect(doc.pages!.map((p) => p.name)).toEqual(["Checkout"]);
    expect(activePage(doc)).toBe(flows);
    expect(doc.nodes[menu]).toBeUndefined();
    expect(Object.keys(doc.nodes)).toEqual([]);
    expect(deletePage(doc, flows)).toBe(doc);
  });

  it("moves screens to another page with their parts and prototype", () => {
    const { d, menu, sheet, basket } = menuDoc();
    const { doc, id: two } = addPage(d);
    const moved = moveToPage(doc, [menu], two);
    // The sheet goes with its screen; the basket stays.
    expect(moved.roots).toEqual([basket]);
    expect(moved.proto?.routes).toBeUndefined();
    expect(moved.proto?.links).toEqual([]);
    expect(pageRoots(moved, two)).toEqual([menu, sheet]);
    const shown = switchPage(moved, two);
    expect(shown.proto?.routes?.[menu]?.overlays.options.frame).toBe(sheet);
    // The link to a screen left behind doesn't follow.
    expect(shown.proto?.links).toEqual([]);
  });

  it("moves both ends of a link together", () => {
    const { d, menu, basket } = menuDoc();
    const { doc, id: two } = addPage(d);
    const shown = switchPage(moveToPage(doc, [menu, basket], two), two);
    expect(shown.proto?.links).toEqual([link(menu, basket)]);
  });

  it("builds nothing into a saved document from the Components page", () => {
    const { d, menu } = menuDoc();
    const onComponents = switchPage(d, COMPONENTS_PAGE);
    expect(onComponents.roots).toEqual([]);
    expect(onComponents.returnPage).toBe("page-1");
    // What its runtime builds there.
    const card = makeFrame({ name: "Button", meta: { source: "user", showcase: { kind: "section", group: "Inputs" } } });
    const withCard: Doc = { ...onComponents, nodes: { ...onComponents.nodes, [card.id]: card }, roots: [card.id] };
    expect(allScreenRoots(withCard)).toEqual(pageRoots(d, "page-1"));
    expect(wholeDoc(withCard).nodes[card.id]).toBeUndefined();
    const saved = forStorage(withCard);
    expect(saved.page).toBe("page-1");
    expect(saved.roots).toContain(menu);
    expect(saved.nodes[card.id]).toBeUndefined();
    expect(saved.proto).toEqual(d.proto);
  });
});

describe("the whole document", () => {
  it("counts and lists every page's screens, never the Components page's", () => {
    const { d, menu, sheet, basket } = menuDoc();
    const { doc, id: two } = addPage(d);
    const split = switchPage(moveToPage(doc, [basket], two), two);
    expect(frameCount(split)).toBe(3);
    expect(wholeDoc(split).roots).toEqual([menu, sheet, basket]);
    const onComponents = switchPage(split, COMPONENTS_PAGE);
    expect(frameCount(onComponents)).toBe(3);
  });

  it("clears only the page showing", () => {
    const { d, menu, child, basket } = menuDoc();
    const { doc, id: two } = addPage(d);
    const cleared = clearPage(moveToPage(doc, [basket], two));
    expect(cleared.roots).toEqual([]);
    expect(cleared.nodes[menu]).toBeUndefined();
    expect(cleared.nodes[child]).toBeUndefined();
    expect(cleared.nodes[basket]).toBeDefined();
    expect(cleared.proto).toBeUndefined();
  });
});

describe("normalizePages", () => {
  it("fixes dangling, doubled and orphan top-level layers", () => {
    const { d, menu, sheet, basket } = menuDoc();
    const loose = makeFrame({ name: "Loose" });
    const raw = {
      ...d,
      nodes: { ...d.nodes, [loose.id]: loose },
      roots: [menu, "gone"],
      page: "a",
      pages: [
        { id: "a", name: "", roots: [sheet] },
        { id: "a", name: "Twin", roots: [] },
        { id: "b", name: "Flows", roots: [basket, menu, "gone"], proto: { links: "nope" } as unknown as Prototype },
      ],
    } as Doc;
    const n = normalizePages(raw);
    expect(n.pages!.map((p) => [p.id, p.name])).toEqual([
      ["a", "Page 1"],
      ["b", "Flows"],
    ]);
    expect(n.roots).toEqual([menu, sheet, loose.id]);
    expect(n.pages![1].roots).toEqual([basket]);
    expect(n.pages![1].proto).toBeUndefined();
  });

  it("strips Components-page nodes and opens on the page it came from", () => {
    const { d } = menuDoc();
    const away = switchPage(addPage(d).doc, COMPONENTS_PAGE);
    const card = makeFrame({ name: "Button", meta: { source: "user", showcase: { kind: "section" } } });
    const stored = { ...away, nodes: { ...away.nodes, [card.id]: card }, roots: [card.id] } as Doc;
    const n = normalizePages(stored);
    expect(n.page).toBe("page-1");
    expect(n.nodes[card.id]).toBeUndefined();
    expect(n.roots).toEqual(d.roots);
    expect(n.proto).toEqual(d.proto);
  });

  it("leaves a document without pages as it is", () => {
    const d = { nodes: {}, roots: ["s1", "s2"] } as Doc;
    expect(normalizePages(d)).toBe(d);
  });
});

describe("pages in the studio", () => {
  beforeAll(() => registerProtoPass());
  beforeEach(() => useStudio.setState({ doc: emptyDoc(), past: [], future: [], txBase: null, selection: [] }));

  const load = (d: Doc) => studio().openDoc(JSON.parse(JSON.stringify(d)));
  const show = (id: string) => useStudio.setState({ doc: switchPage(studio().doc, id) });

  it("never prunes another page's prototype", () => {
    const { d, menu, sheet } = menuDoc();
    load(addPage(d).doc);
    const two = studio().doc.pages![1].id;
    show(two);
    // An edit on page 2 runs every doc pass; page 1's route and sheet stay.
    const extra = makeFrame({ name: "New" }) as SceneNode;
    studio().mutate((x) => {
      x.nodes[extra.id] = extra;
      x.roots.push(extra.id);
    });
    expect(studio().doc.nodes[sheet]).toBeDefined();
    show("page-1");
    expect(studio().doc.proto?.routes?.[menu]).toBeDefined();
  });

  it("undoes an edit made on another page by showing that page", () => {
    const { d, menu } = menuDoc();
    load(addPage(d).doc);
    studio().mutate((x) => {
      x.nodes[menu].name = "Menu (edited)";
    });
    show(studio().doc.pages![1].id);
    studio().undo();
    expect(activePage(studio().doc)).toBe("page-1");
    expect(studio().doc.nodes[menu].name).toBe("Menu");
  });

  it("moves screens through the undo history", () => {
    const { d, menu, sheet } = menuDoc();
    load(addPage(d).doc);
    const two = studio().doc.pages![1].id;
    const next = moveToPage(studio().doc, [menu], two);
    studio().mutate(() => next);
    // The doc passes don't treat the moved sheet as an orphan of its screen.
    expect(studio().doc.nodes[sheet]).toBeDefined();
    expect(pageRoots(studio().doc, two)).toEqual([menu, sheet]);
    studio().undo();
    expect(studio().doc.roots).toContain(menu);
    expect(studio().doc.proto?.routes?.[menu]).toBeDefined();
  });

  it("selects only what's on the page showing", () => {
    const { d, menu, basket } = menuDoc();
    load(addPage(d).doc);
    const two = studio().doc.pages![1].id;
    const moved = moveToPage(studio().doc, [basket], two);
    studio().mutate(() => moved);
    studio().select([menu, basket]);
    expect(studio().selection).toEqual([menu]);
  });
});
