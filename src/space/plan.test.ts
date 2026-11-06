import { describe, expect, it } from "vitest";
import { emptyDoc, type Doc } from "@/doc/schema";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import { applyProposal, withNeeds, type Proposal } from "@/discovery/proposals";
import { helpedCards } from "@/discovery/helps";
import type { OstCard } from "@/discovery/types";
import { chatOf, threadOf, type ChatTurn } from "./chat";
import type { SpaceThing } from "./compose";
import { answersOf, leftOf, planMaterial, planNextMaterial, planOutline, planProposals, planRound, planTask, planLine, sanitizeNext, sanitizePlan, sanitizeRoute, type OutlineCard, type PlanLook, type PlanPiece, type PlanRound } from "./plan";

const outline: OutlineCard[] = [
  { id: "G", kind: "outcome", title: "5 of 10 owners pay for it", parent: null, metric: "Paid: target 5" },
  { id: "P1", kind: "opportunity", title: "Reviews are hard to get", parent: "G" },
  { id: "P2", kind: "opportunity", title: "Reviews disappear overnight", parent: null, topic: "T2", faint: true },
  { id: "S", kind: "solution", title: "Text after a visit", parent: "P1", type: "message" },
];
const pieces: PlanPiece[] = [{ ref: "hub:quote:a", text: "All of our reviews have disappeared overnight", label: "Local Search Forum", source: "s1", evidence: false, online: true, card: "P2" }];
const looks: PlanLook[] = [{ at: 1, query: "", after: -1, lines: [{ id: "f1", text: "Businesses text customers through Twilio", url: "https://x.example/a", title: "SMS guide", quote: "text customers through Twilio", by: "qalam", at: 1 } as PlanLook["lines"][number]], pages: [{ title: "SMS guide", url: "https://x.example/a" }] }];
const rounds: PlanRound[] = [{ questions: [{ id: "who", title: "Who pays first?", why: "", multi: false, options: [], recommended: [], allowOther: true }, { id: "skip", title: "Anything else?", why: "", multi: false, options: [], recommended: [], allowOther: true }], answers: { who: "Salons with 2 to 10 locations", skip: "" } }];
const sent = (over: Partial<Parameters<typeof planMaterial>[0]> = {}) => planMaterial({ org: "Reviewly", said: "What should I build? What modules?", outline, rounds, looks, pieces, ...over });
let n = 0;
const id = () => `id${++n}`;

const card = (over: Record<string, unknown> = {}) => ({ ref: "n1", kind: "solution", under: "c2", title: "Review toolkit", description: "", why: "", type: "product", how: "", needed: "no", helps: [], cites: [], metric: { name: "", target: "" }, assumptions: [], test: { assumption: "", what: "", how: "", pass: "" }, ...over });
const keep = (cards: unknown[], extra: Record<string, unknown> = {}, m = sent()) => {
  const dropped: string[] = [];
  const d = sanitizePlan({ cards, start: "", doubt: "", ...extra }, m, { id }, (why) => dropped.push(why));
  return { ...d, dropped };
};

describe("what a plan is told", () => {
  it("says who said what, each with its id, and takes ids out of what numbers can come from", () => {
    const m = sent();
    expect(m.text).toContain("- a1 · Who pays first? · “Salons with 2 to 10 locations”");
    expect(m.text).toContain("- c3 · Problem · “Reviews disappear overnight” · only a page so far");
    expect(m.text).toContain("- q1 · people online · Local Search Forum · “All of our reviews have disappeared overnight” · c3");
    expect(m.text).toContain("- w1 · Businesses text customers through Twilio “text customers through Twilio” · x.example");
    expect(m.hay).not.toMatch(/\b[acqw]\d+ ·/);
    expect(answersOf(rounds)).toEqual([{ question: "Who pays first?", answer: "Salons with 2 to 10 locations" }]);
  });

  it("asks the web across every way of solving it, or what their answers called for", () => {
    expect(planTask({ org: "Reviewly", about: "", said: "What should I build?", outline })).toMatch(/messages and campaigns \(SMS, push, email, social media\)/);
    expect(planTask({ org: "Reviewly", about: "", said: "What should I build?", outline, query: "SMS cost for salons" })).toContain("Look up: SMS cost for salons.");
  });

  it("tells the next step what's on the canvas and how many rounds are left", () => {
    const text = planNextMaterial({ org: "Reviewly", said: "What should I build?", outline, rounds, looks });
    expect(text).toContain("Rounds of questions so far: 1 of at most 3");
    expect(text).toContain("Salons with 2 to 10 locations");
  });
});

