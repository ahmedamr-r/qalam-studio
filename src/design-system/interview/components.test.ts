import { beforeAll, describe, expect, it } from "vitest";
import type { Doc, SceneNode } from "@/doc/schema";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import { auditNode } from "@/lint/rules";
import { buildScreen, type ScreenSpec } from "../builders";
import { TokenSet } from "../resolve";
import { lintSpec } from "../spec-lint";
import { COMPONENTS, COMPONENT_BY_NAME, SYSTEM, customised, overrideEntries, withComponentChoice } from "./components";
import { expandKnobs } from "./expand";
import { countComponents, keystoneFor, keystoneSpec, pyramid } from "./keystones";
import { DOMAINS, knobHash } from "./knobs";
import { readOf } from "./samples";
import { baselineKnobs } from "./table";

const base = baselineKnobs(readOf("consumer-finance"));

beforeAll(async () => {
  await ensureYoga();
});

function build(spec: ScreenSpec, ts: TokenSet): SceneNode[] {
  return layoutToNodes(buildScreen(spec, ts), { dir: "ltr", lang: "en", ts }, { x: 0, y: 0 }, "user");
}

describe("shaping one component", () => {
  it("keeps every choice complete and legible", () => {
    for (const c of COMPONENTS)
      for (const o of c.options)
        for (const v of o.values) {
          if (v.value === SYSTEM) continue;
          const e = expandKnobs(withComponentChoice(base, c.name, o.id, v.value), { platform: "mobile" });
          expect(e.failures, `${c.name}.${o.id}=${v.value}`).toEqual([]);
          expect(new TokenSet(e.tree).unresolved(), `${c.name}.${o.id}=${v.value}`).toEqual([]);
        }
  }, 30_000); // an expansion per choice: slow when the whole suite runs in parallel

  it("changes only that component's tokens", () => {
    const a = new TokenSet(expandKnobs(base).tree);
    const b = new TokenSet(expandKnobs(withComponentChoice(base, "Button", "shape", "pill")).tree);
    expect(b.dimension("component.button.radius")).toBe(999);
    const changed = a.tokens.filter((t) => JSON.stringify(t.value) !== JSON.stringify(b.get(t.path)?.value)).map((t) => t.path);
    expect(changed).toEqual(["component.button.radius"]);
  });

  it("follows the system until a choice is made, and again once it's cleared", () => {
    expect(overrideEntries(base)).toEqual([]);
    const k = withComponentChoice(base, "Table", "rows", "40");
    expect(customised(k, "Table")).toBe(1);
    const back = withComponentChoice(k, "Table", "rows", SYSTEM);
    expect(back.components).toBeUndefined();
    expect(knobHash(back)).toBe(knobHash(base));
  });

  it("hashes the same choices the same, whatever order they were made in", () => {
    const a = withComponentChoice(withComponentChoice(base, "Button", "shape", "pill"), "Tag", "size", "28");
    const b = withComponentChoice(withComponentChoice(base, "Tag", "size", "28"), "Button", "shape", "pill");
    expect(knobHash(a)).toBe(knobHash(b));
    expect(knobHash(a)).not.toBe(knobHash(base));
  });

  it("offers a system choice first, and sheets that build", () => {
    const ts = new TokenSet(expandKnobs(base).tree);
    for (const c of COMPONENTS) {
      for (const o of c.options) expect(o.values[0].value).toBe(SYSTEM);
      const counts = countComponents(c.sheet());
      expect(counts.get(c.name) ?? 0, c.name).toBeGreaterThan(0);
      expect(build(c.sheet(), ts).length).toBeGreaterThan(1);
    }
  });
});

describe("keystones and the pyramid", () => {
  for (const domain of DOMAINS)
    for (const platform of ["mobile", "web"] as const) {
      it(`gives ${domain} on ${platform} a clean, legible keystone`, () => {
        const read = readOf(domain, {}, { platform });
        const spec = keystoneSpec(read);
        const ts = new TokenSet(expandKnobs(baselineKnobs(read)).tree);
        expect(lintSpec(spec, ts)).toEqual([]);
        const nodes = build(spec, ts);
        const doc: Doc = { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), roots: [nodes[0].id] };
        const contrast = nodes.flatMap((n) => auditNode(doc, n, ts)).filter((f) => f.rule === "contrast" || f.rule === "non-text-contrast");
        expect(contrast.map((f) => f.message)).toEqual([]);
        // Every part is really in the keystone, and can be shaped.
        const counts = countComponents(spec);
        for (const p of keystoneFor(domain).parts) {
          expect(COMPONENT_BY_NAME.has(p.component), p.component).toBe(true);
          expect(counts.get(p.component) ?? 0, `${domain}: ${p.component}`).toBeGreaterThan(0);
        }
      });
    }

  it("puts the keystone's parts at the base, then what the screens use, then the rest", () => {
    const read = readOf("b2b-finance", {}, { platform: "web" });
    const { keystone, tiers } = pyramid(read);
    expect(keystone.name).toBe("Payments table");
    expect(tiers[0].components).toEqual(keystone.parts.map((p) => p.component));
    const all = tiers.flatMap((t) => t.components);
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(COMPONENTS.map((c) => c.name)));
  });

  it("counts the status tags a table draws", () => {
    const counts = countComponents({ name: "x", body: [{ component: "Table", props: { columns: ["a", "b"], rows: [{ cells: ["1", "Paid"] }, { cells: ["2", "Failed"] }], statusColumn: 1 } }] });
    expect(counts.get("Tag")).toBe(2);
  });
});

describe("the components step's state", () => {
  it("records choices in history, resets them, and marks components reviewed", async () => {
    const { pickDirection, setComponentChoice, resetComponent, markReviewed, undo, setComponentsMode } = await import("@/projects/interview");
    let s = pickDirection({ v: 1, stage: "directions", directions: { list: [{ name: "A", rationale: "", knobs: base, source: "code" }], recommended: 0 } }, 0, 1);
    s = setComponentsMode(s, "individual");
    expect(s.components).toEqual({ reviewed: [], mode: "individual" });
    s = setComponentChoice(s, "Table", "rows", "40", "Tables · Row height: Compact", 2);
    expect(s.knobs?.components).toEqual({ Table: { rows: "40" } });
    expect(setComponentChoice(s, "Table", "rows", "40", "again", 3)).toBe(s);
    s = setComponentChoice(s, "Button", "shape", "pill", "Buttons · Corners: Pill", 3);
    s = resetComponent(s, "Table", 4);
    expect(s.knobs?.components).toEqual({ Button: { shape: "pill" } });
    s = undo(s);
    expect(s.knobs?.components).toEqual({ Table: { rows: "40" }, Button: { shape: "pill" } });
    s = markReviewed(markReviewed(s, "Table"), "Table");
    expect(s.components?.reviewed).toEqual(["Table"]);
  });
});
