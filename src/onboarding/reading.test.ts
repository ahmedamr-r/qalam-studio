import { describe, expect, it } from "vitest";
import { emptyScan, type ScanSession } from "@/scan/session";
import { LINE_MS, lineOf, phaseOf, POSE_OF, readSoFar, scanProgress, type ReadingPhase } from "./reading";

const MIN = 60 * 1000;
const session = (over: Partial<ScanSession> = {}): ScanSession => ({ ...emptyScan({ kind: "idea", said: "x" }, 0), ...over });

describe("what it's doing", () => {
  it("follows the scan's latest step", () => {
    expect(phaseOf(session())).toBe("starting");
    expect(phaseOf(session({ steps: ["Starting", "Reading App Store reviews of Foo"] }))).toBe("reviews");
    expect(phaseOf(session({ steps: ["Searching Hacker News"] }))).toBe("forums");
    expect(phaseOf(session({ steps: ["Reading pages where people talk about it"] }))).toBe("pages");
    expect(phaseOf(session({ steps: ["Reading what's been published about it"] }))).toBe("published");
    expect(phaseOf(session({ steps: ["Reading “A thread”"] }))).toBe("keeping");
    expect(phaseOf(session({ steps: ["Filing what it found into problem pages"] }))).toBe("filing");
  });

  it("says how it ended", () => {
    expect(phaseOf(session({ state: "done" }))).toBe("done");
    expect(phaseOf(session({ state: "done", thin: true }))).toBe("thin");
    expect(phaseOf(session({ state: "failed" }))).toBe("failed");
    expect(phaseOf(session({ state: "stopped" }))).toBe("failed");
  });

  it("stays on what it knows when a step is new to it", () => {
    expect(phaseOf(session({ steps: ["Something new"] }))).toBe("starting");
  });
});

describe("the bar", () => {
  it("moves with time, and never fills before it's done", () => {
    const s = session({ at: 0 });
    const early = scanProgress(s, 30 * 1000);
    const later = scanProgress(s, 5 * MIN);
    expect(later).toBeGreaterThan(early);
    expect(scanProgress(s, 600 * MIN)).toBeLessThan(1);
    expect(scanProgress(s, 600 * MIN)).toBeLessThanOrEqual(0.95);
    expect(scanProgress(session({ at: 0, state: "done" }), 0)).toBe(1);
  });

  it("jumps when a real step starts, and doesn't go back", () => {
    const before = scanProgress(session({ steps: ["Starting"] }), MIN);
    const after = scanProgress(session({ steps: ["Starting", "Filing what it found into problem pages"] }), MIN);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThanOrEqual(0.8);
    expect(scanProgress(session({ steps: ["Filing what it found into problem pages", "Something new"] }), MIN)).toBeGreaterThanOrEqual(0.8);
  });

  it("comes back where it was after a reload, since it's worked out from when the scan started", () => {
    const s = session({ at: 1000, steps: ["Searching Hacker News"] });
    expect(scanProgress(s, 1000 + 2 * MIN)).toBe(scanProgress({ ...s }, 1000 + 2 * MIN));
  });

  it("doesn't run backwards on a clock a moment behind", () => {
    expect(scanProgress(session({ at: 5000 }), 0)).toBeGreaterThanOrEqual(0);
  });
});

describe("the researcher's lines", () => {
  const phases = Object.keys(POSE_OF) as ReadingPhase[];

  it("hold no figures, so a joke is never taken for what was found", () => {
    for (const p of phases) for (let i = 0; i < 4; i++) expect(lineOf(p, i * LINE_MS)).not.toMatch(/\d/);
  });

  it("say nothing about how it's checked", () => {
    for (const p of phases) for (let i = 0; i < 4; i++) expect(lineOf(p, i * LINE_MS)).not.toMatch(/\b(code|verified|checked|hash)\b/i);
  });

  it("change every so often, and hold still between", () => {
    expect(lineOf("reviews", 0)).toBe(lineOf("reviews", LINE_MS - 1));
    expect(lineOf("reviews", 0)).not.toBe(lineOf("reviews", LINE_MS));
  });

  it("don't joke about a scan that failed", () => {
    expect(lineOf("failed", 0)).toBe("That didn't work.");
  });
});

describe("what it's read", () => {
  it("counts only what the session says", () => {
    expect(readSoFar(session())).toEqual({ places: 0, reviews: 0, quotes: 0, apps: 0 });
    const read = [{ title: "A", origin: "a", kind: "reviews" as const, quotes: 3, reviews: { read: 120, kept: 40 } }, { title: "B", origin: "b", kind: "thread" as const }];
    expect(readSoFar(session({ read, competitors: [{ name: "Foo" }] }))).toEqual({ places: 2, reviews: 120, quotes: 3, apps: 1 });
  });
});
