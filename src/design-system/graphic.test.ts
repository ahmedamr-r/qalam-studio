import { beforeAll, describe, expect, it } from "vitest";
import type { PathNode, SceneNode } from "@/doc/schema";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import tokens from "./tokens.json";
import { buildInstance, buildScreen, type Inst, type LBox, type ScreenSpec } from "./builders";
import { GRAPHIC_COLORS } from "./components";
import { BUILTIN, TokenSet, type Tree } from "./resolve";
import { setToken } from "./contract";
import { lintSpec } from "./spec-lint";

const ctx = { dir: "ltr" as const, lang: "en" as const };

function build(inst: Inst, dir: "ltr" | "rtl" = "ltr", ts: TokenSet = BUILTIN): SceneNode[] {
  const spec = { name: "Screen", body: [inst], dir } as ScreenSpec;
  return layoutToNodes(buildScreen(spec, ts), { dir, lang: dir === "rtl" ? "ar" : "en", ts }, { x: 0, y: 0 });
}
const graphicOf = (ns: SceneNode[]) => ns.find((n) => n.meta.component === "Graphic")!;
const kidsOf = (ns: SceneNode[], p: SceneNode) => ns.filter((n) => n.parentId === p.id);
const flags = (b: LBox): string[] => [...(b.flags ?? []).map((f) => f.rule), ...(b.children ?? []).flatMap(flags)];

const card = (shapes: Record<string, unknown>[], extra: Record<string, unknown> = {}): Inst => ({ component: "Graphic", props: { label: "Card", width: 240, height: 150, shapes, ...extra } });

describe("Graphic", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  it("paints only with colour roles every system has", () => {
    expect(GRAPHIC_COLORS).toContain("bg.brand-strong");
    expect(GRAPHIC_COLORS).toContain("gradient.brand");
    expect(GRAPHIC_COLORS.some((c) => c.startsWith("color.") || c.startsWith("component.") || c.startsWith("#"))).toBe(false);
  });

  it("draws a path as a vector node in its own box, where the path sits", () => {
    const ns = build(card([{ kind: "path", d: "M40 30 L80 30 L80 70 Z", fill: "bg.brand" }]));
    const g = graphicOf(ns);
    const [v] = kidsOf(ns, g) as PathNode[];
    expect(v.type).toBe("path");
    expect([v.x, v.y, v.w, v.h]).toEqual([40, 30, 40, 40]);
    expect(v.d).toBe("M0 0L40 0L40 40Z");
    expect([v.vw, v.vh]).toEqual([40, 40]);
    expect(v.fill?.token).toBe("bg.brand");
  });

  it("grows a stroked path's box by half the outline, so the outline isn't cut", () => {
    const ns = build(card([{ kind: "path", d: "M10 20 H100", stroke: "icon.primary", strokeWidth: 4 }]));
    const [v] = kidsOf(ns, graphicOf(ns)) as PathNode[];
    expect([v.x, v.y, v.w, v.h]).toEqual([8, 18, 94, 4]);
    expect(v.stroke?.token).toBe("icon.primary");
    expect(v.stroke?.width).toBe(4);
    expect(v.fill).toBeNull();
  });

  it("leaves out path data it can't draw, and says so", () => {
    const box = buildInstance(card([{ kind: "path", d: "<path d='M0 0'/>", fill: "bg.brand" }, { kind: "rect", x: 0, y: 0, w: 10, h: 10, fill: "bg.brand" }]), ctx);
    expect(flags(box)).toContain("bad-path");
    expect(box.children).toHaveLength(1);
  });

  it("keeps shapes cropped at the edge and drops ones that never show", () => {
    const box = buildInstance(
      card([
        { kind: "ellipse", x: 200, y: -40, w: 100, h: 100, fill: "bg.brand" },
        { kind: "rect", x: 300, y: 0, w: 40, h: 40, fill: "bg.brand" },
        { kind: "rect", x: 0, y: 0, w: 40, h: 40 },
      ]),
      ctx,
    );
    expect(box.children).toHaveLength(1);
    expect(flags(box).filter((f) => f === "graphic-bounds")).toHaveLength(2);
    expect(flags(buildInstance(card([]), ctx))).toContain("graphic-empty");
  });

  it("mirrors where shapes sit in right-to-left screens, not the art itself", () => {
    const shapes = [
      { kind: "rect", x: 20, y: 10, w: 40, h: 20, fill: "bg.brand" },
      { kind: "path", d: "M100 10 L140 10 L120 40 Z", fill: "bg.inverse" },
    ];
    const ltr = build(card(shapes));
    const rtl = build(card(shapes), "rtl");
    const [lr, lv] = kidsOf(ltr, graphicOf(ltr)) as [SceneNode, PathNode];
    const [rr, rv] = kidsOf(rtl, graphicOf(rtl)) as [SceneNode, PathNode];
    expect(lr.x).toBe(20);
    expect(rr.x).toBe(240 - 20 - 40);
    expect(rv.x).toBe(240 - lv.x - lv.w);
    expect(rv.d).toBe(lv.d);
  });

  it("re-colours with the system: same roles, the other system's colours", () => {
    const tree = structuredClone(tokens) as unknown as Tree;
    setToken(tree, "bg.brand-strong", { $type: "color", $value: "#123456" });
    const other = new TokenSet(tree);
    const g = card([{ kind: "rect", x: 0, y: 0, w: 240, h: 150, fill: "bg.brand-strong", radius: "xl" }]);
    const base = build(g);
    const [a] = kidsOf(base, graphicOf(base));
    const ns = build(g, "ltr", other);
    const [b] = kidsOf(ns, graphicOf(ns));
    expect(a.fill?.token).toBe("bg.brand-strong");
    expect(b.fill?.token).toBe("bg.brand-strong");
    expect(b.fill?.color).toBe("#123456");
    expect(a.fill?.color).not.toBe("#123456");
    expect(b.radius?.token).toBe("radius.xl");
  });

  it("flags a graphic that is really text or UI, and doesn't read path data as copy", () => {
    const words = ["Balance", "AED 1,240", "Send", "Request"].map((text, i) => ({ kind: "text", x: 10, y: i * 30, w: 200, text }));
    const spec = { name: "S", body: [card(words)] } as ScreenSpec;
    expect(lintSpec(spec).map((i) => i.rule)).toContain("graphic-as-ui");
    const art = { name: "S", body: [card([{ kind: "path", d: "M0 0 L10 10 L0 10 Z", fill: "bg.brand" }])] } as ScreenSpec;
    expect(lintSpec(art).filter((i) => i.path === "body.0")).toEqual([]);
  });
});
