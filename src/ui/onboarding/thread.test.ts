import { describe, expect, it } from "vitest";
import type { SetupLine, SetupSession } from "@/org/setup";
import { initialFlow } from "../ai/questionFlow";
import { askOf, isAddress, stepsOf, threadOf, type ChatMessage, type ThreadInput } from "./thread";

const base = (over: Partial<ThreadInput> = {}): ThreadInput => ({
  route: "setup",
  mode: "first",
  first: true,
  orgName: "Basket",
  shape: null,
  engine: "ready",
  naming: { name: null, busy: false, error: null },
  person: "Ahmed · Product manager",
  voice: { offer: "apple", chosen: "apple" },
  step: "goals",
  door: null,
  goals: 0,
  opened: true,
  know: { phase: "write", sent: false, answered: null, added: 0, error: null, goals: 0, questions: 0 },
  find: { session: null, pending: false, error: null, open: 0, accepted: 0 },
  problems: { sent: null, result: null, error: null },
  busy: null,
  picked: 0,
  ...over,
});

const session = (over: Partial<SetupSession> = {}): SetupSession => ({ v: 1, phase: "asking", understanding: "A grocery app for parents.", challenges: [], buckets: [], ...over });
const bucket = (submitted: boolean) => ({ questions: [], form: { ...initialFlow([]), submitted } });
const line = (id: string, over: Partial<SetupLine> = {}): SetupLine => ({ id, to: "org", field: "goals", text: id, pieces: [], answers: [], why: "", ...over });

const ids = (m: ChatMessage[]) => m.map((x) => x.id);
const choices = (m: ChatMessage | undefined) => m?.parts.flatMap((p) => (p.type === "data" && p.name === "choices" ? [p.data.set] : []));

describe("the welcome", () => {
  it("looks for Claude first, and takes nothing while it does", () => {
    const i = base({ route: "welcome", engine: "looking" });
    expect(ids(threadOf(i))).toEqual(["engine"]);
    expect(askOf(i)).toMatchObject({ kind: "none", key: "engine" });
    expect(stepsOf(i).map((s) => s.state)).toEqual(["now", "next", "next", "next", "next", "next", "next"]);
  });

  it("asks who it's for once Qalam AI is ready or left for later, and takes nothing until they pick", () => {
    for (const engine of ["ready", "skipped"] as const) {
      const i = base({ route: "welcome", engine });
      const m = threadOf(i);
      expect(ids(m)).toEqual(["engine", "shape:ask"]);
      expect(choices(m.at(-1))).toEqual(["shape"]);
      expect(askOf(i)).toMatchObject({ kind: "none", key: "shape" });
      expect(stepsOf(i).map((s) => s.state)).toEqual(["done", "now", "next", "next", "next", "next", "next"]);
    }
  });

  it("asks for an organization's name for a team, a project's for one person", () => {
    const team = threadOf(base({ route: "welcome", shape: "team" }));
    expect(ids(team)).toEqual(["engine", "shape:ask", "shape:you", "name:ask"]);
    expect(team.find((x) => x.id === "shape:you")?.parts).toEqual([{ type: "text", text: "A company or team" }]);
    expect(team.at(-1)?.parts[0]).toEqual({ type: "text", text: "What should I call your organization? A company, a client or a side project." });
    const solo = base({ route: "welcome", shape: "solo" });
    expect(threadOf(solo).at(-1)?.parts[0]).toEqual({ type: "text", text: "What's the project you have in mind? Just name it, or tell me what you'd like to call it." });
    expect(askOf(solo)).toMatchObject({ kind: "name", submit: "enter" });
    expect(stepsOf(solo).map((s) => s.id)).toEqual(["engine", "name", "you", "voice", "goals", "connect"]);
  });

  it("shows the name sent while the organization is made", () => {
    const m = threadOf(base({ route: "welcome", shape: "team", naming: { name: "Basket", busy: true, error: null } }));
    expect(ids(m)).toEqual(["engine", "shape:ask", "shape:you", "name:ask", "name:you", "status:name"]);
  });

  it("only checks in verify mode", () => {
    const i = base({ route: "welcome", mode: "verify" });
    expect(ids(threadOf(i))).toEqual(["engine", "verify"]);
    expect(askOf(i).kind).toBe("none");
  });
});

