import { beforeAll, describe, expect, it } from "vitest";
import { parsePartial } from "@/ai/partial-json";
import { SAMPLE_GENERATE } from "@/ai/fixtures";
import { ensureYoga } from "@/engine/layout";
import { specPaths } from "@/design-system/partial-spec";
import { useGhosts } from "@/doc/ghosts";
import { createProgressiveBuild, type BuiltElement } from "./progressive";

const FULL = JSON.stringify(SAMPLE_GENERATE);
const slotAt = (i: number) => ({ x: i * 500, y: 0 });

describe("progressive build", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  it("builds every screen as ghosts, one element at a time, screen after screen", async () => {
    const created: BuiltElement[] = [];
    const b = createProgressiveBuild({ turnId: "t1", dsId: "builtin", platform: "mobile", slotAt, onCreated: (e) => created.push(e) });
    for (let n = 200; n < FULL.length; n += 900) b.push(parsePartial(FULL.slice(0, n)));
    // finish() resolves as soon as everything is built; the budget only matters on a loaded machine.
    await b.finish(parsePartial(FULL), 3000);

    const ghosts = useGhosts.getState().list.filter((g) => g.turnId === "t1");
    expect(ghosts).toHaveLength(SAMPLE_GENERATE.variants.length);
    SAMPLE_GENERATE.variants.forEach((v, i) => {
      const want = specPaths(v);
      expect(created.filter((c) => c.variant === i).map((c) => c.specPath)).toEqual(want);
      const root = ghosts.find((g) => g.index === i)!.doc;
      expect(root.nodes[root.roots[0]].x).toBe(slotAt(i).x);
    });
    // Screen 2 only starts once screen 1 is done.
    const firstOf1 = created.findIndex((c) => c.variant === 1);
    expect(created.slice(firstOf1).some((c) => c.variant === 0)).toBe(false);
  });

  it("keeps what was shown for Stop, and clears it on a restart", async () => {
    const b = createProgressiveBuild({ turnId: "t2", dsId: "builtin", platform: "mobile", slotAt });
    const firstScreenDone = FULL.indexOf('"name"', FULL.indexOf('"body"'));
    await b.finish(parsePartial(FULL.slice(0, firstScreenDone)), 400);
    const snap = b.snapshot();
    expect(snap.length).toBeGreaterThan(0);
    expect(specPaths(snap[0]).length).toBeGreaterThan(0);
    b.reset();
    expect(useGhosts.getState().list.some((g) => g.turnId === "t2")).toBe(false);
    b.stop();
  });

  it("keeps the built screens when the model starts over, and swaps each in once its new version is complete", async () => {
    const created: BuiltElement[] = [];
    const b = createProgressiveBuild({ turnId: "t3", dsId: "builtin", platform: "mobile", slotAt, onCreated: (e) => created.push(e) });
    // finish() resolves as soon as everything is built; the budget only matters on a loaded machine.
    await b.finish(parsePartial(FULL), 3000);
    const before = created.length;
    const first = () => useGhosts.getState().list.find((g) => g.turnId === "t3" && g.index === 0)!.doc;
    const oldRoot = first().roots[0];

    // The retry renames the first screen; halfway through it, the old screens are still up.
    const retry = { ...SAMPLE_GENERATE, variants: SAMPLE_GENERATE.variants.map((v, i) => (i === 0 ? { ...v, name: "Retried screen" } : v)) };
    const json = JSON.stringify(retry);
    b.revise();
    expect(b.revising).toBe(true);
    b.push(parsePartial(json.slice(0, json.indexOf('"body"') + 20)));
    await new Promise((r) => setTimeout(r, 400));
    expect(useGhosts.getState().list.filter((g) => g.turnId === "t3")).toHaveLength(SAMPLE_GENERATE.variants.length);
    expect(first().roots[0]).toBe(oldRoot);

    await b.finish(parsePartial(json), 600);
    const doc = first();
    expect(doc.nodes[doc.roots[0]].name).toBe("Retried screen");
    // Its elements were listed the first time round.
    expect(created.length).toBe(before);
    b.stop();
  });
});
