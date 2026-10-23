import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureYoga } from "@/engine/layout";
import { buildScreenNodes } from "@/design-system/place";
import type { ScreenSpec } from "@/design-system/builders";
import { studio, useStudio } from "@/doc/store";
import { emptyDoc, type Doc, type FrameNode, type RouteProto, type TextNode } from "@/doc/schema";
import { normalizeProto } from "@/doc/proto";
import { registerProtoPass } from "@/doc/proto-pass";
import { DEMO_SCREENS } from "@/ui/demo";
import { actionWords, normalizeRoutes, newPageId, pageName, partIndex, pruneRoutes, resolveRef, newPartId, newRuleId, isPart } from "./routes";
import { addPart, openOnTap, partSlot, removePart, starterSpec, PART_DROP } from "./edit";
import { produce } from "immer";
import { rebuildScreen } from "@/design-system/refresh";
import { spliceSection } from "@/design-system/section";
import { OPTIONS_SHEET } from "./fixtures/food-menu";

vi.mock("@/design-system/place", async (orig) => ({ ...(await orig<typeof import("@/design-system/place")>()), ensureSystemFonts: () => Promise.resolve() }));

beforeAll(async () => {
  await ensureYoga();
  registerProtoPass();
});

const sheetRoute = (frame = "f-sheet"): RouteProto => ({
  overlays: { options: { frame, kind: "sheet", dismiss: ["scrim", "drag", "back"] } },
  addOns: {},
  rules: [{ id: "r1", when: { on: "tap", ref: { path: "body.0" } }, then: [{ do: "open", part: "options" }] }],
});