describe("the canvas as a plan reads it", () => {
  it("lists goals, problems and solutions, says which are only pages, and leaves tests out", () => {
    const doc: Doc = emptyDoc();
    const add = (c: OstCard, p: string | null) => {
      const node = makeCardNode(c);
      addCardIn(doc, node, p);
      return node.id;
    };
    const g = add(newCard("outcome", { title: "A goal", metric: { name: "Paid", direction: "increase", baseline: null, current: null, target: 5, unit: "people" } }), null);
    const f = add(newCard("opportunity", { title: "A page" }), g);
    const s = add(newCard("solution", { title: "A way", solutionType: "feature" }), f);
    add(newCard("test", { title: "A test" }), s);
    const things = new Map<string, SpaceThing>([[f, { type: "problem", topic: "T1", goal: null }]]);
    expect(planOutline(doc, things)).toEqual([
      { id: g, kind: "outcome", title: "A goal", parent: null, metric: "Paid: target 5 people" },
      { id: f, kind: "opportunity", title: "A page", parent: g, topic: "T1", faint: true },
      { id: s, kind: "solution", title: "A way", parent: f, type: "feature" },
    ]);
  });
});

describe("how a question is taken", () => {
  it("is a plan only when the call says so", () => {
    expect(sanitizeRoute({ route: "plan" })).toBe("plan");
    for (const raw of [{ route: "ask" }, { route: "magic" }, {}, null, "plan"]) expect(sanitizeRoute(raw)).toBe("ask");
  });
});

describe("what comes next", () => {
  const question = { id: "q", title: "How do you reach them?", why: "", multi: false, options: [], recommended: [] };

  it("takes questions while rounds are left, always open to their own words", () => {
    const next = sanitizeNext({ action: "ask", questions: [question], look: "" }, { rounds: [], looks });
    expect(next.action).toBe("ask");
    if (next.action === "ask") expect(next.questions[0].allowOther).toBe(true);
    expect(sanitizeNext({ action: "ask", questions: [question] }, { rounds: [rounds[0], rounds[0], rounds[0]], looks })).toEqual({ action: "ready" });
  });

  it("asks code's own questions the first time when the answer says nothing useful, and goes on after", () => {
    expect(sanitizeNext({ action: "ask", questions: [] }, { rounds: [], looks })).toEqual({ action: "ask", questions: planRound() });
    expect(sanitizeNext({}, { rounds: [], looks })).toEqual({ action: "ask", questions: planRound() });
    expect(sanitizeNext({ action: "ask", questions: [] }, { rounds, looks })).toEqual({ action: "ready" });
    expect(sanitizeNext({ action: "ready" }, { rounds: [], looks })).toEqual({ action: "ready" });
  });

  it("looks again only while looks are left, with web search here, and never twice running", () => {
    const look = { action: "look", look: "SMS cost" };
    expect(sanitizeNext(look, { rounds, looks })).toEqual({ action: "look", query: "SMS cost" });
    const once: PlanLook = { ...looks[0], after: 0 };
    expect(sanitizeNext(look, { rounds, looks: [...looks, once] }).action).not.toBe("look");
    const twice: PlanLook[] = [{ ...once, after: 0 }, { ...once, after: 1 }];
    expect(sanitizeNext(look, { rounds: [rounds[0], rounds[0], rounds[0]], looks: twice }).action).toBe("ready");
    expect(sanitizeNext(look, { rounds, looks: [{ ...looks[0], lines: [], noWeb: true }] }).action).not.toBe("look");
  });
});

