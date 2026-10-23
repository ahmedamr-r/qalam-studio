import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import { orderTrackingDoc } from "@/codegen/fixtures";
import { playScreens } from "./build";

beforeAll(async () => {
  await ensureYoga();
});

describe("what Prototype mode plays", () => {
  it("plays the prototype's screens when nothing is selected", () => {
    const { doc, ids } = orderTrackingDoc();
    expect(playScreens(doc, [])).toEqual({ screens: [ids.mapFirst, ids.timeline, ids.compact] });
  });

  it("plays a selected screen and every screen its links lead to, starting there", () => {
    const { doc, ids } = orderTrackingDoc();
    const layer = doc.nodes[ids.compact].children[0];
    expect(playScreens(doc, [layer])).toEqual({ screens: [ids.mapFirst, ids.timeline, ids.compact], start: ids.compact });
    expect(playScreens(doc, [ids.timeline])).toEqual({ screens: [ids.timeline], start: ids.timeline });
  });

  it("starts several selected screens where the prototype starts, when it's one of them", () => {
    const { doc, ids } = orderTrackingDoc();
    expect(playScreens(doc, [ids.mapFirst, ids.compact]).start).toBe(ids.compact);
    expect(playScreens(doc, [ids.timeline, ids.mapFirst]).start).toBe(ids.timeline);
  });
});