describe("who they are", () => {
  it("asks their name and position once the organization is named, and waits for it", () => {
    const i = base({ step: "you", person: null });
    const m = threadOf(i);
    expect(ids(m)).toEqual(["engine", "name:ask", "name:you", "you:ask"]);
    expect(m.at(-1)?.parts.find((p) => p.type === "data")).toMatchObject({ name: "you", data: { open: true } });
    expect(m.at(-1)?.parts[0]).toEqual({ type: "text", text: "What's your name, and your position at Basket?" });
    expect(askOf(i)).toMatchObject({ kind: "none", key: "you" });
    expect(stepsOf(i).map((s) => [s.id, s.state])).toEqual([
      ["engine", "done"],
      ["name", "done"],
      ["you", "now"],
      ["voice", "next"],
      ["goals", "next"],
      ["yours", "next"],
      ["connect", "next"],
    ]);
  });

  it("shows what they said as their message, and closes the form, once they move on", () => {
    const m = threadOf(base());
    expect(ids(m).slice(3, 5)).toEqual(["you:ask", "you:you"]);
    expect(m[3].parts.find((p) => p.type === "data")).toMatchObject({ data: { open: false } });
    expect(m[4].parts).toEqual([{ type: "text", text: "Ahmed · Product manager" }]);
  });

  it("isn't asked outside the first run", () => {
    expect(ids(threadOf(base({ first: false }))).some((x) => x.startsWith("you:"))).toBe(false);
  });
});

describe("talking instead of typing", () => {
  it("offers Apple's engine where the Mac has it, and waits for a choice", () => {
    const i = base({ step: "voice", voice: { offer: "apple", chosen: null } });
    const m = threadOf(i);
    expect(ids(m).slice(-3)).toEqual(["you:ask", "you:you", "voice:ask"]);
    expect(m.at(-1)?.parts.find((p) => p.type === "data")).toMatchObject({ name: "voice", data: { open: true, offer: "apple" } });
    expect(askOf(i)).toMatchObject({ kind: "none", key: "voice" });
    expect(stepsOf(i).find((s) => s.id === "voice")?.state).toBe("now");
  });

  it("offers an engine to install where it doesn't", () => {
    const m = threadOf(base({ step: "voice", voice: { offer: "parakeet", chosen: null } }));
    expect(m.at(-1)?.parts.find((p) => p.type === "data")).toMatchObject({ data: { offer: "parakeet" } });
  });

  it("shows what was chosen once they move on, and nothing on a Mac that can't", () => {
    expect(threadOf(base({ voice: { offer: "parakeet", chosen: "own" } })).find((x) => x.id === "voice:you")?.parts).toEqual([{ type: "text", text: "I use my own dictation app" }]);
    expect(ids(threadOf(base({ voice: { offer: "none", chosen: null } }))).some((x) => x.startsWith("voice:"))).toBe(false);
    expect(ids(threadOf(base({ voice: null }))).some((x) => x.startsWith("voice:"))).toBe(false);
  });
});

