import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import { BUILTIN } from "@/design-system/resolve";
import { buildScreenNodes, nextSlot } from "@/design-system/place";
import { studio, useStudio } from "@/doc/store";
import { registerProtoPass } from "@/doc/proto-pass";
import type { Doc } from "@/doc/schema";
import { candidates } from "./agent/candidates";
import { buildSteps } from "./agent/build";
import { routeGeometry } from "./canvas/layout";
import { fixture } from "./fixtures/build";
import { MENU_SCREEN, OPTIONS_SHEET } from "./fixtures/food-menu";
import { carried, nextBrief, resolveNext } from "./pending";
import { playPrototype } from "./runner";

beforeAll(async () => {
  await ensureYoga();
  registerProtoPass();
});

const typography = (p: string) => BUILTIN.typography(p);

/** The menu with every recommended step built by code: its bar's button goes on to the basket, not designed yet. */
function menu() {
  const f = fixture({ screen: MENU_SCREEN, parts: {}, steps: [] });
  // The options sheet as Qalam AI writes one (sizes and extras); the rest as code writes it.
  const picked = candidates(f.doc, f.screen)
    .filter((c) => c.recommended)
    .map((candidate) => ({ candidate, ...(candidate.recipe === "configureAndAdd" ? { part: OPTIONS_SHEET } : {}) }));
  const out = buildSteps(f.doc, f.screen, picked, { typography });
  const doc: Doc = { ...out.doc, proto: { ...out.doc.proto!, vars: { ...out.doc.proto?.vars, ...out.appVars } } };
  return { doc, screen: f.screen };
}

describe("pages not designed yet", () => {
  it("show on the canvas as a card in the route's row of parts, wired from what leads there", () => {
    const { doc, screen } = menu();
    const g = routeGeometry(doc).find((x) => x.screen === screen)!;
    expect(g.pages.map((p) => p.name)).toEqual(["Basket"]);
    const wire = g.wires.find((w) => w.kind === "next")!;
    expect(wire.to).toEqual(g.pages[0].box);
    // In the container, after the parts.
    const c = g.container!;
    expect(g.pages[0].box.x + g.pages[0].box.w).toBeLessThanOrEqual(c.x + c.w);
  });

  it("leave room: a new screen goes clear of the route's container, past its parts, cards and pages", () => {
    const { doc, screen } = menu();
    useStudio.setState({ doc, past: [], future: [], txBase: null, selection: [] });
    const c = routeGeometry(doc).find((x) => x.screen === screen)!.container!;
    expect(nextSlot().x).toBeGreaterThan(c.x + c.w);
  });

  it("are briefed to Generate from what leads there, and what the prototype puts in them", () => {
    const { doc, screen } = menu();
    // The walkthrough adds a dish: its options picked, two of it.
    expect(carried(doc, screen)).toEqual([expect.stringMatching(/^Basket: 2 × Chicken shawarma \(Large, [^)]+\) · AED \d+\.\d\d$/)]);
    const brief = nextBrief(doc, screen, "basket");
    expect(brief).toContain(`Design the "Basket" screen: it's what "View basket" opens on "Al Mallah · Menu", the screen before it in this product's flow.`);
    expect(brief).toContain('It shows: What "View basket" opens.');
    expect(brief).toContain("When it opens it holds what the prototype put there (use these): Basket: 2 × Chicken shawarma");
    expect(brief.length).toBeLessThanOrEqual(800);
  });

  it("once drawn, are where the screen goes: the rule goes to it, its card goes, and the step says so — one undo step", () => {
    const { doc, screen } = menu();
    // The basket, drawn: any screen will do here.
    const nodes = buildScreenNodes({ name: "Basket", platform: "mobile", body: [{ component: "Text", props: { text: "Your basket", style: "title" } }] }, "builtin", { x: 1000, y: 0 }, "ai");
    const drawn: Doc = { ...doc, nodes: { ...doc.nodes, ...Object.fromEntries(nodes.map((n) => [n.id, n])) }, roots: [...doc.roots, nodes[0].id] };
    useStudio.setState({ doc: drawn, past: [], future: [], txBase: null, selection: [] });
    resolveNext(screen, "basket", nodes[0].id);
    const route = studio().doc.proto!.routes![screen];
    expect(route.next).toBeUndefined();
    expect(route.rules.flatMap((r) => r.then).filter((a) => a.do === "go")).toEqual([{ do: "go", screen: nodes[0].id, transition: { kind: "push", motion: "native" } }]);
    expect(route.steps!.at(-1)!.label).not.toContain("not designed yet");
    // Playing it: the bar's button goes to the basket now.
    const p = playPrototype(studio().doc, { typography, start: undefined });
    p.tap({ path: "body.2.children.0.children.1" });
    p.tap({ part: p.state.open[0], name: "Button/Primary" });
    const bar = Object.keys(route.addOns)[0];
    expect(p.tap({ part: bar, name: "Button/Primary" })).toBe(true);
    expect(p.state.screen).not.toMatch(/Page$/);
    expect(p.text()).toContain("Your basket");
    studio().undo();
    expect(studio().doc.proto!.routes![screen].next).toEqual({ basket: expect.objectContaining({ name: "Basket" }) });
  });
});
