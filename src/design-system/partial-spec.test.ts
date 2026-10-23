import { beforeAll, describe, expect, it } from "vitest";
import { parsePartial } from "@/ai/partial-json";
import { SAMPLE_GENERATE } from "@/ai/fixtures";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import { buildScreen, type Inst, type ScreenSpec } from "./builders";
import { firstComponents, partialGenerate, settledItems, specPaths } from "./partial-spec";
import type { Platform } from "./platform";

const FULL = JSON.stringify(SAMPLE_GENERATE);

/** Component and props at each path: what must never change once shown. */
function atPaths(spec: ScreenSpec): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (list: Inst[] | undefined, prefix: string) =>
    (list ?? []).forEach((inst, i) => {
      out.set(`${prefix}.${i}`, JSON.stringify([inst.component, inst.props ?? null]));
      walk(inst.children, `${prefix}.${i}.children`);
    });
  for (const r of ["header", "sidebar", "hero", "body", "footer"] as const) walk(spec[r], r);
  return out;
}

describe("partialGenerate", () => {
  it("only ever adds components as the response grows, and they match the finished screens", () => {
    const final = partialGenerate(parsePartial(FULL), "mobile");
    const finalPaths = final.variants.map((v) => atPaths(v.spec));
    let seen: Map<string, string>[] = [];
    for (let n = 1; n <= FULL.length; n += 11) {
      const now = partialGenerate(parsePartial(FULL.slice(0, n)), "mobile").variants.map((v) => atPaths(v.spec));
      now.forEach((paths, vi) => {
        for (const [p, v] of paths) expect(v, `variant ${vi} ${p} at ${n}`).toBe(finalPaths[vi].get(p));
        for (const p of seen[vi]?.keys() ?? []) expect(paths.has(p), `variant ${vi} lost ${p} at ${n}`).toBe(true);
      });
      seen = now;
    }
  });

  it("returns the finished screens once the response is complete, on the requested platform", () => {
    const got = partialGenerate(parsePartial(FULL), "web");
    expect(got.approach).toBe(SAMPLE_GENERATE.approach);
    expect(got.approachDone).toBe(true);
    expect(got.variants).toHaveLength(SAMPLE_GENERATE.variants.length);
    got.variants.forEach((v, i) => {
      const want = SAMPLE_GENERATE.variants[i];
      expect(v.done).toBe(true);
      expect(v.spec.platform).toBe("web");
      expect(v.spec.body).toEqual(want.body);
      expect(v.spec.header ?? []).toEqual(want.header ?? []);
      expect(v.spec.footer ?? []).toEqual(want.footer ?? []);
      expect(v.name).toBe(want.name);
    });
  });

  it("streams the approach and names before any screen can be built", () => {
    const cut = FULL.indexOf('"variants"') + 30;
    const got = partialGenerate(parsePartial(FULL.slice(0, cut)), "mobile");
    expect(got.approachDone).toBe(true);
    expect(got.variants[0]?.buildable ?? false).toBe(false);
  });

  it("drops a component whose props aren't finished, keeps a container once they are", () => {
    expect(settledItems((parsePartial('{"a":[{"component":"Text","props":{"text":"Hel') as { a: unknown }).a)).toEqual([]);
    const list = (parsePartial('{"a":[{"component":"Card","props":{},"children":[{"component":"Text","props":{"text":"Hi"}},{"component":"Te') as { a: unknown }).a;
    expect(settledItems(list)).toEqual([{ component: "Card", props: {}, children: [{ component: "Text", props: { text: "Hi" } }] }]);
  });
});

describe("firstComponents", () => {
  it("keeps components in reading order", () => {
    const spec = SAMPLE_GENERATE.variants[0];
    const all = specPaths(spec);
    for (const k of [0, 1, 3, all.length]) expect(specPaths(firstComponents(spec, k))).toEqual(all.slice(0, k));
  });
});

describe("partial screens build", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  it.each(["mobile", "web", "dashboard"] as Platform[])("on %s, from an empty frame to the full screen", (platform) => {
    for (const frac of [0.15, 0.4, 0.7, 1]) {
      const got = partialGenerate(parsePartial(FULL.slice(0, Math.round(FULL.length * frac))), platform);
      for (const v of got.variants) {
        const nodes = layoutToNodes(buildScreen(v.spec), { dir: v.spec.dir ?? "ltr", lang: v.spec.lang ?? "en" }, { x: 0, y: 0 });
        expect(nodes.length).toBeGreaterThan(0);
        const paths = new Set(nodes.map((n) => n.meta.specPath).filter(Boolean));
        for (const p of specPaths(v.spec)) expect(paths.has(p), `${platform} ${p}`).toBe(true);
      }
    }
  });
});

describe("components made while generating", () => {
  const def = { name: "Cash Card", purpose: "The member's card", props: [{ name: "last4", kind: "text", maxChars: 4, example: "4821" }], composition: { component: "Graphic", props: { label: "Cash Card", height: 120, shapes: [{ kind: "rect", x: 0, y: 0, w: 200, h: 120, fill: "bg.brand" }] } } };
  const answer = {
    approach: "Card first.",
    newComponents: [def, { name: "Card", purpose: "clashes with the catalog", props: [], composition: { component: "Text", props: { text: "x" } } }],
    variants: [
      { name: "Money", rationale: "r", platform: "mobile", margin: null, dir: "ltr", lang: "en", background: "canvas", header: [], sidebar: [], hero: [], overlap: "none", body: [{ component: "Custom", props: { name: "Cash Card", values: [{ prop: "last4", value: "9012" }] } }], footer: [] },
      { name: "Pay", rationale: "r", platform: "mobile", margin: null, dir: "ltr", lang: "en", background: "canvas", header: [], sidebar: [], hero: [], overlap: "none", body: [{ component: "Text", props: { text: "Pay" } }], footer: [] },
    ],
  };

  it("gives each screen the definitions it places, once they're written in full", () => {
    const got = partialGenerate(parsePartial(JSON.stringify(answer)), "mobile");
    expect(got.variants[0].spec.components?.map((d) => d.name)).toEqual(["Cash Card"]);
    expect(got.variants[1].spec.components).toBeUndefined();
    // A definition still being written isn't used yet.
    const text = JSON.stringify(answer);
    const cut = text.indexOf('"composition"') + 30;
    expect(partialGenerate(parsePartial(text.slice(0, cut)), "mobile").variants).toEqual([]);
  });

  it("drops a definition named like a catalog component", () => {
    const got = partialGenerate(parsePartial(JSON.stringify({ ...answer, variants: [{ ...answer.variants[0], body: [{ component: "Custom", props: { name: "Card" } }] }] })), "mobile");
    expect(got.variants[0].spec.components).toBeUndefined();
  });
});
