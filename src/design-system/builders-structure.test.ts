import { beforeAll, describe, expect, it } from "vitest";
import type { SceneNode } from "@/doc/schema";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import tokens from "./tokens.json";
import { buildScreen, type Inst, type ScreenSpec } from "./builders";
import { CATALOG } from "./components";
import { TokenSet, type Tree } from "./resolve";
import { setToken } from "./contract";
import { STYLE_AXES } from "./styles";

/** The built-in system with some structure axes (and tokens) changed. */
function system(values: Record<string, unknown>): TokenSet {
  const tree = structuredClone(tokens) as unknown as Tree;
  for (const [path, value] of Object.entries(values)) {
    const type = typeof value !== "string" || value.startsWith("{") ? undefined : /^\d+px$/.test(value) ? "dimension" : "string";
    setToken(tree, path, { $value: value, ...(type ? { $type: type } : {}) });
  }
  return new TokenSet(tree);
}

function build(spec: Partial<ScreenSpec>, ts: TokenSet, dir: "ltr" | "rtl" = "ltr"): SceneNode[] {
  const full = { name: "Screen", body: [], ...spec, dir } as ScreenSpec;
  return layoutToNodes(buildScreen(full, ts), { dir, lang: dir === "rtl" ? "ar" : "en", ts }, { x: 0, y: 0 });
}
const kids = (ns: SceneNode[], p: SceneNode) => ns.filter((n) => n.parentId === p.id);
const under = (ns: SceneNode[], p: SceneNode): SceneNode[] => kids(ns, p).flatMap((k) => [k, ...under(ns, k)]);
const byName = (ns: SceneNode[], name: string) => ns.find((n) => n.name === name)!;
/** x of a node in the screen's coordinates. */
const absX = (ns: SceneNode[], n: SceneNode): number => (n.parentId ? absX(ns, ns.find((p) => p.id === n.parentId)!) + n.x : 0);

const nav: Inst = {
  component: "BottomNav",
  props: {
    active: 0,
    items: [
      { label: "Money", icon: "landmark" },
      { label: "Pay", icon: "dollar-sign" },
      { label: "Activity", icon: "clock" },
    ],
  },
};