describe("routes as stored", () => {
  it("keeps what holds up and drops the rest", () => {
    const routes = normalizeRoutes({
      s1: {
        overlays: {
          options: { frame: "f1", kind: "sheet" },
          "Bad Id": { frame: "f2", kind: "sheet" },
          weird: { frame: "f3", kind: "popup" },
          note: { frame: "f4", kind: "toast", ms: 99_999 },
        },
        addOns: { basket: { frame: "f5", region: "sideways" } },
        rules: [
          { id: "r1", when: { on: "tap", ref: { path: "body.0" } }, then: [{ do: "open", part: "options" }, { do: "open", part: "nowhere" }] },
          { id: "r2", when: { on: "tap", ref: { part: "nowhere", path: "body.0" } }, then: [{ do: "back" }] },
          { id: "r3", when: { on: "swipe" }, then: [{ do: "back" }] },
          { id: "r4", when: { on: "tap", ref: { path: "body.0" } }, then: [{ do: "teleport" }] },
        ],
      },
      s2: { overlays: {}, addOns: {}, rules: [] },
    });
    expect(Object.keys(routes!)).toEqual(["s1"]);
    const r = routes!.s1;
    expect(Object.keys(r.overlays)).toEqual(["options", "note"]);
    // A sheet closes by scrim, drag and Back unless it says otherwise; a toast's time is clamped.
    expect(r.overlays.options.dismiss).toEqual(["scrim", "drag", "back"]);
    expect(r.overlays.note.ms).toBe(10_000);
    expect(r.addOns.basket).toEqual({ frame: "f5", region: "bottom" });
    // Rules keep only actions on the route's own parts; rules from a missing part go.
    expect(r.rules).toEqual([{ id: "r1", when: { on: "tap", ref: { path: "body.0" } }, then: [{ do: "open", part: "options" }] }]);
  });

  it("rides along with the prototype through a file", () => {
    const proto = { links: [], states: {}, tracks: [], routes: { s1: sheetRoute() } };
    expect(normalizeProto(JSON.parse(JSON.stringify(proto)))).toEqual(proto);
  });

  it("drops what points at frames that are gone", () => {
    const routes = { s1: sheetRoute("f-sheet"), s2: sheetRoute("f-other") };
    // Nothing gone: the same object.
    expect(pruneRoutes(routes, ["s1", "s2", "f-sheet", "f-other"])).toBe(routes);
    // The sheet's frame is gone: so is the overlay, and the rule that opened it (an empty route goes).
    expect(pruneRoutes(routes, ["s1", "s2", "f-other"])).toEqual({ s2: routes.s2 });
    // The screen is gone: its route too.
    expect(pruneRoutes(routes, ["s2", "f-sheet", "f-other"])).toEqual({ s2: routes.s2 });
  });

  it("keeps the screen's own behaviour when one of its parts goes", () => {
    const route: RouteProto = {
      ...sheetRoute("f-sheet"),
      addOns: { basket: { frame: "f-bar", region: "bottom" } },
      vars: { compact: { type: { t: "bool" }, init: false, label: "Compact" } },
      scroll: [{ kind: "past", ref: { path: "header.0" }, v: "compact" }],
      bindings: [
        { kind: "prop", ref: { path: "header.0" }, prop: "scrolled", e: { v: "compact" } },
        { kind: "visible", ref: { part: "options", path: "body.0" }, e: { v: "compact" } },
      ],
      steps: [{ id: "s1", recipe: "headerOnScroll", label: "Scroll: the header compacts", at: { path: "header.0" }, play: [{ do: "scroll", y: 400 }, { do: "look", ref: { part: "options", path: "body.0" } }] }],
    };
    const out = pruneRoutes({ s1: route }, ["s1", "f-bar"])!.s1;
    // The sheet's frame is gone: it, its rule and what reads into it go; the header still compacts.
    expect(out.overlays).toEqual({});
    expect(out.rules).toEqual([]);
    expect(out.addOns).toEqual(route.addOns);
    expect(out.vars).toEqual(route.vars);
    expect(out.scroll).toEqual(route.scroll);
    expect(out.bindings).toEqual([route.bindings![0]]);
    expect(out.steps).toEqual([{ ...route.steps![0], play: [{ do: "scroll", y: 400 }] }]);
  });

  it("keeps pages not designed yet that something leads to, and drops the rest", () => {
    const t = { kind: "push", motion: "native" };
    const routes = normalizeRoutes({
      s1: {
        overlays: {},
        addOns: {},
        rules: [
          { id: "r1", when: { on: "tap", ref: { path: "footer.0" } }, then: [{ do: "next", page: "basket", transition: t }] },
          { id: "r2", when: { on: "tap", ref: { path: "body.0" } }, then: [{ do: "next", page: "nowhere", transition: t }] },
        ],
        next: { basket: { name: "Basket", brief: "The dishes added, the total, Checkout" }, orphan: { name: "Orphan", brief: "" }, "Bad Id": { name: "x" } },
      },
    });
    expect(routes!.s1.rules.map((r) => r.id)).toEqual(["r1"]);
    expect(routes!.s1.next).toEqual({ basket: { name: "Basket", brief: "The dishes added, the total, Checkout" } });
    expect(newPageId(routes!.s1, "Basket")).toBe("basket-2");
  });

  it("keep rows drawn for each line, lines changed by a tap, and notes of what was picked", () => {
    const routes = normalizeRoutes({
      s1: {
        overlays: {},
        addOns: {},
        rules: [
          { id: "r1", when: { on: "tap", ref: { path: "body.0.children.1", sub: { role: "increase" } } }, then: [{ do: "change", v: "app.basket", field: "qty", by: 1.4 }] },
          { id: "r2", when: { on: "tap", ref: { path: "body.0.children.1", sub: { role: "decrease" } } }, then: [{ do: "change", v: "app.basket", field: "qty", by: -1, min: 1 }] },
          { id: "r3", when: { on: "tap", ref: { path: "body.0" } }, then: [{ do: "change", v: "app.basket", field: "bad field", by: 1 }] },
          { id: "r4", when: { on: "tap", ref: { path: "body.1" } }, then: [{ do: "push", v: "app.basket", record: { note: { op: "join", a: [{ op: "titles", of: "choices", ids: { v: "choice" } }, "x"], sep: " · " } } }] },
        ],
        bindings: [
          { kind: "repeat", ref: { path: "body.0.children.1" }, of: "app.basket", others: ["body.0.children.3", "body.*.x", 4] },
          { kind: "repeat", ref: { path: "body.0" }, of: "Not A Var" },
        ],
      },
    });
    const r = routes!.s1;
    expect(r.rules.map((x) => x.then[0])).toEqual([
      { do: "change", v: "app.basket", field: "qty", by: 1 },
      { do: "change", v: "app.basket", field: "qty", by: -1, min: 1 },
      { do: "push", v: "app.basket", record: { note: { op: "join", a: [{ op: "titles", of: "choices", ids: { v: "choice" } }, "x"], sep: " · " } } },
    ]);
    expect(r.bindings).toEqual([{ kind: "repeat", ref: { path: "body.0.children.1" }, of: "app.basket", others: ["body.0.children.3"] }]);
  });

  it("names a page from the words of what leads there", () => {
    expect(pageName("View basket · AED 38.00")).toBe("Basket");
    expect(pageName("Checkout")).toBe("Checkout");
    expect(actionWords("Book Comfort · AED 24.00")).toBe("Book Comfort");
    expect(actionWords("Send AED 100.00")).toBe("Send");
    expect(actionWords("عرض السلة · ٤٣٫٠٠ ر.س")).toBe("عرض السلة");
  });

  it("names parts and rules uniquely in a route", () => {
    expect(newPartId(undefined, "Options")).toBe("options");
    expect(newPartId(sheetRoute(), "Options")).toBe("options-2");
    expect(newPartId(undefined, "2 for 1!")).toBe("p2-for-1");
    expect(newPartId(undefined, "خيارات")).toBe("part");
    expect(newRuleId(sheetRoute())).toBe("r2");
  });
});

