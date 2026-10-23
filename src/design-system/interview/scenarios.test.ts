import { beforeAll, describe, expect, it } from "vitest";
import type { Doc, SceneNode } from "@/doc/schema";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import { auditNode } from "@/lint/rules";
import { buildScreen, type ScreenSpec } from "../builders";
import { CATALOG_BY_NAME } from "../components";
import { TokenSet } from "../resolve";
import { lintSpec } from "../spec-lint";
import { describeCounts, diffInstances, diffTokens } from "./diff";
import { expandKnobs } from "./expand";
import { DOMAINS, type Knobs } from "./knobs";
import { readOf } from "./samples";
import { scenarios } from "./scenarios";
import { baselineKnobs } from "./table";

const SLOTS = {
  brand: "Lumen Financial Services International",
  currency: "AED",
  city: "Dubai",
  people: ["Sara Haddad", "Omar Nasser", "Lina Farouk"],
  places: ["Dubai Marina", "Downtown", "Business Bay"],
  ar: { brand: "لومن", city: "دبي", people: ["سارة حداد", "عمر ناصر", "لينا فاروق"] },
};

function build(spec: ScreenSpec, ts: TokenSet): SceneNode[] {
  const dir = spec.dir ?? "ltr";
  return layoutToNodes(buildScreen(spec, ts), { dir, lang: spec.lang ?? (dir === "rtl" ? "ar" : "en"), ts }, { x: 0, y: 0 }, "user");
}

const docOf = (nodes: SceneNode[]): Doc => ({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), roots: [nodes[0].id] });

beforeAll(async () => {
  await ensureYoga();
});

describe("preview scenarios", () => {
  for (const domain of DOMAINS) {
    it(`are clean, legible screens for ${domain}`, () => {
      const read = readOf(domain, {}, { platform: domain === "b2b-finance" || domain === "saas" ? "web" : "mobile", scripts: ["latin", "arabic"], slots: SLOTS });
      const list = scenarios(read);
      expect(list.map((s) => s.id)).toEqual(expect.arrayContaining(["hero", "stress1", "stress2", "rtl", "strip"]));
      const ts = new TokenSet(expandKnobs(baselineKnobs(read)).tree);
      for (const s of list) {
        expect(lintSpec(s.spec, ts), `${domain} ${s.id}`).toEqual([]);
        const nodes = build(s.spec, ts);
        const doc = docOf(nodes);
        const contrast = nodes.flatMap((n) => auditNode(doc, n, ts)).filter((f) => f.rule === "contrast" || f.rule === "non-text-contrast");
        expect(contrast.map((f) => `${f.nodeName}: ${f.message}`), `${domain} ${s.id}`).toEqual([]);
      }
    });
  }

  it("keeps long brand names within each component's limits", () => {
    const read = readOf("consumer-finance", {}, { slots: SLOTS });
    const hero = scenarios(read)[0].spec;
    const bar = hero.header?.[0];
    expect(String(bar?.props?.title).length).toBeLessThanOrEqual((CATALOG_BY_NAME.get("TopBar")!.props.title as { maxChars: number }).maxChars);
  });

  it("adds a desktop dashboard for tools used on the web, and the Arabic hero only when needed", () => {
    expect(scenarios(readOf("b2b-finance", {}, { platform: "web" })).some((s) => s.id === "dashboard")).toBe(true);
    expect(scenarios(readOf("b2b-finance", {}, { platform: "mobile" })).some((s) => s.id === "dashboard")).toBe(false);
    expect(scenarios(readOf("commerce")).some((s) => s.id === "rtl")).toBe(false);
  });
});

describe("what a change did", () => {
  const read = readOf("consumer-finance", {}, { slots: SLOTS });
  const strip = scenarios(read).find((s) => s.id === "strip")!.spec;
  const base = baselineKnobs(read);
  const nodesFor = (k: Knobs) => build(strip, new TokenSet(expandKnobs(k).tree));

  it("sees nothing when nothing changed", () => {
    expect(diffInstances(nodesFor(base), nodesFor({ ...base })).changed).toEqual([]);
  });

  it("finds the secondary controls when the control style changes, not the primary button", () => {
    const d = diffInstances(nodesFor({ ...base, fill: "solid" }), nodesFor({ ...base, fill: "outline" }));
    const paths = d.changed.map((c) => c.specPath);
    expect(paths).toContain("body.0.children.1"); // secondary button
    expect(paths).not.toContain("body.0.children.0"); // primary button
    for (const c of d.changed) expect(c.box.w).toBeGreaterThan(0);
  });

  it("finds rounded components when the corners change", () => {
    const d = diffInstances(nodesFor({ ...base, radius: "none" }), nodesFor({ ...base, radius: "large" }));
    expect(d.byComponent.Button).toBeGreaterThan(0);
    expect(d.byComponent.Card).toBeGreaterThan(0);
    expect(describeCounts(d.byComponent)).toMatch(/Button/);
  });

  it("lists the tokens that changed", () => {
    const a = new TokenSet(expandKnobs({ ...base, radius: "small" }).tree);
    const b = new TokenSet(expandKnobs({ ...base, radius: "large" }).tree);
    const paths = diffTokens(a, b);
    expect(paths).toContain("radius.md");
    expect(paths.every((p) => !p.startsWith("color."))).toBe(true);
  });
});