describe("the goals", () => {
  it("offers the two doors after the earlier steps", () => {
    const i = base();
    const m = threadOf(i);
    expect(ids(m)).toEqual(["engine", "name:ask", "name:you", "you:ask", "you:you", "voice:ask", "voice:you", "goals:ask"]);
    expect(choices(m.at(-1))).toEqual(["door"]);
    expect(askOf(i)).toMatchObject({ kind: "none", key: "door" });
    const goals = stepsOf(i).find((s) => s.id === "goals")!;
    expect(goals.state).toBe("now");
    expect(goals.sub?.map((s) => s.state)).toEqual(["now", "next", "next"]);
  });

  it("leaves the earlier steps out when it isn't the first run, and ends on All set", () => {
    const i = base({ first: false, find: { session: session({ phase: "done", proposal: { summary: "s", products: [], lines: [line("g1")] }, decided: { g1: "accepted" } }), pending: false, error: null, open: 0, accepted: 1 } });
    const m = threadOf(i);
    expect(ids(m)[0]).toBe("goals:ask");
    expect(ids(m).at(-1)).toBe("all-set");
    expect(stepsOf(i).map((s) => [s.label, s.state])).toEqual([
      ["Way in", "done"],
      ["Read and ask", "done"],
      ["Review", "done"],
      ["All set", "done"],
    ]);
  });

  it("takes an outline through the know door, then hands the composer to the questions", () => {
    const write = base({ door: "know" });
    expect(choices(threadOf(write).find((x) => x.id === "goals:ask"))).toEqual([]);
    expect(askOf(write)).toMatchObject({ kind: "outline", submit: "ctrlEnter" });
    const asking = base({ door: "know", know: { phase: "asking", sent: true, answered: null, added: 0, error: null, goals: 3, questions: 2 } });
    expect(ids(threadOf(asking)).slice(-3)).toEqual(["know:ask", "know:outline", "know:missing"]);
    expect(askOf(asking)).toMatchObject({ kind: "questions", scope: "know" });
    const review = base({ door: "know", know: { phase: "review", sent: true, answered: "skipped", added: 0, error: null, goals: 3, questions: 2 } });
    expect(ids(threadOf(review)).slice(-2)).toEqual(["know:answers", "know:review"]);
    expect(choices(threadOf(review).at(-1))).toEqual(["know-review"]);
  });

  it("reads a brain dump, asks a round, and lets the round be skipped", () => {
    const i = base({ door: "find", find: { session: session({ buckets: [bucket(false)] }), pending: false, error: null, open: 0, accepted: 0 } });
    const m = threadOf(i);
    expect(ids(m).slice(-4)).toEqual(["find:ask", "find:said", "find:took", "find:round:0"]);
    expect(choices(m.at(-1))).toEqual(["skip"]);
    expect(askOf(i)).toMatchObject({ kind: "questions", scope: "find" });
  });

  it("shows an answered round as their message, then what Qalam AI took from it", () => {
    const s = session({ phase: "ready", buckets: [{ ...bucket(true), analysis: "They sell to parents." }] });
    const m = threadOf(base({ find: { session: s, pending: false, error: null, open: 0, accepted: 0 } }));
    expect(ids(m).slice(-4)).toEqual(["find:round:0", "find:answers:0", "find:analysis:0", "find:ready"]);
  });

  it("sends the review to the right, with Accept all for what's open", () => {
    const s = session({ phase: "review", proposal: { summary: "Three goals and the About.", products: [], lines: [line("g1"), line("g2"), line("a1", { field: "context" })] }, decided: {} });
    const i = base({ find: { session: s, pending: false, error: null, open: 3, accepted: 0 } });
    const m = threadOf(i);
    expect(m.at(-1)?.id).toBe("find:proposal");
    expect(m.at(-1)?.parts.find((p) => p.type === "data")).toMatchObject({ data: { set: "proposal", n: 3 } });
    expect(stepsOf(i).find((x) => x.id === "goals")?.sub?.map((x) => x.state)).toEqual(["done", "done", "now"]);
  });

  it("ends the goals with Next on the first run, and drops the button once they move on", () => {
    const s = session({ phase: "done", proposal: { summary: "s", products: [], lines: [line("g1")] }, decided: { g1: "accepted" } });
    const at = (step: ThreadInput["step"]) => threadOf(base({ step, picked: 2, find: { session: s, pending: false, error: null, open: 0, accepted: 1 } }));
    expect(choices(at("goals").at(-1))).toEqual(["goals-in"]);
    expect(ids(at("yours")).slice(-2)).toEqual(["goals:in", "yours:ask"]);
    expect(choices(at("yours").find((x) => x.id === "goals:in"))).toEqual([]);
    expect(ids(at("connect")).slice(-3)).toEqual(["yours:ask", "yours:you", "connect:ask"]);
  });

  it("picked up past the goals with no way in chosen, says what the tree has instead of asking again", () => {
    const m = threadOf(base({ step: "yours", goals: 3 }));
    expect(ids(m).slice(-2)).toEqual(["goals:had", "yours:ask"]);
    expect(m.find((x) => x.id === "goals:had")?.parts[0]).toEqual({ type: "text", text: "Basket has 3 goals already." });
    expect(m.flatMap((x) => choices(x) ?? [])).toEqual([]);
    expect(threadOf(base({ step: "goals", goals: 3 })).some((x) => x.id === "goals:ask")).toBe(true);
  });
});