describe("surfaces", () => {
  const owner = DEMO_SCREENS[0];
  const build = (spec: ScreenSpec) => buildScreenNodes(spec, "builtin", { x: 0, y: 0 }, "user");
  const names = (nodes: ReturnType<typeof build>) => (nodes[0] as FrameNode).children.map((id) => nodes.find((n) => n.id === id)!.name);

  it("draws a sheet across a phone, with its grabber and the home indicator's strip, and no status bar", () => {
    const nodes = build(starterSpec("sheet", owner));
    expect(nodes[0].w).toBe(390);
    expect(names(nodes)).toEqual(["Grabber", "Header", "Content", "Footer", "Safe area"]);
    expect(nodes.some((n) => n.name === "Status bar")).toBe(false);
    expect(nodes[0].meta.spec?.surface).toBe("sheet");
  });

  it("draws dialogs, toasts and menus as cards, and a toast's text light on its dark fill", () => {
    expect(build(starterSpec("dialog", owner))[0].w).toBe(358);
    expect(build(starterSpec("menu", owner))[0].w).toBe(240);
    const toast = build(starterSpec("toast", owner));
    expect(toast[0].w).toBe(358);
    expect(toast[0].fill?.token).toBe("bg.inverse");
    const label = toast.find((n): n is TextNode => n.type === "text")!;
    expect(label.fill?.token).toBe("text.inverse");
  });

  it("draws wider cards for the web", () => {
    expect(build({ ...starterSpec("dialog"), platform: "web" })[0].w).toBe(480);
    expect(build({ ...starterSpec("bar"), platform: "web" })[0].w).toBe(1440);
  });
});

