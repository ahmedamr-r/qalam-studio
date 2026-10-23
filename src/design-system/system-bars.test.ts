import { beforeAll, describe, expect, it } from "vitest";
import type { FrameNode, SceneNode } from "@/doc/schema";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import tokens from "./tokens.json";
import { buildScreen, type ScreenSpec } from "./builders";
import { BUILTIN, TokenSet, type Tree } from "./resolve";
import { setToken } from "./contract";

/** System bars take the colour of the surface they touch, in any system. */

function system(values: Record<string, string>): TokenSet {
  const tree = structuredClone(tokens) as unknown as Tree;
  for (const [path, value] of Object.entries(values)) setToken(tree, path, { $type: "color", $value: value });
  return new TokenSet(tree);
}
function build(spec: Partial<ScreenSpec>, ts: TokenSet = BUILTIN): SceneNode[] {
  const full = { name: "Screen", body: [{ component: "Text", props: { text: "Hello" } }], ...spec } as ScreenSpec;
  return layoutToNodes(buildScreen(full, ts), { dir: "ltr", lang: "en", ts }, { x: 0, y: 0 });
}
const node = (ns: SceneNode[], name: string) => ns.find((n) => n.name === name) as FrameNode;
const fillOf = (n: SceneNode | undefined) => (n?.fill as { token?: string; color?: string } | null | undefined) ?? undefined;
const topBar = { component: "TopBar", props: { title: "Orders", leading: "back" } };

describe("system bars", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  it("the status bar takes a coloured top bar's fill (a white bar on a tinted screen)", () => {
    const ns = build({ background: "surface", header: [topBar] }, system({ "bg.surface": "#F4EDE3" }));
    expect(fillOf(node(ns, "Status bar"))?.color).toBe(fillOf(node(ns, "TopBar"))?.color);
  });

  it("on a dark top bar the status bar turns dark, with light glyphs", () => {
    const ns = build({ header: [topBar] }, system({ "component.top-bar.fill": "#101418" }));
    expect(fillOf(node(ns, "Status bar"))?.color).toBe("#101418");
    expect(fillOf(node(ns, "9:41"))?.token).toBe("text.inverse");
  });

  it("a status bar over a top bar that matches the screen stays clear (nothing changes)", () => {
    const ns = build({ header: [topBar] });
    expect(fillOf(node(ns, "Status bar"))).toBeUndefined();
    expect(fillOf(node(ns, "9:41"))?.token).toBe("text.primary");
  });

  it("the home indicator takes the footer's fill on a tinted screen", () => {
    const ns = build({ background: "surface", footer: [{ component: "Button", props: { label: "Checkout", variant: "primary", fullWidth: true } }] }, system({ "bg.surface": "#F4EDE3" }));
    expect(fillOf(node(ns, "Home indicator"))?.color).toBe(fillOf(node(ns, "Footer"))?.color);
  });

  it("the home indicator under a docked tab bar keeps the bar's colour", () => {
    const nav = { component: "BottomNav", props: { active: 0, items: [{ label: "Home", icon: "house" }, { label: "Account", icon: "user" }] } };
    const ns = build({ footer: [nav] });
    expect(fillOf(node(ns, "Home indicator"))?.token).toBe("component.nav-bar.fill");
  });
});

describe("empty pictures on tinted surfaces", () => {
  beforeAll(async () => {
    await ensureYoga();
  });
  const tinted = system({ "bg.surface": "#F4EDE3" });
  const pic = { component: "Image", props: { alt: "Dish", aspect: "1:1", src: "" } };

  it("stay visible on a tinted screen, where the usual tint would vanish", () => {
    const ns = build({ background: "surface", body: [pic] }, tinted);
    expect(fillOf(node(ns, "Dish"))?.color).not.toBe("#F4EDE3");
  });

  it("keep the usual tint on a white screen or a white card, and change inside a tinted card", () => {
    expect(fillOf(node(build({ body: [pic] }, tinted), "Dish"))?.token).toBe("bg.surface");
    const inCard = (tone: string) => build({ body: [{ component: "Card", props: { tone }, children: [pic] }] }, tinted);
    expect(fillOf(node(inCard("raised"), "Dish"))?.token).toBe("bg.surface");
    expect(fillOf(node(inCard("surface"), "Dish"))?.color).not.toBe("#F4EDE3");
  });
});
