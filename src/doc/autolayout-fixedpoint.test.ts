import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import { buildScreen, type ScreenSpec } from "@/design-system/builders";
import { DEMO_SCREENS, HERO_DEMO_SCREENS } from "@/ui/demo";
import { relayoutAll, setAutoLayoutEnabled } from "./autolayout";
import { setTextMeasurer } from "./measure";
import { HERO_FIXTURES, KITCHEN_SINK, wrappingMeasurer } from "./autolayout.fixtures";
import type { Doc } from "./schema";

/** A screen straight from the builders must not move when the live layout runs over it. */
describe("built screens are a fixed point of auto layout", () => {
  beforeAll(async () => {
    await ensureYoga();
    setTextMeasurer(wrappingMeasurer);
    setAutoLayoutEnabled(true);
  });

  const rtl = (s: ScreenSpec): ScreenSpec => ({ ...s, name: `${s.name} (RTL)`, dir: "rtl", lang: "ar" });
  const specs = [...DEMO_SCREENS, ...KITCHEN_SINK, ...KITCHEN_SINK.map(rtl), ...HERO_DEMO_SCREENS, ...HERO_FIXTURES, ...HERO_FIXTURES.map(rtl)];

  it.each(specs.map((s) => [s.name, s] as const))("%s", (_, spec) => {
    const dir = spec.dir ?? "ltr";
    const nodes = layoutToNodes(buildScreen(spec), { dir, lang: spec.lang ?? (dir === "rtl" ? "ar" : "en") }, { x: 40, y: 60 });
    const doc: Doc = { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), roots: [nodes[0].id] };
    expect(nodes.every((n) => n.type !== "frame" || n.layout)).toBe(true);
    const again = relayoutAll(doc);
    const moved = nodes.filter((n) => {
      const m = again.nodes[n.id];
      return [m.x - n.x, m.y - n.y, m.w - n.w, m.h - n.h].some((v) => Math.abs(v) > 0.01);
    });
    expect(moved.map((n) => n.name)).toEqual([]);
    expect(again).toBe(doc);
  });
});
