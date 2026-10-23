import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import { insertScreens } from "@/design-system/place";
import { studio } from "@/doc/store";
import { descendants } from "@/doc/geometry";
import type { ScreenSpec } from "@/design-system/builders";
import { repairScreens, screenIssues, systemIssues } from "./repair";

const TICKET: ScreenSpec = {
  name: "Order ticket",
  platform: "mobile",
  header: [{ component: "TopBar", props: { title: "Buy EMAAR" } }],
  body: [{ component: "SegmentedControl", props: { options: ["Market", "Limit", "Stop"], selected: 0 } }],
};

describe("self-check", () => {
  beforeAll(async () => {
    await ensureYoga();
  });

  it("doesn't flag segmented control segments: the padded track gives them a 44px target", async () => {
    const [id] = await insertScreens([TICKET], "ai", "builtin");
    const flags = descendants(studio().doc, id).flatMap((k) => studio().doc.nodes[k].meta.flags ?? []);
    expect(flags.filter((f) => f.rule === "touch-target")).toEqual([]);
  });

  it("never sends target sizes to the model: no spec prop sets them", async () => {
    const [id] = await insertScreens([TICKET], "ai", "builtin");
    // Make a segment too small the way a design system could (no hit area).
    studio().mutate((d) => {
      for (const k of descendants(d, id)) if (d.nodes[k].name.startsWith("Segment/")) d.nodes[k].meta.hitArea = undefined;
    }, { history: false });
    expect(screenIssues(id).filter((i) => i.rule === "touch-target")).toEqual([]);
    expect(systemIssues([id])).toBeGreaterThan(0);
    // Nothing the model could fix: the repair reports it for Tune without calling the model.
    const out = await repairScreens([id], "builtin", new AbortController().signal);
    expect(out).toMatchObject({ found: 0, remaining: 0, changes: [] });
    expect(out?.system).toBeGreaterThan(0);
  });
});
