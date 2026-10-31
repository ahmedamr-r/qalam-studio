import { describe, expect, it } from "vitest";
import type { SetupLine, SetupSession } from "@/org/setup";
import { CHAT_W, dockLayout, nextToReview, withItem } from "./dock";

const panels = (...w: number[]) => w.map((x, i) => ({ id: `p${i}`, w: x }));

describe("where the setup's panels go", () => {
  it("docks the chat and two panels beside the canvas on a wide page", () => {
    expect(dockLayout(1700, true, panels(520, 380))).toEqual({ chat: "dock", docked: ["p0", "p1"], drawer: null });
  });

  it("fits the newest panels first, leaving the canvas its room", () => {
    // 1440 - 16 - 360 = 1064: the chat (408), the newest (388), and no room for the oldest (528).
    expect(dockLayout(1440, true, panels(520, 380))).toEqual({ chat: "dock", docked: ["p1"], drawer: null });
    expect(dockLayout(1440, false, panels(520, 380))).toEqual({ chat: "closed", docked: ["p0", "p1"], drawer: null });
  });

  it("draws the newest panel over the canvas, and the chat as a drawer, when nothing fits beside it", () => {
    expect(dockLayout(1000, true, panels(520, 380))).toEqual({ chat: "dock", docked: [], drawer: "p1" });
    expect(dockLayout(700, true, panels(380))).toEqual({ chat: "drawer", docked: [], drawer: "p0" });
    expect(dockLayout(700, true, [])).toEqual({ chat: "drawer", docked: [], drawer: null });
  });

  it("never lets the chat squeeze the canvas", () => {
    expect(dockLayout(16 + 360 + CHAT_W + 7, true, []).chat).toBe("drawer");
    expect(dockLayout(16 + 360 + CHAT_W + 8, true, []).chat).toBe("dock");
  });
});

describe("the panels open", () => {
  it("keeps one open already where it is, and drops the oldest for a third", () => {
    const a = { kind: "source" as const, id: "src:0" };
    const b = { kind: "place" as const, id: "place:org" };
    const c = { kind: "goal" as const, id: "line:g1" };
    expect(withItem([a, b], a)).toEqual([a, b]);
    expect(withItem([a, b], c)).toEqual([b, c]);
  });
});

describe("what's next to review", () => {
  const line = (id: string, over: Partial<SetupLine> = {}): SetupLine => ({ id, to: "org", field: "goals", text: id, pieces: [], answers: [], why: "", ...over });
  const session = (lines: SetupLine[], decided: Record<string, "accepted" | "discarded"> = {}): SetupSession => ({ v: 1, phase: "review", understanding: "", challenges: [], buckets: [], proposal: { summary: "", products: [], lines }, decided });
  it("is the first line still to settle, as the node it's on", () => {
    expect(nextToReview(session([line("g1"), line("who", { field: "audience", to: "new:n1" })], { g1: "accepted" }))).toEqual({ kind: "place", id: "place:new:n1" });
    expect(nextToReview(session([line("g1")]))).toEqual({ kind: "goal", id: "line:g1" });
    expect(nextToReview(session([line("g1")], { g1: "discarded" }))).toBeNull();
  });
});
