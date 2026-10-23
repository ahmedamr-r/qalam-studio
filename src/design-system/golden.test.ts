import { beforeAll, describe, expect, it } from "vitest";
import type { SceneNode } from "@/doc/schema";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import { buildScreen } from "./builders";
import { BUILTIN, px } from "./resolve";
import { DEMO_SCREENS } from "@/ui/demo";

/**
 * Golden output of the built-in design system: what the demo screens look like, independent of
 * node ids and of which token paths the builders bind to. Refactors of the token pipeline must
 * keep this snapshot byte-identical.
 */
function visual(nodes: SceneNode[]) {
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  return nodes.map((n) => {
    const v = n.shadowToken ? BUILTIN.get(n.shadowToken)?.value : undefined;
    const legacy = v && !Array.isArray(v) ? (v as Record<string, string>) : undefined;
    const effects =
      (n as { effects?: unknown[] }).effects ??
      (legacy ? [{ kind: "drop", x: px(legacy.offsetX), y: px(legacy.offsetY), blur: px(legacy.blur), spread: px(legacy.spread), color: legacy.color }] : []);
    return {
      i: idx.get(n.id),
      parent: n.parentId ? idx.get(n.parentId) : null,
      type: n.type,
      name: n.name,
      box: [n.x, n.y, n.w, n.h].map((v) => Math.round(v * 100) / 100),
      fill: n.fill ? [n.fill.color, (n.fill as { gradient?: unknown }).gradient ?? null] : null,
      stroke: n.stroke ? [n.stroke.color, n.stroke.width] : null,
      radius: n.radius ? [n.radius.tl.rx, n.radius.tr.rx, n.radius.br.rx, n.radius.bl.rx] : null,
      effects: effects.length ? effects : null,
      text: n.type === "text" ? { ...n.text, typeToken: undefined } : undefined,
      icon: n.type === "icon" ? [n.icon, n.mirrored, n.strokeWidth] : undefined,
    };
  });
}

describe("built-in design system output (golden)", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  it.each(DEMO_SCREENS.map((s) => [s.name, s] as const))("%s", (_, spec) => {
    const dir = spec.dir ?? "ltr";
    const nodes = layoutToNodes(buildScreen(spec), { dir, lang: spec.lang ?? (dir === "rtl" ? "ar" : "en") }, { x: 0, y: 0 });
    expect(visual(nodes)).toMatchSnapshot();
  });
});