describe("what code keeps of a plan", () => {
  it("keeps a tool with its modules under its main problem, each saying where it came from", () => {
    const { cards, start } = keep([card(), card({ ref: "n2", under: "n1", title: "Ask for reviews", type: "none", cites: ["a1"] }), card({ ref: "n3", under: "n1", title: "Watch reviews daily", type: "none", cites: ["q1"], helps: ["c3"] }), card({ ref: "n4", under: "n1", title: "Login and billing", type: "none", needed: "yes" })], { start: "n2" });
    expect(cards.map((c) => [c.title, c.under, c.type, c.came, c.needed])).toEqual([
      ["Review toolkit", { card: "P1" }, "product", "idea", undefined],
      ["Ask for reviews", { ref: "n1" }, undefined, "answers", undefined],
      ["Watch reviews daily", { ref: "n1" }, undefined, "read", undefined],
      ["Login and billing", { ref: "n1" }, undefined, undefined, true],
    ]);
    expect(cards[2].helps).toEqual([{ topic: "T2", title: "Reviews disappear overnight" }]);
    expect(start).toBe("n2");
  });

  it("makes a solution a New product when something hangs under it, and puts a module under no other", () => {
    const { cards } = keep([card({ type: "feature" }), card({ ref: "n2", under: "n1", title: "A part of it", type: "none" })]);
    expect(cards[0].type).toBe("product");
    expect(keep([card({ under: "c4", title: "Under a message" })]).cards).toEqual([]);
  });

  it("keeps any type of solution, says how it's done, and a type it doesn't know is no type", () => {
    const { cards } = keep([card({ type: "message", title: "Text customers once a job ends", how: "SMS, through a tool like Twilio", cites: ["w1"] }), card({ ref: "n2", type: "magic", title: "Something else entirely" })]);
    expect(cards.map((c) => [c.type, c.how, c.came])).toEqual([["message", "SMS, through a tool like Twilio", "read"], [undefined, undefined, "idea"]]);
    expect(cards[0].read).toEqual([{ text: "Businesses text customers through Twilio", url: "https://x.example/a", title: "SMS guide" }]);
  });

  it("takes out what wasn't sent and keeps the card; only a title with nothing left drops it, with what hangs under it", () => {
    const { cards, dropped } = keep([card({ title: "Reach 98% open rates on texts", description: "Most say “I love texts”. It reaches them." }), card({ ref: "n2", kind: "opportunity", under: "", title: "77 of 90 pay" }), card({ ref: "n3", under: "n2", title: "Hangs under it" })]);
    expect(cards.map((c) => [c.title, c.description])).toEqual([["Reach open rates on texts", "It reaches them."]]);
    expect(dropped.some((w) => w.startsWith("its title says nothing"))).toBe(true);
  });

  it("uses the goal or problem the canvas has rather than proposing it again, and drops one proposed twice", () => {
    const { cards } = keep([card({ ref: "n1", kind: "opportunity", under: "c1", title: "Reviews are hard to get", type: "none" }), card({ ref: "n2", under: "n1", title: "A new way" }), card({ ref: "n3", under: "c2", title: "A new way" })]);
    expect(cards.map((c) => [c.title, c.under])).toEqual([["A new way", { card: "P1" }]]);
  });

  it("takes the quote marks off a line some models wrap whole, and leaves wording inside one alone", () => {
    const wrapped = keep([card({ title: "'Monthly review action email'", type: "message", description: "‘It reminds them to come back.’" })], { doubt: "'Nobody has said they would pay.'" });
    expect(wrapped.cards[0]).toMatchObject({ title: "Monthly review action email", description: "It reminds them to come back." });
    expect(wrapped.doubt).toBe("Nobody has said they would pay.");
    expect(keep([card({ title: "Send a ‘Plan it for me’ button to owners", type: "feature" })]).cards[0].title).toBe("Send a ‘Plan it for me’ button to owners");
    expect(keep([card({ title: "Owners' own review wall", type: "feature" })]).cards[0].title).toBe("Owners' own review wall");
  });

  it("doesn't propose a solution the canvas has", () => {
    expect(keep([card({ title: "Text after a visit", type: "message" })]).cards).toEqual([]);
  });

  it("puts a goal or problem on its own, and a solution with nowhere to go nowhere", () => {
    const { cards, dropped } = keep([card({ ref: "n1", kind: "outcome", under: "", title: "Half of salons stay a year", type: "none", metric: { name: "Salons who stay", target: "" } }), card({ ref: "n2", kind: "opportunity", under: "n1", title: "Owners forget to ask", type: "none" }), card({ ref: "n3", under: "", title: "Nowhere to hang" }), card({ ref: "n4", under: "c1", title: "Under a goal" })]);
    expect(cards.map((c) => [c.kind, c.under])).toEqual([["outcome", null], ["opportunity", { ref: "n1" }]]);
    expect(cards[0].metric).toEqual({ name: "Salons who stay", target: null });
    expect(dropped.filter((w) => w.startsWith("a solution goes under"))).toHaveLength(2);
  });

  it("keeps a goal's target only where they said it", () => {
    const goal = (target: string) => card({ kind: "outcome", under: "", title: "More salons stay with us", type: "none", metric: { name: "Salons", target } });
    expect(keep([goal("10")]).cards[0].metric).toEqual({ name: "Salons", target: 10 });
    expect(keep([goal("999")]).cards[0].metric).toEqual({ name: "Salons", target: null });
  });

  it("counts ids only as they were sent, and doesn't link a solution to the problem it's under", () => {
    const { cards } = keep([card({ cites: ["q99", "a99", "w99"], helps: ["c99", "c2", "c1", "c3"] })]);
    expect(cards[0]).toMatchObject({ quotes: [], answers: [], read: [], came: "idea", helps: [{ topic: "T2", title: "Reviews disappear overnight" }] });
  });

  it("has one card to start with: the one it named if it's a solution, else its first, never a part it only needs", () => {
    const needed = card({ ref: "n2", under: "n1", title: "Login and billing", needed: "yes", type: "none" });
    expect(keep([card(), needed], { start: "n2" }).start).toBe("n1");
    expect(keep([card(), needed], { start: "n9" }).start).toBe("n1");
    expect(keep([card({ kind: "opportunity", under: "", type: "none" })], { start: "n1" }).start).toBeNull();
  });

  it("holds to its limits", () => {
    const many = ["Text customers", "Build a widget", "Call owners weekly", "Send postcards", "Hire a concierge"].map((title, i) => card({ ref: `n${i + 1}`, title, type: "feature" }));
    expect(keep(many).cards).toHaveLength(3);
  });

  it("keeps a doubt only as far as it's true to what was sent", () => {
    expect(keep([card()], { doubt: "Nobody has said they'd pay. Open rates are 98%." }).doubt).toBe("Nobody has said they'd pay.");
  });

  it("keeps a test as a plan, its numbers its own, and only of an assumption it kept", () => {
    const [c] = keep([card({ assumptions: [{ category: "desirability", text: "Owners want this", importance: "3" }], test: { assumption: "1", what: "Ask 8 salons", how: "Set it up by hand for 8 salons.", pass: "4 of 8 use it" } })]).cards;
    expect(c.test).toEqual({ assumption: c.assumptions[0].id, what: "Ask 8 salons", how: "Set it up by hand for 8 salons.", suggested: "4 of 8 use it" });
    expect(keep([card({ test: { assumption: "1", what: "Ask 8 salons", how: "By hand.", pass: "" } })]).cards[0].test).toBeUndefined();
  });
});

