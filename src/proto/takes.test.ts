import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import { BUILTIN } from "@/design-system/resolve";
import { buildScreenNodes } from "@/design-system/place";
import type { Doc } from "@/doc/schema";
import { studio, useStudio } from "@/doc/store";
import { registerProtoPass } from "@/doc/proto-pass";
import { hiddenParts } from "@/engine/route-layer";
import { foodMenuDoc } from "./fixtures/food-menu";
import { OWN_MENU } from "./fixtures/own";
import { FOOD_BASKET } from "./fixtures/baskets";
import { asksOf } from "./asks";
import { partFrames } from "./routes";
import { playPrototype } from "./runner";
import { scanFrame, addRef } from "./scan";
import { chooseTakeDoc, collapseTakes, placeRoute, takeGroupOf } from "./takes";

beforeAll(async () => {
  await ensureYoga();
  registerProtoPass();
});

const typography = (p: string) => BUILTIN.typography(p);
const add = (doc: Doc, spec: Parameters<typeof buildScreenNodes>[0], x: number) => {
  const nodes = buildScreenNodes(spec, "builtin", { x, y: 0 }, "ai");
  for (const n of nodes) doc.nodes[n.id] = n;
  doc.roots.push(nodes[0].id);
  return nodes[0].id;
};

describe("takes", () => {
  it("are what alternatives of a new screen become; the chosen one waits for what the brief asked", () => {
    const doc: Doc = { nodes: {}, roots: [] };
    const [a, b, c] = [add(doc, OWN_MENU, 0), add(doc, OWN_MENU, 500), add(doc, OWN_MENU, 1000)];
    useStudio.setState({ doc, past: [], future: [], txBase: null, selection: [] });
    placeRoute([a, b, c], ["The dish's options sheet open"], { lang: "en" });
    expect(takeGroupOf(studio().doc, b)).toEqual({ frames: [a, b, c], chosen: a });
    expect(asksOf(studio().doc.proto!.routes![a])).toEqual(["The dish's options sheet open"]);
    expect(studio().doc.proto!.routes![b]).toBeUndefined();
    // An Arabic version of the best one isn't another take; revised screens aren't takes.
    placeRoute([a, b, c], undefined, { lang: "both" });
    expect(takeGroupOf(studio().doc, a)!.frames).toEqual([a, b]);
    useStudio.setState({ doc, past: [], future: [], txBase: null, selection: [] });
    placeRoute([a, b], undefined, { screens: [{ id: "x" }] });
    expect(studio().doc.proto?.takes).toBeUndefined();
  });

  it("hand the route over: parts move under the take, its steps are built again on its own layers, and where it went it still goes", () => {
    const { doc, ids } = foodMenuDoc();
    const other = add(doc, OWN_MENU, 2400);
    const basket = add(doc, FOOD_BASKET, 4000);
    const home = add(doc, { name: "Home", platform: "mobile", body: [{ component: "Button", props: { label: "Order from Al Mallah", variant: "primary", fullWidth: true } }] }, -800);
    const t = { kind: "push" as const, motion: "native" as const };
    const menu = doc.proto!.routes![ids.menu];
    menu.rules.push({ id: "rGo", when: { on: "tap", ref: { part: "basket", path: "body.0" } }, then: [{ do: "go", screen: basket, transition: t }] });
    doc.proto!.routes![home] = { overlays: {}, addOns: {}, rules: [{ id: "r1", when: { on: "tap", ref: { path: "body.0" } }, then: [{ do: "go", screen: ids.menu, transition: t }] }] };
    doc.proto!.takes = [{ frames: [ids.menu, other], chosen: ids.menu }];
    const before = partFrames(doc, ids.menu).map((p) => doc.nodes[p.frame].x);

    const out = chooseTakeDoc(doc, other, { typography })!;
    const d = out.doc;
    expect(d.proto!.takes).toEqual([{ frames: [ids.menu, other], chosen: other }]);
    expect(d.proto!.routes![ids.menu]).toBeUndefined();
    // The parts are the take's now, under it, with what was written in them.
    expect(partFrames(d, other).map((p) => p.part)).toEqual(["options", "basket"]);
    expect(Object.values(out.moved).map((m) => m.x)).toEqual(before.map((x) => x + 2400));
    // Its steps, built again where they apply.
    expect(out.report.rebuilt).toEqual(expect.arrayContaining(["Configure and add", "Collection bar", "Sticky sections"]));
    const route = d.proto!.routes![other];
    expect(route.steps!.map((s) => s.recipe)).toEqual(expect.arrayContaining(["configureAndAdd", "collectionBar"]));
    // Home goes to the take now.
    expect(d.proto!.routes![home].rules[0].then).toEqual([{ do: "go", screen: other, transition: t }]);
    // And it plays: a dish row's + opens the sheet about it, Add fills the bar, the bar goes to the basket.
    const p = playPrototype({ ...d, proto: { ...d.proto!, start: other } }, { typography });
    expect(p.warnings).toEqual([]);
    const col = scanFrame(d, other).collections[0];
    expect(p.tap(addRef(col, col.items[3]))).toBe(true);
    expect(p.textOf("options")).toContain("Chicken shawarma");
    p.tap({ part: "options", path: "footer.0.children.1" });
    expect(p.tap({ part: "basket", path: "body.0" })).toBe(true);
    expect(p.text()).toContain("Payment summary");
  });

  it("tuck the others away behind the chosen one, and back", () => {
    const doc: Doc = { nodes: {}, roots: [] };
    const [a, b] = [add(doc, OWN_MENU, 0), add(doc, OWN_MENU, 500)];
    doc.proto = { links: [], states: {}, tracks: [], takes: [{ frames: [a, b], chosen: a }] };
    useStudio.setState({ doc, past: [], future: [], txBase: null, selection: [] });
    collapseTakes(a, true);
    expect([...hiddenParts(studio().doc)]).toEqual([b]);
    studio().undo();
    expect([...hiddenParts(studio().doc)]).toEqual([]);
  });
});
