import { describe, expect, it } from "vitest";
import type { OstCard, OstEvidence } from "@/discovery/types";
import type { Voice } from "./people";
import { strengthOf } from "./strength";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 28);
const ev = (id: string, o: Partial<OstEvidence> = {}): OstEvidence => ({ id, kind: "quote", text: id, piece: `hub:quote:${id}`, sourceId: "s1", addedBy: "ai", at: NOW - DAY, ...o });
const card = (evidence: OstEvidence[], kind: OstCard["kind"] = "opportunity") => ({ kind, evidence });
const voice = (key: string, source: string, segments: string[] = [], at = NOW - DAY): Voice => ({ key, segments, source, at, ...(key.startsWith("person:") ? { person: { id: key.slice(7), name: key.slice(7), segments } } : {}) });

describe("how strong a card's evidence is", () => {
  it("has nothing, or only the team's words", () => {
    expect(strengthOf(card([]), { now: NOW })).toMatchObject({ level: "none", why: "", next: "Hear it from customers: attach what one said." });
    const team = strengthOf(card([ev("a", { kind: "answer", piece: undefined }), ev("d", { kind: "dump" })]), { now: NOW });
    expect(team).toMatchObject({ level: "team", why: "only the team's words (2)", team: 2 });
  });

  it("counts one talkative customer as one voice, however many quotes", () => {
    const voices = new Map(["a", "b", "c", "d"].map((id) => [`hub:quote:${id}`, voice("person:sara", "s1", ["Parents"])]));
    const s = strengthOf(card(["a", "b", "c", "d"].map((id) => ev(id))), { now: NOW, voices });
    expect(s).toMatchObject({ level: "thin", quotes: 4, why: "1 person in 1 segment (1 source) · newest 1 day ago" });
    expect(s.next).toBe("Hear it from more people (three or more, in two sources) before betting on it.");
  });

  it("is strong with three voices or more, in two sources, mostly for it and recent", () => {
    const voices = new Map([
      ["hub:quote:a", voice("person:sara", "s1", ["Parents"])],
      ["hub:quote:b", voice("person:omar", "s2", ["Offices"])],
      ["hub:quote:c", voice("source:s2:s3", "s2")],
      ["hub:quote:x", voice("person:lina", "s3", ["Parents"])],
    ]);
    const s = strengthOf(card([ev("a"), ev("b"), ev("c"), ev("x", { stance: "against" })]), { now: NOW, voices });
    expect(s).toMatchObject({ level: "strong", against: 1, why: "3 voices (2 named) in 2 segments (2 sources) · newest 1 day ago · 1 against" });
    expect(s.next).toBe("Say who said it on its sources, so the same person isn't counted twice.");
  });

  it("is thin when as much speaks against it, and only some when the newest is stale", () => {
    const against = strengthOf(card([ev("a", { sourceId: "s1" }), ev("b", { sourceId: "s2", stance: "against", speaker: "Ali" })]), { now: NOW });
    expect(against.level).toBe("thin");
    const old = NOW - 400 * DAY;
    const stale = strengthOf(card([ev("a", { sourceId: "s1", at: old }), ev("b", { sourceId: "s2", at: old }), ev("c", { sourceId: "s3", at: old })]), { now: NOW });
    expect(stale).toMatchObject({ level: "thin", why: "3 voices (3 sources) · newest 13 months ago" });
    expect(stale.next).toBe("The newest is over 6 months old: check it still holds.");
  });

  it("tells unnamed voices apart by source and speaker when the organization doesn't know them", () => {
    const s = strengthOf(card([ev("a", { speaker: "Sara" }), ev("b", { speaker: "sara " }), ev("c", { speaker: "Omar" })]), { now: NOW });
    expect(s.tally).toMatchObject({ voices: 2, people: 0, sources: 1 });
  });

  it("counts a solution's finished tests", () => {
    const s = strengthOf(card([], "solution"), { now: NOW, tests: [{ stage: "passed" }, { stage: "failed" }, { stage: "planned" }] });
    expect(s).toMatchObject({ level: "some", why: "1 test passed · 1 failed", tests: { passed: 1, failed: 1, running: 0 } });
  });
});
