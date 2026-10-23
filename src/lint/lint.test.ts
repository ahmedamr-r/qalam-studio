import { beforeAll, describe, expect, it } from "vitest";
import { auditSubtree, effectiveBackground } from "./rules";
import { makeFrame, makeIcon, makeText } from "@/doc/factory";
import type { Doc, SceneNode } from "@/doc/schema";
import { uniformRadius } from "@/doc/schema";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import { buildScreen, type ScreenSpec } from "@/design-system/builders";
import { DEMO_SCREENS, HERO_DEMO_SCREENS } from "@/ui/demo";

function docOf(nodes: SceneNode[]): Doc {
  const d: Doc = { nodes: {}, roots: [] };
  for (const n of nodes) {
    d.nodes[n.id] = n;
    if (!n.parentId) d.roots.push(n.id);
  }
  return d;
}

function child<T extends SceneNode>(parent: SceneNode, n: T): T {
  n.parentId = parent.id;
  parent.children.push(n.id);
  return n;
}

describe("linter", () => {
  it("catches custom grey caption text and suggests text.secondary", () => {
    const f = makeFrame({ fill: { color: "#FFFFFF", token: "bg.canvas" } });
    const t = child(f, makeText({ fill: { color: "#8A8A8A" }, text: { content: "Delivery to Dubai Marina", fontSize: 14, fontWeight: 400, lineHeight: 20, typeToken: undefined } }));
    const findings = auditSubtree(docOf([f, t]), [f.id]);
    const color = findings.find((x) => x.rule === "off-token-color")!;
    expect(color.replaceWith).toBe("text.secondary");
    expect(findings.find((x) => x.rule === "contrast")?.wcag).toMatch(/1\.4\.3/);
    expect(findings.find((x) => x.rule === "off-scale-type")).toBeTruthy();
  });

  it("finds the painted background from covering siblings", () => {
    const f = makeFrame({ fill: { color: "#FFFFFF" } });
    const card = child(f, makeFrame({ name: "Card", x: 0, y: 0, w: 200, h: 100, fill: { color: "#161C5B", token: "bg.brand-strong" }, radius: uniformRadius(16) }));
    const t = child(f, makeText({ x: 10, y: 10, w: 100, h: 20, fill: { color: "#0E1342" } }));
    expect(effectiveBackground(docOf([f, card, t]), t.id).token).toBe("bg.brand-strong");
  });

  it("flags RTL problems in Arabic copy", () => {
    const f = makeFrame({ dir: "rtl" });
    const t = child(f, makeText({ text: { content: "خصم ٢٥٪ على طلبك", direction: "ltr", letterSpacing: 0.5, fontFamily: "Inter" } }));
    const i = child(f, makeIcon("arrow-left"));
    const rules = auditSubtree(docOf([f, t, i]), [f.id]).map((x) => x.rule);
    expect(rules).toEqual(expect.arrayContaining(["rtl-direction", "arabic-letter-spacing", "arabic-font", "rtl-icon-mirror"]));
  });

  it("flags small interactive targets but honours hit areas", () => {
    const f = makeFrame();
    const small = child(f, makeFrame({ w: 28, h: 28, meta: { source: "user", interactive: true } }));
    const chip = child(f, makeFrame({ w: 80, h: 36, meta: { source: "user", interactive: true, hitArea: 44 } }));
    const findings = auditSubtree(docOf([f, small, chip]), [f.id]).filter((x) => x.rule === "touch-target");
    expect(findings.map((x) => x.nodeId)).toEqual([small.id]);
  });
});

describe("generated screens", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  it("lays out demo screens at 390pt wide with no token errors", () => {
    for (const spec of [...DEMO_SCREENS, ...HERO_DEMO_SCREENS]) {
      const nodes = layoutToNodes(buildScreen(spec), { dir: spec.dir ?? "ltr", lang: spec.lang ?? "en" }, { x: 0, y: 0 });
      expect(nodes[0].w).toBe(390);
      expect(nodes[0].h).toBeGreaterThanOrEqual(844);
      const doc = docOf(nodes);
      const tokenErrors = auditSubtree(doc, [nodes[0].id]).filter((f) => f.category === "tokens" && f.severity !== "info");
      expect(tokenErrors, spec.name).toEqual([]);
    }
  });

  it("mirrors rows in RTL (first child sits on the right)", () => {
    const spec = DEMO_SCREENS.find((s) => s.dir === "rtl")!;
    const nodes = layoutToNodes(buildScreen(spec), { dir: "rtl", lang: "ar" }, { x: 0, y: 0 });
    const topBar = nodes.find((n) => n.meta.component === "TopBar")!;
    const back = nodes.find((n) => n.parentId === topBar.id)!;
    expect(back.x).toBeGreaterThan(300);
  });
});

describe("desktop apps", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  it("builds editor parts with system tokens only, and holds pointer targets to 24px, not the touch size", () => {
    const spec: ScreenSpec = {
      name: "Reel · Edit",
      platform: "app",
      header: [
        { component: "Text", props: { text: "Harbour promo", style: "headline" } },
        { component: "Toolbar", props: { tools: [{ icon: "mouse-pointer-2", label: "Select" }, { icon: "scissors", label: "Split" }], selected: 0 } },
      ],
      body: [
        {
          component: "Stack",
          props: { direction: "horizontal", gap: "400" },
          children: [
            { component: "Player", props: { label: "Shot 2", current: "00:42", duration: "02:30", progress: 28 } },
            {
              component: "Panel",
              props: { title: "Clip" },
              children: [
                { component: "PropertyRow", props: { label: "Speed", value: "1.0×", control: "stepper" } },
                { component: "PropertyRow", props: { label: "Loop", control: "toggle", on: true } },
                { component: "Slider", props: { label: "Volume", value: 70, valueText: "-3 dB" } },
              ],
            },
          ],
        },
      ],
      footer: [{ component: "Timeline", props: { duration: 90, playhead: 20, tracks: [{ label: "Music", kind: "audio", clips: [{ label: "Oud theme", start: 0, end: 80 }] }] } }],
    };
    const nodes = layoutToNodes(buildScreen(spec), { dir: "ltr", lang: "en" }, { x: 0, y: 0 });
    nodes[0].meta.spec = spec;
    const findings = auditSubtree(docOf(nodes), [nodes[0].id]);
    expect(nodes.flatMap((n) => n.meta.flags ?? []).filter((f) => f.rule === "unknown-token")).toEqual([]);
    expect(findings.filter((f) => f.rule === "touch-target")).toEqual([]);
    // The same 32px tools on a phone are below the system's touch size.
    const phone = layoutToNodes(buildScreen({ ...spec, platform: "mobile" }), { dir: "ltr", lang: "en" }, { x: 0, y: 0 });
    phone[0].meta.spec = { ...spec, platform: "mobile" };
    expect(auditSubtree(docOf(phone), [phone[0].id]).some((f) => f.rule === "touch-target")).toBe(true);
  });
});
