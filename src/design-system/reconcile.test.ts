import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import tokens from "./tokens.json";
import { buildScreen, type ScreenSpec } from "./builders";
import { BUILTIN_DOCS } from "./docs";
import { TokenSet, type Tree } from "./resolve";
import { describeRebuild, reconcile, structureProposals, structureScore, type ShotFacts } from "./reconcile";
import { styleOf } from "./styles";

/** The screenshot's rebuild: held fixed while the system changes. */
const spec: ScreenSpec = {
  name: "Add money",
  header: [{ component: "TopBar", props: { title: "Add money", leading: "none" } }],
  body: [{ component: "Button", props: { label: "Add money", variant: "primary" } }],
  footer: [
    {
      component: "BottomNav",
      props: {
        active: 0,
        items: [
          { label: "Money", icon: "landmark" },
          { label: "Pay", icon: "dollar-sign" },
          { label: "Activity", icon: "clock" },
        ],
      },
    },
  ],
};
const build = (tree: Tree) => layoutToNodes(buildScreen(spec, new TokenSet(tree)), { dir: "ltr", lang: "en", ts: new TokenSet(tree) }, { x: 0, y: 0 });

/** A Cash App-like screenshot: a floating icon-only pill with a circle, a large title, a 52px pill button. */
const shot: ShotFacts = {
  styles: {
    "component.nav-bar.style.placement": "floating",
    "component.nav-bar.style.labels": "none",
    "component.nav-bar.style.indicator": "pill",
    "component.top-bar.style.title": "large",
  },
  nav: { insetStart: 103, insetEnd: 103, radius: 32, pill: true, height: 64 },
  button: { h: 52, radius: 26, pill: true },
};

const draft = () => structuredClone(tokens) as unknown as Tree;

describe("compare and correct", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  it("reads a rebuild's structure from its layers", () => {
    const f = describeRebuild(build(draft()));
    expect(f.styles["component.nav-bar.style.placement"]).toBe("docked");
    expect(f.styles["component.nav-bar.style.labels"]).toBe("all");
    expect(f.styles["component.top-bar.style.title"]).toBe("center");
    expect(f.present.has("BottomNav")).toBe(true);
    expect(structureScore(shot, f).score).toBeGreaterThan(0.5);
  });

  it("keeps changes that bring the rebuild closer to the screenshot", () => {
    const r = reconcile({
      tree: draft(),
      docs: BUILTIN_DOCS,
      shot,
      build,
      proposals: [
        { path: "component.nav-bar.style.placement", value: "floating", reason: "a pill floats above the bottom" },
        { path: "component.nav-bar.style.labels", value: "none", reason: "icons only" },
        { path: "component.nav-bar.style.indicator", value: "pill", reason: "a circle behind the active icon" },
        { path: "component.top-bar.style.title", value: "large", reason: "the title is a big heading" },
        { path: "component.nav-bar.height", value: "64px", reason: "the pill is 64px tall" },
      ],
    });
    expect(r.applied.map((a) => a.path)).toEqual([
      "component.nav-bar.style.placement",
      "component.nav-bar.style.labels",
      "component.nav-bar.style.indicator",
      "component.top-bar.style.title",
      "component.nav-bar.height",
    ]);
    expect(r.scoreAfter).toBeLessThan(r.scoreBefore);
    const ts = new TokenSet(r.tree);
    expect(styleOf(ts, "component.nav-bar.style.placement")).toBe("floating");
    expect(styleOf(ts, "component.top-bar.style.title")).toBe("large");
  });

  it("rejects changes that move away from the screenshot, can't be drawn, or undo a measurement", () => {
    const r = reconcile({
      tree: draft(),
      docs: BUILTIN_DOCS,
      shot,
      build,
      proposals: [
        { path: "component.nav-bar.style.labels", value: "active", reason: "" },
        { path: "component.nav-bar.style.placement", value: "sideways", reason: "" },
        { path: "component.button.height-lg", value: "72px", reason: "taller buttons" },
      ],
    });
    expect(r.applied).toEqual([]);
    expect(r.rejected.map((x) => x.path)).toEqual(["component.nav-bar.style.labels", "component.nav-bar.style.placement", "component.button.height-lg"]);
    expect(r.rejected[1].why).toMatch(/one of docked, floating/);
    expect(r.rejected[2].after).toBeGreaterThan(r.rejected[2].before!);
    expect(r.tree).toEqual(draft());
  });

  it("offers what nothing on screen can check as a suggestion, without applying it", () => {
    const r = reconcile({ tree: draft(), docs: BUILTIN_DOCS, shot, build, proposals: [{ path: "component.tabs.style.indicator", value: "pill", reason: "tabs look like pills elsewhere" }] });
    expect(r.suggestions.map((s) => s.path)).toEqual(["component.tabs.style.indicator"]);
    expect(styleOf(new TokenSet(r.tree), "component.tabs.style.indicator")).toBe("underline");
  });

  it("proposes the axes the model reads differently from the draft", () => {
    const p = structureProposals({ "nav-bar": { visible: true, placement: "floating", labels: "all", indicator: "none", evidence: "pill bar" }, tabs: { visible: false, indicator: "pill", evidence: "" } }, draft());
    expect(p).toEqual([{ path: "component.nav-bar.style.placement", value: "floating", reason: "pill bar" }]);
  });
});