describe("a plan as proposals on the canvas", () => {
  function canvas() {
    const doc: Doc = emptyDoc();
    const add = (c: OstCard, p: string | null, nid?: string) => {
      const node = { ...makeCardNode(c), ...(nid ? { id: nid } : {}) };
      addCardIn(doc, node, p);
      return node.id;
    };
    add(newCard("outcome", { title: "5 of 10 owners pay for it" }), null, "G");
    add(newCard("opportunity", { title: "Reviews are hard to get" }), "G", "P1");
    add(newCard("opportunity", { title: "Reviews disappear overnight" }), "G", "P2");
    return doc;
  }
  const things = new Map<string, SpaceThing>([["P2", { type: "problem", topic: "T2", goal: null }]]);
  const pages = { T2: { title: "Reviews disappear overnight", evidence: [{ id: "e", kind: "quote" as const, text: "They vanished", addedBy: "ai" as const, at: 1 }] } };
  const propose = (cards: unknown[], extra: Record<string, unknown> = {}) => {
    const d = keep(cards, extra);
    let c = 0;
    return { d, proposals: planProposals(d, { doc: canvas(), things, pages, now: 5, id: () => `x${++c}` }) };
  };
  const land = (doc: Doc, list: Proposal[]) => list.map((p) => applyProposal(doc, p, () => null));

  it("lands every card with its parent first, resting on what it cites, and links what else it helps", () => {
    const { proposals } = propose([card(), card({ ref: "n2", under: "n1", title: "Ask for reviews", type: "none", cites: ["a1", "w1"] }), card({ ref: "n3", under: "n1", title: "Login and billing", type: "none", needed: "yes" }), card({ ref: "n4", kind: "solution", under: "c2", title: "Watch reviews daily", type: "feature", helps: ["c3"] })], { start: "n2" });
    const doc = canvas();
    expect(land(doc, proposals).every(Boolean)).toBe(true);
    const tool = proposals.find((p) => p.id === "sol:n1")!;
    const ask = proposals.find((p) => p.id === "sol:n2")!;
    expect(doc.nodes[tool.cardId].parentId).toBe("P1");
    expect(doc.nodes[ask.cardId].parentId).toBe(tool.cardId);
    const a = doc.nodes[ask.cardId].meta.ost!;
    expect(a).toMatchObject({ came: "answers", start: true });
    expect(a.evidence.map((e) => [e.kind, e.text, e.url])).toEqual([["answer", "Salons with 2 to 10 locations", undefined], ["read", "Businesses text customers through Twilio", "https://x.example/a"]]);
    expect(doc.nodes[proposals.find((p) => p.id === "sol:n3")!.cardId].meta.ost).toMatchObject({ needed: true, createdBy: "ai" });
    expect(helpedCards(doc, proposals.find((p) => p.id === "sol:n4")!.cardId, (t) => (t === "T2" ? "P2" : undefined))).toEqual(["P2"]);
  });

  it("makes a card of a problem that's only a page first, in its place, its page's words on it, and everything under it hangs there", () => {
    const { proposals } = propose([card({ under: "c3", title: "Keep copies of reviews", type: "feature" }), card({ ref: "n2", under: "c3", title: "Alert when one goes", type: "feature" })]);
    expect(proposals.map((p) => p.id)).toEqual(["page:T2", "sol:n1", "sol:n2"]);
    const doc = canvas();
    expect(land(doc, proposals).every(Boolean)).toBe(true);
    const page = proposals[0] as Extract<Proposal, { kind: "card" }>;
    expect(doc.nodes.P2).toBeUndefined();
    expect(doc.nodes[page.cardId]).toMatchObject({ parentId: "G" });
    expect(doc.nodes[page.cardId].meta.ost!.evidence.map((e) => e.text)).toEqual(["They vanished"]);
    expect(doc.nodes[proposals[1].cardId].parentId).toBe(page.cardId);
    expect(doc.nodes.G.children).not.toContain("P2");
  });

  it("brings what a card waits on when it's accepted", () => {
    const { proposals } = propose([card(), card({ ref: "n2", under: "n1", title: "A part of it", type: "none" }), card({ ref: "n3", kind: "opportunity", under: "c1", title: "A new problem here", type: "none" }), card({ ref: "n4", under: "c2", title: "Something that helps it", type: "feature", helps: ["n3"] })]);
    const link = proposals.find((p) => p.kind === "helps")!;
    const needs = withNeeds([link.id], proposals);
    expect(needs).toEqual(["plan:n3", "sol:n4", link.id].sort((a, b) => proposals.findIndex((p) => p.id === a) - proposals.findIndex((p) => p.id === b)));
    expect(withNeeds(["sol:n2"], proposals)).toEqual(["sol:n1", "sol:n2"]);
  });

  it("says what it proposes in a line: the product with its modules, then the rest", () => {
    const { proposals } = propose([card(), card({ ref: "n2", under: "n1", title: "Ask for reviews", type: "none" }), card({ ref: "n3", under: "n1", title: "Watch reviews daily", type: "none", helps: ["c3"] }), card({ ref: "n4", under: "c2", title: "Text after each job", type: "message" })]);
    expect(planLine(proposals)).toBe("a New product, “Review toolkit”, with 2 modules, 1 solution and 1 link to another problem");
    expect(planLine([])).toBe("");
  });

  it("carries a test along under its solution, as a suggestion", () => {
    const { proposals } = propose([card({ assumptions: [{ category: "viability", text: "Owners will pay for it", importance: "3" }], test: { assumption: "1", what: "Ask 8 salons", how: "By hand.", pass: "4 of 8" } })]);
    const t = proposals.find((p) => p.id === "test:n1") as Extract<Proposal, { kind: "card" }>;
    expect(t.parentId).toBe(proposals.find((p) => p.id === "sol:n1")!.cardId);
    expect(t.card.test).toMatchObject({ method: "By hand.", suggested: { criterion: "4 of 8" } });
    expect(t.card.test?.criterion).toBeUndefined();
  });
});

