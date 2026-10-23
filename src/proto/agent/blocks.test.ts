import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import { BUILTIN } from "@/design-system/resolve";
import type { ScreenSpec } from "@/design-system/builders";
import { fixture } from "../fixtures/build";
import { MENU_SCREEN } from "../fixtures/food-menu";
import { TRANSFER_SCREEN } from "../fixtures/bank";
import { playPrototype } from "../runner";
import { buildSteps } from "./build";
import type { Candidate } from "./candidates";
import type { Block } from "./blocks";
import { layerIndex } from "./layers";

beforeAll(async () => {
  await ensureYoga();
});

const typography = (p: string) => BUILTIN.typography(p);
const bare = (screen: ScreenSpec) => fixture({ screen, parts: {}, steps: [] });
const layer = (f: ReturnType<typeof bare>, match: RegExp) => layerIndex(f.doc, f.screen).find((l) => match.test(l.what))!;

/** An ask built from blocks, as the client makes it. */
const ask = (label: string, blocks: Block[], needs?: Candidate["needs"]): Candidate => ({ id: "f1", recipe: "blocks", what: label, at: { path: "" }, main: false, recommended: true, blocks, ...(needs ? { needs } : {}) });

describe("the layers an ask can point at", () => {
  it("lists each component once, and the same place in every item once", () => {
    const f = bare(MENU_SCREEN);
    const ls = layerIndex(f.doc, f.screen);
    const each = ls.filter((l) => l.each);
    expect(each.find((l) => l.component === "IconButton")).toMatchObject({ ref: { path: "body.*.children.*.children.1" }, what: 'IconButton "Add Chicken shawarma" (icon plus), in each item' });
    expect(ls.find((l) => l.component === "TopBar")?.what).toBe('TopBar "Al Mallah"');
    expect(ls.map((l) => l.id)).toEqual(ls.map((_, i) => `l${i + 1}`));
  });
});

describe("asks built from blocks", () => {
  it("toggle-look: a dish's + flips its look on tap, each dish on its own", () => {
    const f = bare(MENU_SCREEN);
    const plus = layer(f, /^IconButton.*in each item$/);
    const out = buildSteps(f.doc, f.screen, [{ candidate: ask("Tap a dish's + to save it", [{ kind: "toggle-look", on: plus.id, look: [{ prop: "variant", value: "brand" }] }]) }], { typography });
    expect(out.results).toEqual([{ id: "f1", ok: true, issues: [] }]);
    const route = out.doc.proto!.routes![f.screen];
    expect(route.steps![0]).toMatchObject({ recipe: "blocks", label: "Tap a dish's + to save it" });
    const p = playPrototype(out.doc, { typography });
    p.tap({ path: "body.2.children.0.children.1" });
    expect(p.state.data.toggled).toEqual(["body.2.children.0"]);
    p.tap({ path: "body.2.children.2.children.1" });
    p.tap({ path: "body.2.children.0.children.1" });
    expect(p.state.data.toggled).toEqual(["body.2.children.2"]);
  });

  it("reveal: tapping one layer shows another that starts hidden", () => {
    const f = bare(TRANSFER_SCREEN);
    const lina = layer(f, /^ListItem "Lina Haddad"/);
    const fee = layer(f, /^SummaryRow "Fee"/);
    const out = buildSteps(f.doc, f.screen, [{ candidate: ask("Tap Lina to show the fee", [{ kind: "reveal", on: lina.id, target: fee.id, start: "hidden" }]) }], { typography });
    expect(out.results[0].ok).toBe(true);
    const p = playPrototype(out.doc, { typography });
    expect(p.text()).not.toContain("Fee");
    p.tap({ path: lina.ref.path });
    expect(p.text()).toContain("Fee");
  });

  it("toast: tapping a layer shows a toast saying what was asked", () => {
    const f = bare(MENU_SCREEN);
    const rating = layer(f, /^Rating/);
    const out = buildSteps(f.doc, f.screen, [{ candidate: ask("Tap the rating to thank the diners", [{ kind: "toast", on: rating.id, text: "Rated by 2,000 diners" }], { kind: "toast", role: "done" }) }], { typography });
    expect(out.results[0].ok).toBe(true);
    const p = playPrototype(out.doc, { typography });
    p.tap({ path: rating.ref.path });
    expect(p.state.open).toHaveLength(1);
    expect(p.textOf(p.state.open[0])).toContain("Rated by 2,000 diners");
  });

  it("open-part: tapping a layer opens the part written for it", () => {
    const f = bare(MENU_SCREEN);
    const top = layer(f, /^TopBar/);
    const sheet: ScreenSpec = { name: "Search", surface: "sheet", header: [{ component: "TopBar", props: { title: "Search the menu", leading: "close" } }], body: [{ component: "SearchBar", props: { placeholder: "Dishes, drinks" } }] };
    const out = buildSteps(f.doc, f.screen, [{ candidate: ask("Tap the top bar to search", [{ kind: "open-part", on: top.id, part: "sheet", text: "Search" }], { kind: "sheet", role: "custom" }), part: sheet }], { typography });
    expect(out.results[0]).toMatchObject({ ok: true, wrote: "model" });
    const p = playPrototype(out.doc, { typography });
    p.tap({ path: top.ref.path });
    expect(p.textOf(p.state.open[0])).toContain("Search the menu");
    // Its close button closes it.
    p.tap({ part: p.state.open[0], name: "Close" });
    expect(p.state.open).toEqual([]);
  });

  it("open-part: a sheet's options pick, and its button closes it", () => {
    const f = bare(MENU_SCREEN);
    const top = layer(f, /^TopBar/);
    const sheet: ScreenSpec = {
      name: "Sort",
      surface: "sheet",
      header: [{ component: "TopBar", props: { title: "Sort by", leading: "close" } }],
      body: [{ component: "Card", props: { title: "Sort", tone: "surface" }, children: [{ component: "ListItem", props: { title: "Popular", trailing: "radio", checked: true } }, { component: "ListItem", props: { title: "Price", trailing: "radio", checked: false } }] }],
      footer: [{ component: "Button", props: { label: "Show dishes", variant: "primary", fullWidth: true } }],
    };
    const out = buildSteps(f.doc, f.screen, [{ candidate: ask("Tap the top bar to sort", [{ kind: "open-part", on: top.id, part: "sheet", text: "Sort" }], { kind: "sheet", role: "custom" }), part: sheet }], { typography });
    expect(out.results[0].ok).toBe(true);
    const p = playPrototype(out.doc, { typography });
    p.tap({ path: top.ref.path });
    const part = p.state.open[0];
    p.tap({ part, path: "body.0.children.1" });
    expect(p.state.data.pick).toBe("body.0.children.1");
    p.tap({ part, name: "Button/Primary" });
    expect(p.state.open).toEqual([]);
  });

  it("can't be built on a layer that isn't there, or with a look the component can't take", () => {
    const f = bare(MENU_SCREEN);
    const plus = layer(f, /^IconButton.*in each item$/);
    const out = buildSteps(
      f.doc,
      f.screen,
      [
        { candidate: ask("Ghost", [{ kind: "toast", on: "l999", text: "Boo" }], { kind: "toast", role: "done" }) },
        { candidate: ask("Bad look", [{ kind: "toggle-look", on: plus.id, look: [{ prop: "variant", value: "sparkly" }] }]) },
      ],
      { typography },
    );
    expect(out.results.map((r) => r.ok)).toEqual([false, false]);
    expect(out.results[0].issues[0]).toMatch(/isn't on the screen/);
    expect(out.results[1].issues[0]).toMatch(/Nothing it can change/);
  });
});