describe("on your own", () => {
  const solo = (over: Partial<ThreadInput> = {}) => base({ orgName: "Meal planner", shape: "solo", person: "Sara", ...over });

  it("says who it's for on the setup page, then asks only their name", () => {
    const i = solo({ step: "you", person: null });
    const m = threadOf(i);
    expect(ids(m)).toEqual(["engine", "shape:ask", "shape:you", "name:ask", "name:you", "you:ask"]);
    expect(m.find((x) => x.id === "name:ask")?.parts[0]).toEqual({ type: "text", text: "What's the project you have in mind? Just name it, or tell me what you'd like to call it." });
    expect(m.at(-1)?.parts[0]).toEqual({ type: "text", text: "What's your name?" });
    expect(m.at(-1)?.parts.find((p) => p.type === "data")).toMatchObject({ name: "you", data: { open: true, solo: true } });
    expect(askOf(i)).toMatchObject({ kind: "none", placeholder: "Fill in your name above" });
  });

  it("an organization from before there was a choice says nothing about it", () => {
    expect(ids(threadOf(base({ step: "you", person: null }))).some((x) => x.startsWith("shape:"))).toBe(false);
  });

  it("asks for their goals for the project, and skips which are theirs", () => {
    const s = session({ phase: "done", proposal: { summary: "s", products: [], lines: [line("g1")] }, decided: { g1: "accepted" } });
    const at = (step: ThreadInput["step"]) => threadOf(solo({ step, find: { session: s, pending: false, error: null, open: 0, accepted: 1 } }));
    const ask = threadOf(solo()).find((x) => x.id === "goals:ask")!;
    expect(ask.parts[0]).toEqual({ type: "text", text: "How do you want to start with Meal planner? An idea on its own is enough." });
    expect(ask.parts.find((p) => p.type === "data")).toMatchObject({ data: { set: "door", solo: true } });
    const done = at("goals").find((x) => x.id === "goals:in")!;
    expect(done.parts[0]).toEqual({ type: "text", text: "1 line written to Meal planner. Next: what to connect." });
    expect(done.parts.find((p) => p.type === "data")).toMatchObject({ data: { set: "goals-in", solo: true } });
    expect(ids(at("connect")).slice(-2)).toEqual(["goals:in", "connect:ask"]);
    expect(ids(at("connect")).some((x) => x.startsWith("yours:"))).toBe(false);
    expect(stepsOf(solo({ step: "connect" })).map((x) => [x.id, x.state])).toEqual([
      ["engine", "done"],
      ["name", "done"],
      ["you", "done"],
      ["voice", "done"],
      ["goals", "done"],
      ["connect", "now"],
    ]);
  });
});

