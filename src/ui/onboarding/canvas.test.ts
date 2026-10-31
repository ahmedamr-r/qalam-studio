import { describe, expect, it } from "vitest";
import type { SourceQuote } from "@/discovery/sources";
import type { SetupLine, SetupSession } from "@/org/setup";
import { SOURCE } from "@/discovery/look";
import { backsOf, canvasOf, NODE_W, nodeHeight, partOf, pathOf } from "./canvas";
import { placesOf } from "./places";
import type { GoalTree } from "@/goals/types";
import { lineGoalId } from "@/org/setup";

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
  it("draws the problems the reading grouped, each with its quotes and the sources they're in, and a stack for what no group took", () => {
    const more = [...QUOTES, quote("q4", "the list every Sunday", "evidence"), quote("q5", "busy", "evidence")].map((q) => (q.id === "q1" ? { ...q, span: [said + 2, said + 9] as [number, number], text: "planner", role: "evidence" as const } : q));
    const s = session({ problems: [{ id: "p1", title: "Sunday lists take too long", quotes: ["q1", "q2"] }] });
    const c = canvasOf({ setup: { ...setup(s), quotes: more } });
    const group = c.nodes.find((n) => n.id === "group:p1")!;
    expect(group).toMatchObject({ kind: "problem", title: "Sunday lists take too long", quotes: ["q1", "q2"], count: { quotes: 2, sources: 2 } });
    expect(c.edges.filter((e) => e.to === "group:p1").map((e) => [e.from, e.quotes])).toEqual([
      ["src:0", ["q1"]],
      ["src:1", ["q2"]],
    ]);
    const loose = c.nodes.find((n) => n.loose)!;
    expect(loose).toMatchObject({ kind: "problem", title: "Not placed yet", quotes: ["q4", "q5"] });
    // A card per problem, never per quote.
    expect(c.nodes.filter((n) => n.kind === "problem")).toHaveLength(2);
    expect(group.h).toBeGreaterThan(nodeHeight("problem", group.title));
  });

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
      ["group:n0", "problem"],
      ["frag:q3", "goal"],
    ]);
    expect(c.nodes.find((n) => n.id === "src:1")?.quotes).toEqual(["q2", "q3"]);
    // Their own words are titled by how they begin.
    expect(c.nodes.find((n) => n.id === "src:0")?.title).toBe("A planner for busy parents.");
    expect(c.edges.map((e) => [e.from, e.to, e.quotes])).toEqual([
      ["src:1", "group:n0", ["q2"]],
      ["src:1", "frag:q3", ["q3"]],
    ]);
    // Columns left to right: sources, problems, goals.
    const x = (id: string) => c.nodes.find((n) => n.id === id)!.x;
    expect(x("src:0")).toBe(0);
    expect(x("group:n0")).toBeGreaterThan(x("src:1"));
    expect(x("frag:q3")).toBeGreaterThan(x("group:n0"));
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
      ["src:1", "group:n0", "backs"],
      ["group:n0", "line:g1", "backs"],
      ["src:1", "line:g1", "backs"],
      ["line:g1", "line:north", "under"],
    ]);
    // A goal sits left of the goal it feeds.
    const x = (id: string) => c.nodes.find((n) => n.id === id)!.x;
    expect(x("line:north")).toBeGreaterThan(x("line:g1"));
    // The reader's chips: what the Pitch backs, with its quotes.
    expect(backsOf(c, "src:1").map((b) => [b.node.id, b.quotes])).toEqual([
      ["group:n0", ["q2"]],
      ["line:g1", ["q2", "q3"]],
    ]);
    expect(backsOf(c, "src:0")).toEqual([]);
    // Lighting a goal's path: its problem, its source, and the goal it feeds.
    const p = pathOf(c, "line:g1");
    expect([...p.nodes].sort()).toEqual(["group:n0", "line:g1", "line:north", "src:1"]);
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
    // A part not taken in yet shows, being read.
    expect(canvasOf({ problems: [{ doc: { from: "computer", title: "notes.txt" }, sourceId: "", pages: [] }] }).nodes[0]).toMatchObject({ kind: "source", reading: true });
  });

  it("sizes a node from its words, clamped, with room for ✓ and ✕; a source as a board's lane draws it", () => {
    expect(nodeHeight("goal", "Short")).toBeLessThan(nodeHeight("goal", "x".repeat(200)));
    expect(nodeHeight("goal", "x".repeat(200))).toBe(nodeHeight("goal", "x".repeat(400)));
    expect(nodeHeight("goal", "Short", true)).toBeGreaterThan(nodeHeight("goal", "Short"));
    expect(nodeHeight("source", "x".repeat(400))).toBe(SOURCE.h);
    expect(NODE_W.source).toBe(SOURCE.w);
  });
});