describe("a route's parts follow their screen", () => {
  let screen = "";
  beforeEach(() => {
    useStudio.setState({ doc: emptyDoc(), past: [], future: [], txBase: null, selection: [] });
    const nodes = buildScreenNodes(DEMO_SCREENS[0], "builtin", { x: 100, y: 50 }, "ai");
    studio().mutate((d) => {
      for (const n of nodes) d.nodes[n.id] = n;
      d.roots.push(nodes[0].id);
    });
    screen = nodes[0].id;
  });

  const doc = (): Doc => studio().doc;

  it("adds a part under the screen, in one step, and knows whose it is", async () => {
    const added = await addPart(screen, "sheet");
    expect(added?.part).toBe("options");
    const f = doc().nodes[added!.frame];
    const s = doc().nodes[screen];
    expect(f.x).toBe(s.x);
    expect(f.y).toBe(s.y + s.h + PART_DROP);
    expect(isPart(doc(), added!.frame)).toBe(true);
    expect(partIndex(doc()).get(added!.frame)).toEqual({ owner: screen, part: "options", kind: "sheet" });
    // A second part goes beside the first.
    const second = await addPart(screen, "dialog");
    expect(doc().nodes[second!.frame].x).toBeGreaterThan(f.x + f.w);
    studio().undo();
    expect(doc().nodes[second!.frame]).toBeUndefined();
    expect(Object.keys(doc().proto!.routes![screen].overlays)).toEqual(["options"]);
  });

  it("resolves refs into the screen and into its parts", async () => {
    const added = await addPart(screen, "sheet");
    const top = resolveRef(doc(), screen, { path: "header.0" });
    expect(doc().nodes[top!].meta.specPath).toBe("header.0");
    const inSheet = resolveRef(doc(), screen, { part: "options", path: "footer.0" });
    expect(doc().nodes[inSheet!].meta.component).toMatch(/^Button/);
    expect(resolveRef(doc(), screen, { part: "options" })).toBe(added!.frame);
    expect(resolveRef(doc(), screen, { part: "nowhere" })).toBeNull();
  });

  it("moves parts with their screen, but not twice when they're dragged together", async () => {
    const added = await addPart(screen, "sheet");
    const before = { ...doc().nodes[added!.frame] };
    studio().mutate((d) => {
      d.nodes[screen].x += 40;
      d.nodes[screen].y += 10;
    });
    expect(doc().nodes[added!.frame].x).toBe(before.x + 40);
    expect(doc().nodes[added!.frame].y).toBe(before.y + 10);
    studio().mutate((d) => {
      d.nodes[screen].x += 5;
      d.nodes[added!.frame].x += 5;
    });
    expect(doc().nodes[added!.frame].x).toBe(before.x + 45);
  });

  it("deletes parts with their screen, and undo brings both back", async () => {
    const added = await addPart(screen, "sheet");
    openOnTap(screen, { path: "body.0" }, added!.part);
    studio().mutate((d) => {
      delete d.nodes[screen];
      d.roots = d.roots.filter((id) => id !== screen);
    });
    expect(doc().nodes[added!.frame]).toBeUndefined();
    expect(doc().roots).toEqual([]);
    expect(doc().proto?.routes).toBeUndefined();
    studio().undo();
    expect(doc().nodes[added!.frame]).toBeDefined();
    expect(doc().proto?.routes?.[screen].rules).toHaveLength(1);
  });

  it("drops the rules that opened a part when the part is removed", async () => {
    const added = await addPart(screen, "sheet");
    openOnTap(screen, { path: "body.0" }, added!.part);
    removePart(screen, added!.part);
    expect(doc().nodes[added!.frame]).toBeUndefined();
    expect(doc().proto?.routes).toBeUndefined();
  });

  it("keeps a part clear of other frames under the screen", () => {
    const d = doc();
    const s = d.nodes[screen];
    const blocker = { ...s, id: "blocker", y: s.y + s.h + PART_DROP, children: [] };
    const withBlocker: Doc = { ...d, nodes: { ...d.nodes, blocker }, roots: [...d.roots, "blocker"] };
    const at = partSlot(withBlocker, screen, { w: 390, h: 300 });
    expect(at.y).toBeGreaterThanOrEqual(blocker.y + blocker.h);
  });
});

describe("a part goes through what screens go through", () => {
  const sheetDoc = (spec: ScreenSpec = OPTIONS_SHEET): { doc: Doc; id: string } => {
    const nodes = buildScreenNodes(spec, "builtin", { x: 0, y: 0 }, "ai");
    return { doc: { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), roots: [nodes[0].id] }, id: nodes[0].id };
  };
  const childNames = (doc: Doc, id: string) => (doc.nodes[id] as FrameNode).children.map((c) => doc.nodes[c].name);

  it("stays a sheet when part of it is rebuilt (a section edit)", () => {
    const { doc, id } = sheetDoc();
    const spec = doc.nodes[id].meta.spec!;
    const { spec: edited } = spliceSection(spec, [{ path: "body.0", items: [{ component: "Text", props: { text: "Freshly grilled, wrapped to order", style: "body", tone: "secondary" } }] }]);
    const next = produce(doc, (d) => rebuildScreen(d, id, edited));
    expect(next.nodes[id].meta.spec?.surface).toBe("sheet");
    expect(childNames(next, id)).toEqual(["Grabber", "Header", "Content", "Footer", "Safe area"]);
    expect(Object.values(next.nodes).some((n) => n.type === "text" && n.text.content === "Freshly grilled, wrapped to order")).toBe(true);
  });

  it("mirrors right to left like a screen", () => {
    const { doc, id } = sheetDoc({ ...OPTIONS_SHEET, dir: "rtl", lang: "ar" });
    expect((doc.nodes[id] as FrameNode).dir).toBe("rtl");
    expect(childNames(doc, id)[0]).toBe("Grabber");
  });
});