describe("the other ways in", () => {
  it("files what customers said through the problems door, then shows what comes up most and moves on to connecting", () => {
    const asking = base({ door: "problems" });
    expect(ids(threadOf(asking)).slice(-2)).toEqual(["goals:door", "problems:ask"]);
    expect(threadOf(asking).find((x) => x.id === "goals:door")?.parts).toEqual([{ type: "text", text: "Problems we hear about" }]);
    expect(askOf(asking)).toMatchObject({ kind: "problems", submit: "ctrlEnter" });
    const filed = base({ door: "problems", problems: { sent: "Tickets…", result: { pages: 3, quotes: 12 }, error: null } });
    const m = threadOf(filed);
    expect(ids(m).slice(-3)).toEqual(["problems:ask", "problems:said", "goals:in"]);
    expect(m.at(-1)?.parts.map((p) => (p.type === "data" ? p.name : "text"))).toEqual(["text", "problems", "choices"]);
    expect(m.at(-1)?.parts.find((p) => p.type === "data" && p.name === "choices")).toMatchObject({ data: { set: "goals-in", solo: true } });
    expect(askOf(filed).kind).toBe("none");
    expect(stepsOf(filed).find((s) => s.id === "goals")?.sub?.map((s) => [s.label, s.state])).toEqual([
      ["Way in", "done"],
      ["File them", "done"],
      ["What comes up", "done"],
    ]);
    // On to connecting: no "which goals are yours" with no goals to pick.
    expect(ids(threadOf(base({ door: "problems", step: "connect", problems: filed.problems }))).some((x) => x.startsWith("yours:"))).toBe(false);
  });

  it("says when nothing customers said was in it, and offers the ways in again", () => {
    const m = threadOf(base({ door: "problems", problems: { sent: "My plan…", result: { pages: 0, quotes: 0 }, error: null } }));
    expect(m.at(-1)?.id).toBe("problems:none");
    expect(choices(m.at(-1))).toEqual(["door"]);
  });

  it("reads an idea in the chat, asks, has its lines reviewed, and opens its board only when they choose", () => {
    const i = base({ door: "idea", shape: "solo" });
    expect(ids(threadOf(i)).slice(-2)).toEqual(["goals:door", "idea:ask"]);
    expect(askOf(i)).toMatchObject({ kind: "idea", submit: "ctrlEnter", sources: "docs" });
    // Sent: what they said shows while it's read, and nothing opens.
    const sent = base({ door: "idea", find: { session: null, pending: true, error: null, open: 0, accepted: 0 }, busy: { label: "Reading what you wrote" } });
    expect(ids(threadOf(sent)).slice(-2)).toEqual(["idea:said", "status:idea:said"]);
    expect(askOf(sent).kind).toBe("none");
    // A round of questions, as for goals to find.
    const asking = base({ door: "idea", find: { session: session({ idea: true, buckets: [bucket(false)] }), pending: false, error: null, open: 0, accepted: 0 } });
    expect(ids(threadOf(asking)).slice(-3)).toEqual(["idea:said", "idea:took", "idea:round:0"]);
    expect(askOf(asking)).toMatchObject({ kind: "questions", scope: "find" });
    // A reload without the door in the address still knows it's an idea.
    expect(ids(threadOf({ ...asking, door: null })).slice(-1)).toEqual(["idea:round:0"]);
    // Every line settled: its board, when they choose.
    const done = base({ door: "idea", shape: "solo", find: { session: session({ idea: true, phase: "done", proposal: { summary: "Two goals.", products: [], lines: [line("g1")] }, decided: { g1: "accepted" } }), pending: false, error: null, open: 0, accepted: 1 } });
    const m = threadOf(done);
    expect(m.at(-1)?.id).toBe("goals:in");
    expect(choices(m.at(-1))).toEqual(["idea-board"]);
    expect(askOf(done)).toMatchObject({ kind: "none", key: "idea:done" });
    expect(stepsOf(done).find((s) => s.id === "goals")?.sub?.map((s) => [s.label, s.state])).toEqual([
      ["Way in", "done"],
      ["Describe it", "done"],
      ["Review", "done"],
      ["Its board", "now"],
    ]);
  });

  it("takes docs besides words where material is asked for: their own for an idea or a dump, customers' for problems", () => {
    expect(askOf(base({ door: "idea" })).sources).toBe("docs");
    expect(askOf(base({ door: "find" })).sources).toBe("docs");
    expect(askOf(base({ door: "problems" })).sources).toBe("customers");
    expect(askOf(base({ door: "know" })).sources).toBeUndefined();
    expect(askOf(base({ route: "welcome", shape: "solo" })).sources).toBeUndefined();
  });

  it("shows the docs that went with what they sent, and a doc alone is enough", () => {
    const docs = [{ from: "drive", title: "Pitch deck.pdf" }];
    const alone = threadOf(base({ door: "problems", problems: { sent: "", docs, result: null, error: null }, busy: { label: "Reading what you sent" } }));
    expect(alone.find((x) => x.id === "problems:said")?.parts).toEqual([{ type: "data", name: "docs", data: { scope: "problems" } }]);
    const both = threadOf(base({ door: "problems", problems: { sent: "Tickets…", docs, result: null, error: null } }));
    expect(both.find((x) => x.id === "problems:said")?.parts.map((p) => (p.type === "data" ? p.name : p.text))).toEqual(["Tickets…", "docs"]);
  });
});

describe("while Qalam AI works", () => {
  it("ends on a status message with a steady id, and the composer waits", () => {
    const i = base({ door: "find", find: { session: session({ phase: "reading", understanding: "" }), pending: false, error: null, open: 0, accepted: 0 }, busy: { label: "Reading" } });
    const a = threadOf(i);
    expect(a.at(-1)?.id).toBe("status:find:said");
    expect(ids(threadOf(i))).toEqual(ids(a));
    expect(askOf(i)).toMatchObject({ kind: "none", key: "busy" });
  });

  it("shows what they sent before there's a session", () => {
    const i = base({ door: "find", find: { session: null, pending: true, error: null, open: 0, accepted: 0 }, busy: { label: "Reading the page" } });
    expect(ids(threadOf(i)).slice(-2)).toEqual(["find:said", "status:find:said"]);
  });
});

describe("isAddress", () => {
  it("reads a lone web address as a page, anything else as writing", () => {
    expect(isAddress("example.com")).toBe(true);
    expect(isAddress(" https://basket.ae/about ")).toBe(true);
    expect(isAddress("We deliver groceries. See basket.ae")).toBe(false);
    expect(isAddress("notes")).toBe(false);
  });
});
