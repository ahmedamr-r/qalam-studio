import { describe, expect, it } from "vitest";
import { needEvidence, needSummary, rankNeeds, strengthOf, weeklyCounts, type NeedInput, type PieceFacts, type ShownOn } from "./needs";
import type { Topic, TopicLine } from "./topics";

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 28, 12).getTime();
const ago = (days: number) => NOW - days * DAY;

const quote = (source: string, at = ago(3), sub: string | null = null): PieceFacts => ({ type: "quote", sub, source, stage: null, at });
const line = (id: string, section: TopicLine["section"], cites: string[], over: Partial<TopicLine> = {}): TopicLine => ({ id, section, text: id, by: "qalam", cites, from: [], at: ago(4), ...over });
const topic = (id: string, over: Partial<Topic> = {}): Topic => ({ id, kind: "need", title: id, products: [], createdAt: ago(30), updatedAt: ago(2), lines: [], history: [], ...over });
const input = (topics: Topic[], pieces: Record<string, PieceFacts>, shows: Record<string, ShownOn[]> = {}): NeedInput => ({ now: NOW, topics, pieces: new Map(Object.entries(pieces)), shows: new Map(Object.entries(shows)) });

describe("what to work on next", () => {
  it("counts the customer evidence a need's We know lines cite, once each, never the team's brain dump", () => {
    const t = topic("fees", { lines: [line("l1", "know", ["q:a", "q:b", "q:dump"]), line("l2", "know", ["q:a", "q:c"]), line("l3", "believe", ["q:d"])] });
    const e = needEvidence(t, new Map(Object.entries({ "q:a": quote("s1"), "q:b": quote("s1"), "q:c": quote("s2"), "q:d": quote("s3"), "q:dump": quote("s4", ago(3), "dump:context") })));
    expect([...e.quotes].sort()).toEqual(["q:a", "q:b", "q:c"]);
    expect([...e.sources].sort()).toEqual(["s1", "s2"]);
    expect(e.ats).toHaveLength(3);
  });

  it("counts what speaks against a need apart, from Against lines and from disputes", () => {
    const t = topic("fees", {
      lines: [line("l1", "know", ["q:a"], { disputes: [{ id: "d1", text: "x", by: "qalam", cites: ["q:x"], from: [], at: ago(1) }] }), line("l2", "against", ["q:y", "q:gone"])],
    });
    const e = needEvidence(t, new Map(Object.entries({ "q:a": quote("s1"), "q:x": quote("s2"), "q:y": quote("s3") })));
    expect(e.quotes.size).toBe(1);
    expect([...e.against].sort()).toEqual(["q:x", "q:y"]);
  });

  it("ranks needs by sources, then quotes, then the newest", () => {
    const pieces = { "q:1": quote("s1"), "q:2": quote("s2"), "q:3": quote("s3"), "q:4": quote("s1", ago(1)), "q:5": quote("s1", ago(1)), "q:6": quote("s4", ago(10)) };
    const ranked = rankNeeds(
      input(
        [
          topic("two-sources", { lines: [line("l", "know", ["q:1", "q:2"])] }),
          topic("three-sources", { lines: [line("l", "know", ["q:1", "q:2", "q:3"])] }),
          topic("one-source-many", { lines: [line("l", "know", ["q:4", "q:5"])] }),
          topic("two-sources-old", { lines: [line("l", "know", ["q:6", "q:3"])], updatedAt: ago(20) }),
          topic("assumed"),
          topic("a-segment", { kind: "segment", lines: [line("l", "know", ["q:1", "q:2", "q:3", "q:6"])] }),
        ],
        pieces,
      ),
    );
    expect(ranked.map((n) => n.topic)).toEqual(["three-sources", "two-sources", "two-sources-old", "one-source-many", "assumed"]);
    expect(ranked.map(strengthOf)).toEqual(["strong", "growing", "growing", "thin", "assumed"]);
  });

  it("counts people online apart, below its own customers, and alone leaves it Assumed", () => {
    const pieces = { "q:own": quote("s1"), "q:r1": quote("reddit", ago(3), "online:pain"), "q:r2": quote("reddit", ago(3), "online:pain"), "q:r3": quote("appstore", ago(3), "online:need") };
    const online = topic("online-only", { lines: [line("l", "believe", ["q:r1", "q:r2", "q:r3"])] });
    const e = needEvidence(online, new Map(Object.entries(pieces)));
    expect([e.quotes.size, e.online.size, e.onlineSources.size]).toEqual([0, 3, 2]);
    const ranked = rankNeeds(input([topic("nothing"), online, topic("one-customer", { lines: [line("l", "know", ["q:own"])] })], pieces));
    expect(ranked.map((n) => [n.topic, n.online, strengthOf(n)])).toEqual([
      ["one-customer", 0, "thin"],
      ["online-only", 3, "assumed"],
      ["nothing", 0, "assumed"],
    ]);
  });

  it("says who raises a need: the segment pages citing the same evidence", () => {
    const need = topic("fees", { lines: [line("l", "know", ["q:a", "q:b"])] });
    const parents = topic("parents", { kind: "segment", title: "Parents", lines: [line("l", "know", ["q:b"])] });
    const students = topic("students", { kind: "segment", title: "Students", lines: [line("l", "know", ["q:z"])] });
    const n = needSummary(need, input([need, parents, students], { "q:a": quote("s1"), "q:b": quote("s2"), "q:z": quote("s3") }));
    expect(n.segments).toEqual([{ id: "parents", title: "Parents" }]);
  });

  it("says which boards have it, with the card that rests on most of its pieces on each", () => {
    const need = topic("fees", { lines: [line("l", "know", ["q:a"])] });
    const shows = {
      fees: [
        { ref: "c1", board: "b1", card: "c1", kind: "opportunity", shared: 1 },
        { ref: "c2", board: "b1", card: "c2", kind: "opportunity", shared: 3 },
        { ref: "c3", board: "b2", card: "c3", kind: "solution", shared: 0 },
      ],
    };
    const n = needSummary(need, input([need], { "q:a": quote("s1") }, shows));
    expect(n.boards).toEqual([
      { board: "b1", card: "c2", kind: "opportunity", shared: 3 },
      { board: "b2", card: "c3", kind: "solution", shared: 0 },
    ]);
    expect(needSummary(need, input([need], { "q:a": quote("s1") })).boards).toEqual([]);
  });

  it("bins when quotes were picked out by week, oldest first", () => {
    expect(weeklyCounts([ago(0), ago(1), ago(8), ago(55), ago(70), NOW + DAY], NOW, 8)).toEqual([1, 0, 0, 0, 0, 0, 1, 3]);
    expect(weeklyCounts([], NOW, 3)).toEqual([0, 0, 0]);
  });
});
