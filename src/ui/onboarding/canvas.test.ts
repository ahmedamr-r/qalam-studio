import { describe, expect, it } from "vitest";
import type { SourceQuote } from "@/discovery/sources";
import type { SetupLine, SetupSession } from "@/org/setup";
import { backsOf, canvasOf, nodeHeight, partOf, pathOf } from "./canvas";

// Their words, then a Drive doc: the dump's text and where each part sits.
const TEXT = "A planner for busy parents.\n\nFrom Google Drive: Pitch\n\nParents rebuild the list every Sunday. We want 1,000 families planning weekly by March.";
const said = TEXT.indexOf("A planner");
const pitch = TEXT.indexOf("Parents rebuild");
const DOCS = [
  { from: "said", title: "Your words", span: [said, said + "A planner for busy parents.".length] as [number, number] },
  { from: "drive", title: "Pitch", origin: "https://docs.google.com/document/d/1/edit", type: "doc", span: [pitch, TEXT.length] as [number, number] },
];
const quote = (id: string, text: string, role: SourceQuote["role"]): SourceQuote => {
  const at = TEXT.indexOf(text);
  return { id, text, span: [at, at + text.length], kind: role === "need" ? "need" : "need", role, addedBy: "ai", at: 0 } as SourceQuote;
};
const QUOTES = [quote("q1", "busy parents", "context"), quote("q2", "Parents rebuild the list every Sunday", "need"), quote("q3", "1,000 families planning weekly by March", "goal")];
const session = (over: Partial<SetupSession> = {}): SetupSession => ({ v: 1, phase: "asking", understanding: "", challenges: [], buckets: [], docs: DOCS, ...over });
const line = (id: string, over: Partial<SetupLine> = {}): SetupLine => ({ id, to: "org", field: "goals", text: id, pieces: [], answers: [], why: "", ...over });
const setup = (s: SetupSession) => ({ session: s, sourceId: "dump1", quotes: QUOTES, text: TEXT });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("the setup's canvas", () => {
  it("shows what was sent at once, being read", () => {
    const c = canvasOf({ pending: { docs: [{ from: "said", title: "Your words" }, { from: "drive", title: "Pitch" }] } });
    expect(c.nodes.map((n) => [n.kind, n.title, n.reading])).toEqual([
      ["source", "Your words", true],
      ["source", "Pitch", true],
    ]);
    expect(c.edges).toEqual([]);
  });

  it("puts each fragment in the part its span starts in", () => {
    expect(QUOTES.map((q) => partOf(DOCS, q))).toEqual([0, 1, 1]);
    expect(partOf(DOCS, { span: [TEXT.indexOf("From Google"), TEXT.indexOf("From Google") + 4] })).toBe(-1);
  });

  it("wires each source to the problems and goals it read in it, with the quotes behind each wire", () => {
    const c = canvasOf({ setup: setup(session()) });
    expect(c.nodes.map((n) => [n.id, n.kind])).toEqual([
      ["src:0", "source"],
      ["src:1", "source"],
      ["need:q2", "problem"],
      ["frag:q3", "goal"],
    ]);
    expect(c.nodes.find((n) => n.id === "src:1")?.quotes).toEqual(["q2", "q3"]);
    expect(c.edges.map((e) => [e.from, e.to, e.quotes])).toEqual([
      ["src:1", "need:q2", ["q2"]],
      ["src:1", "frag:q3", ["q3"]],
    ]);
    // Columns left to right: sources, problems, goals.
    const x = (id: string) => c.nodes.find((n) => n.id === id)!.x;
    expect(x("src:0")).toBe(0);
    expect(x("need:q2")).toBeGreaterThan(x("src:1"));
    expect(x("frag:q3")).toBeGreaterThan(x("need:q2"));
  });

  it("shows the proposal's goals with their state, wired through the problems they rest on and to the goal they feed", () => {
    const s = session({
      phase: "review",
      proposal: { summary: "", products: [], lines: [line("north", { text: "Families plan weekly" }), line("g1", { text: "1,000 families by March", pieces: ["q2", "q3"], parent: "north" }), line("about", { field: "context", pieces: ["q1"] })] },
      decided: { g1: "accepted" },
    });
    const c = canvasOf({ setup: setup(s) });
    // Laid out column by column: a goal before the goal it feeds.
    expect(c.nodes.filter((n) => n.kind === "goal").map((n) => [n.id, n.state])).toEqual([
      ["line:g1", "accepted"],
      ["line:north", "proposed"],
    ]);
    expect(c.edges.map((e) => [e.from, e.to, e.kind])).toEqual([
      ["src:1", "need:q2", "backs"],
      ["need:q2", "line:g1", "backs"],
      ["src:1", "line:g1", "backs"],
      ["line:g1", "line:north", "under"],
    ]);
    // A goal sits left of the goal it feeds.
    const x = (id: string) => c.nodes.find((n) => n.id === id)!.x;
    expect(x("line:north")).toBeGreaterThan(x("line:g1"));
    // The reader's chips: what the Pitch backs, with its quotes.
    expect(backsOf(c, "src:1").map((b) => [b.node.id, b.quotes])).toEqual([
      ["need:q2", ["q2"]],
      ["line:g1", ["q2", "q3"]],
    ]);
    expect(backsOf(c, "src:0")).toEqual([]);
    // Lighting a goal's path: its problem, its source, and the goal it feeds.
    const p = pathOf(c, "line:g1");
    expect([...p.nodes].sort()).toEqual(["line:g1", "line:north", "need:q2", "src:1"]);
  });

  it("draws the know door's goals from their own words, and the problems door's sources into their pages", () => {
    const know = canvasOf({ know: [{ ref: "k1", title: "North Star", parent: null }, { ref: "k2", title: "Reorders", parent: "k1" }] });
    expect(know.edges.map((e) => [e.from, e.to, e.kind])).toEqual([
      ["src:know", "know:k1", "backs"],
      ["know:k2", "know:k1", "under"],
    ]);
    const problems = canvasOf({
      problems: [
        { doc: { from: "computer", title: "survey.csv" }, sourceId: "s1", pages: [{ id: "p1", title: "Lists take an hour" }, { id: "p2", title: "Buying twice" }] },
        { doc: { from: "slack", title: "#feedback" }, sourceId: "s2", pages: [{ id: "p1", title: "Lists take an hour" }] },
      ],
    });
    // The page only the first source fed sits higher than the one both fed: shorter wires.
    expect(ids(problems.nodes)).toEqual(["psrc:0", "psrc:1", "page:p2", "page:p1"]);
    expect(problems.edges.map((e) => [e.from, e.to])).toEqual([
      ["psrc:0", "page:p1"],
      ["psrc:0", "page:p2"],
      ["psrc:1", "page:p1"],
    ]);
    expect(backsOf(problems, "psrc:1").map((b) => b.node.id)).toEqual(["page:p1"]);
  });

  it("sizes a node from its words, clamped, with room for ✓ and ✕", () => {
    expect(nodeHeight("goal", "Short")).toBeLessThan(nodeHeight("goal", "x".repeat(200)));
    expect(nodeHeight("goal", "x".repeat(200))).toBe(nodeHeight("goal", "x".repeat(400)));
    expect(nodeHeight("goal", "Short", true)).toBeGreaterThan(nodeHeight("goal", "Short"));
  });
});