describe("the organization on the setup's canvas", () => {
  const proposal = (decided: Record<string, "accepted" | "discarded"> = {}, made?: Record<string, string>) =>
    session({
      phase: "review",
      proposal: {
        summary: "",
        products: [{ ref: "n1", name: "Planner", why: "" }],
        lines: [line("north", { text: "Families plan weekly" }), line("g1", { text: "Lists in ten minutes", pieces: ["q3"], parent: "north", to: "new:n1" }), line("who", { field: "audience", text: "Busy parents", pieces: ["q1"] }), line("ctx", { field: "context", to: "new:n1", text: "A weekly planner", pieces: ["q2"] })],
      },
      decided,
      ...(made ? { made } : {}),
    });
  const tree = (goals: { id: string; title: string; parent?: string | null; product?: string | null }[], north: string | null = null): GoalTree => ({ goals: goals.map((g) => ({ parent: null, product: null, status: "active", cites: [], by: "person", at: 0, ...g })) as GoalTree["goals"], north });

  it("puts the places last, the About first, each goal wired into its own and each place from the sources its lines rest on", () => {
    const s = proposal();
    const c = canvasOf({ setup: setup(s), places: placesOf({ org: "Weekly meals", session: s, products: [], about: { context: "", audience: "" }, quotes: QUOTES }) });
    const places = c.nodes.filter((n) => n.kind === "place");
    expect(places.map((n) => [n.id, n.title, n.place?.fresh, n.place?.line])).toEqual([
      ["place:org", "About Weekly meals", false, "1 line · 1 to review"],
      ["place:new:n1", "Planner", true, "1 line · 1 to review"],
    ]);
    const maxGoalX = Math.max(...c.nodes.filter((n) => n.kind === "goal").map((n) => n.x));
    for (const p of places) expect(p.x).toBeGreaterThan(maxGoalX);
    expect(c.edges.filter((e) => e.kind === "in").map((e) => [e.from, e.to])).toEqual([
      ["line:north", "place:org"],
      ["line:g1", "place:new:n1"],
    ]);
    expect(c.edges.filter((e) => e.to.startsWith("place:") && e.kind === "backs").map((e) => [e.from, e.to, e.quotes])).toEqual([
      ["src:0", "place:org", ["q1"]],
      ["src:1", "place:new:n1", ["q2"]],
    ]);
    expect(backsOf(c, "src:0").map((b) => b.node.id)).toEqual(["place:org"]);
  });

  it("wires a goal into its place only where it doesn't feed a goal of the same place", () => {
    const t = tree([{ id: "a", title: "Grow" }, { id: "b", title: "Retain", parent: "a" }, { id: "c", title: "Pantry", parent: "a", product: "p2" }], "a");
    const c = canvasOf({ tree: t, places: placesOf({ org: "Basket", session: null, products: [{ id: "p2", name: "Pantry", audience: "", context: "", segments: [] }], about: { context: "", audience: "" }, quotes: [] }) });
    expect(c.nodes.filter((n) => n.kind === "goal").map((n) => [n.id, n.state, n.north])).toEqual([
      ["goal:b", "in", undefined],
      ["goal:c", "in", undefined],
      ["goal:a", "in", true],
    ]);
    expect(c.edges.filter((e) => e.kind === "in").map((e) => [e.from, e.to])).toEqual([
      ["goal:a", "place:org"],
      ["goal:c", "place:p2"],
    ]);
  });

  it("keeps a proposed product's place once it's made, and draws a goal an accepted line made only once", () => {
    const s = proposal({ g1: "accepted", ctx: "accepted" }, { n1: "prod1" });
    const products = [{ id: "prod1", name: "Planner", audience: "", context: "A weekly planner", segments: [] }];
    const made = lineGoalId("Lists in ten minutes", "prod1");
    const c = canvasOf({ setup: setup(s), tree: tree([{ id: made, title: "Lists in ten minutes", product: "prod1" }]), places: placesOf({ org: "Weekly meals", session: s, products, about: { context: "", audience: "" }, quotes: QUOTES }) });
    expect(c.nodes.some((n) => n.id === "place:new:n1")).toBe(true);
    expect(c.nodes.some((n) => n.id === "place:prod1")).toBe(false);
    expect(c.nodes.filter((n) => n.title === "Lists in ten minutes").map((n) => n.id)).toEqual(["line:g1"]);
  });

  it("draws the tools connected under the sources, with no wires", () => {
    const c = canvasOf({ setup: setup(session()), tools: [{ id: "notion", label: "Notion" }] });
    const tool = c.nodes.find((n) => n.kind === "tool")!;
    expect(tool).toMatchObject({ id: "tool:notion", title: "Notion", x: 0 });
    expect(tool.y).toBeGreaterThan(c.nodes.find((n) => n.id === "src:1")!.y);
    expect(c.edges.some((e) => e.from === tool.id || e.to === tool.id)).toBe(false);
  });

  it("shows only the organization's name, faint, before anything is known", () => {
    const c = canvasOf({ org: { name: "Weekly meals", ghost: true } });
    expect(c.nodes.map((n) => [n.id, n.kind, n.title, n.ghost])).toEqual([["place:org", "place", "Weekly meals", true]]);
  });
});