describe("component structure in builds", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  it("draws a floating nav as an inset rounded bar, with the strip under it clear", () => {
    const ns = build({ footer: [nav] }, system({ "component.nav-bar.style.placement": "floating", "component.nav-bar.inset": "24px" }));
    const bar = byName(ns, "Bar");
    expect(absX(ns, bar)).toBe(24);
    expect(bar.w).toBe(390 - 48);
    expect(bar.radius?.tl.rx).toBeGreaterThan(20);
    expect(byName(ns, "Home indicator").fill).toBeFalsy();
    // Docked, as built in: no bar, the home strip matches the canvas.
    const docked = build({ footer: [nav] }, system({}));
    expect(docked.some((n) => n.name === "Bar" && n.parentId && docked.find((p) => p.id === n.parentId)?.name === "BottomNav")).toBe(false);
    expect(byName(docked, "Home indicator").fill).toBeTruthy();
  });

  it("hugs and centres an icon-only floating bar, keeping each tab's name", () => {
    const ns = build({ footer: [nav] }, system({ "component.nav-bar.style.placement": "floating", "component.nav-bar.style.labels": "none", "component.nav-bar.style.indicator": "pill" }));
    const bar = byName(ns, "Bar");
    expect(Math.round(absX(ns, bar) + bar.w / 2)).toBe(195);
    expect(bar.w).toBeLessThan(250);
    expect(under(ns, bar).filter((n) => n.type === "text")).toHaveLength(0);
    expect(kids(ns, bar).map((t) => t.name)).toEqual(["Tab/Money", "Tab/Pay", "Tab/Activity"]);
    const mark = byName(ns, "Indicator");
    expect([mark.w, mark.h]).toEqual([56, 32]);
    expect(mark.fill).toBeTruthy();
    // As wide as it is tall: a circle.
    const circle = build({ footer: [nav] }, system({ "component.nav-bar.style.placement": "floating", "component.nav-bar.style.labels": "none", "component.nav-bar.style.indicator": "pill", "component.nav-bar.indicator-size": "44px", "component.nav-bar.indicator-width": "44px" }));
    expect([byName(circle, "Indicator").w, byName(circle, "Indicator").h]).toEqual([44, 44]);
  });

  it("shows labels on every tab, the active one only, or none", () => {
    const texts = (labels: string) => {
      const ns = build({ footer: [nav] }, system({ "component.nav-bar.style.labels": labels }));
      return under(ns, byName(ns, "BottomNav")).filter((n) => n.type === "text").map((n) => (n as { text: { content: string } }).text.content);
    };
    expect(texts("all")).toEqual(["Money", "Pay", "Activity"]);
    expect(texts("active")).toEqual(["Money"]);
    expect(texts("none")).toEqual([]);
  });

  it("marks the active tab with a dot or a line", () => {
    for (const [kind, type] of [["dot", "ellipse"], ["line", "rect"]] as const) {
      const ns = build({ footer: [nav] }, system({ "component.nav-bar.style.indicator": kind }));
      expect(byName(ns, "Indicator").type).toBe(type);
    }
  });

  it("puts the title on the start edge, or large under the bar, in both directions", () => {
    const top: Inst = { component: "TopBar", props: { title: "Add money", leading: "back" } };
    for (const dir of ["ltr", "rtl"] as const) {
      const start = build({ header: [top] }, system({ "component.top-bar.style.title": "start" }), dir);
      const bar = byName(start, "TopBar");
      const title = kids(start, bar).find((n) => n.type === "text")!;
      const back = kids(start, bar).find((n) => n.name === "Back")!;
      // Right after the back button on the start edge.
      if (dir === "ltr") expect(title.x).toBe(back.x + back.w + 8);
      else expect(title.x + title.w).toBe(back.x - 8);
      const large = build({ header: [{ component: "TopBar", props: { title: "Add money" } }] }, system({ "component.top-bar.style.title": "large" }), dir);
      const big = large.find((n) => n.type === "text" && (n as { text: { content: string } }).text.content === "Add money")! as SceneNode & { text: { typeToken?: string } };
      expect(big.text.typeToken).toBe("type.title-lg");
      // Under the bar with the buttons, on the start edge.
      const row = large.find((n) => n.name === "Bar" && kids(large, n).some((k) => k.name === "Back"))!;
      const box = large.find((n) => n.id === big.parentId)!;
      expect(box.y).toBeGreaterThanOrEqual(row.y + row.h);
      if (dir === "ltr") expect(absX(large, big)).toBe(16);
      else expect(Math.round(absX(large, big) + big.w)).toBe(390 - 16);
    }
  });

  it("marks the selected tab with a pill and no underline", () => {
    const ns = build({ body: [{ component: "Tabs", props: { tabs: ["All", "Food", "Rides"], selected: 1 } }] }, system({ "component.tabs.style.indicator": "pill" }));
    const tabs = byName(ns, "Tabs");
    expect(under(ns, tabs).some((n) => n.name === "Border" || n.name === "Indicator")).toBe(false);
    expect(byName(ns, "Tab/Food").fill).toBeTruthy();
    expect(byName(ns, "Tab/All").fill).toBeFalsy();
  });

  it("draws list rows the system's way: bare icons, inset dividers between rows, chevrons unless a row says otherwise", () => {
    const row = (title: string, props: Record<string, unknown> = {}): Inst => ({ component: "ListItem", props: { title, leadingIcon: "landmark", ...props } });
    const ts = system({ "component.list-item.style.leading": "bare", "component.list-item.style.divider": "inset", "component.list-item.style.chevron": "shown" });
    const ns = build({ body: [{ component: "Card", props: { tone: "surface" }, children: [row("Direct deposit"), row("Deposit check"), row("Auto reload", { trailing: "toggle" })] }] }, ts);
    expect(ns.some((n) => n.name === "Leading")).toBe(false);
    const lines = ns.filter((n) => n.name === "Divider/auto");
    // Between the three rows, not after the last one.
    expect(lines).toHaveLength(2);
    expect(lines[0].x).toBe(24 + 12);
    const chevrons = ns.filter((n) => n.type === "icon" && (n as { icon: string }).icon === "chevron-right");
    expect(chevrons).toHaveLength(2);
    // A row's own divider prop wins over the system's.
    const own = build({ body: [row("Deposit check", { divider: false })] }, ts);
    expect(own.some((n) => n.name.startsWith("Divider"))).toBe(false);
  });

  it("draws bare service tiles without a card", () => {
    const grid: Inst = { component: "ServiceGrid", props: { columns: 4, tiles: [{ label: "Ride", icon: "car" }, { label: "Food", icon: "utensils" }] } };
    const ns = build({ body: [grid] }, system({ "component.tile.style.layout": "bare" }));
    const tile = byName(ns, "Tile/Ride");
    expect(tile.fill).toBeFalsy();
    expect(tile.h).toBeLessThan(92);
  });

  it("builds every catalog example with every structure value", () => {
    for (const a of STYLE_AXES)
      for (const v of a.values) {
        const ts = system({ [a.path]: v });
        for (const c of CATALOG) {
          const inst: Inst = { component: c.name, props: c.example, children: c.exampleChildren };
          expect(() => build({ body: [inst] }, ts), `${c.name} with ${a.path}=${v}`).not.toThrow();
        }
      }
  });
});