describe("a plan in the chat", () => {
  const turn = (job: ChatTurn["job"]): ChatTurn => ({ id: "t", at: 1, said: "What should I build?", job });

  it("says it stopped when the page closed in the middle of a call, and keeps what it asked", () => {
    for (const step of ["looking", "thinking", "proposing"] as const) expect(chatOf({ v: 1, turns: [turn({ kind: "plan", step, rounds: [], looks: [] })] }).turns[0].job).toMatchObject({ step: "failed", error: "It stopped when the page closed." });
    expect(chatOf({ v: 1, turns: [turn({ kind: "plan", step: "asking", rounds, looks })] }).turns[0].job).toMatchObject({ step: "asking" });
  });

  it("reads each look and round in order, then where it stands", () => {
    const later: PlanLook = { ...looks[0], query: "SMS cost", after: 0 };
    const names = (step: "asking" | "thinking" | "review" | "failed", r = rounds) =>
      threadOf({ v: 1, turns: [turn({ kind: "plan", step, rounds: r, looks: [...looks, later] })] })[1].parts.map((p) => (p.type === "data" ? p.name : "text"));
    expect(names("thinking")).toEqual(["text", "justAnswer", "planLook", "planAnswered", "planLook", "working"]);
    expect(names("asking")).toEqual(["text", "justAnswer", "planLook", "text", "planSkip"]);
    expect(names("review")).toEqual(["text", "justAnswer", "planLook", "planAnswered", "planLook", "planProposed"]);
    expect(names("failed")).toEqual(["text", "justAnswer", "planLook", "planAnswered", "planLook", "text", "planRetry"]);
  });

describe("what they left unanswered", () => {
  const left: PlanRound[] = [{ questions: [{ id: "a", title: "Who pays first?", why: "", multi: false, options: [], recommended: [], allowOther: true }, { id: "b", title: "How many engineers?", why: "", multi: false, options: [], recommended: [], allowOther: true }], answers: { a: "Salons", b: "" } }, { questions: [{ id: "c", title: "Not answered yet", why: "", multi: false, options: [], recommended: [], allowOther: true }] }];

  it("is heard as not known, and never as an answer", () => {
    expect(leftOf(left)).toEqual(["How many engineers?"]);
    const next = planNextMaterial({ org: "Basket", said: "What now?", outline: [], rounds: left, looks: [] });
    expect(next).toContain("left unanswered");
    expect(next).toContain("- How many engineers?");
    const m = planMaterial({ org: "Basket", said: "What now?", outline: [], rounds: left, looks: [], pieces: [] });
    expect(m.text).toContain("- How many engineers?");
    expect(m.hay).not.toContain("How many engineers?");
    expect([...m.answers.values()].map((a) => a.question)).toEqual(["Who pays first?"]);
  });
});
});
