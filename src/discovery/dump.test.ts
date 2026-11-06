import { describe, expect, it } from "vitest";
import { SAMPLE_ANSWERS, SAMPLE_DRAFT_RAW, SAMPLE_DUMP_ANSWERS, SAMPLE_DUMP_FOLLOWUP_RAW, SAMPLE_DUMP_READ_RAW, SAMPLE_DUMP_TEXT } from "@/ai/fixtures-discovery";
import { initialFlow, type FlowState } from "@/ui/ai/questionFlow";
import { toQuestion } from "@/ui/ai/plan";
import { draftToDoc } from "./draft-doc";
import { sanitizeDraft } from "./sanitize";
import {
  withLook,
  withRound,
  askedOf,
  applyDumpFollowup,
  briefFromDump,
  closeDumpRound,
  firstRound,
  fragmentRefs,
  looksLikeDump,
  outlineOf,
  roundAnswers,
  sampleRaw,
  sanitizeDumpFollowup,
  sanitizeRead,
  withRoles,
  type DumpSession,
} from "./dump";

/** The sample board: Basket's tree as the interview drafted it. */
function board() {
  const built = draftToDoc(sanitizeDraft(SAMPLE_DRAFT_RAW, SAMPLE_ANSWERS), { x: 0, y: 0 })!;
  return { doc: built.doc, rootId: built.rootId, ...outlineOf(built.doc) };
}

/** The sample's read, against the sample board. */
function read() {
  const b = board();
  return { ...b, r: sanitizeRead(sampleRaw(SAMPLE_DUMP_READ_RAW, b.cards), SAMPLE_DUMP_TEXT, b.cards, 1) };
}

const session = (r: ReturnType<typeof read>["r"]): DumpSession => ({ v: 1, phase: "asking", understanding: r.understanding, challenges: r.challenges, buckets: firstRound(r.questions), anchor: null });

/** A round answered with Qalam AI's picks, open questions in the founder's words. */
function answered(s: DumpSession): FlowState {
  const b = s.buckets[s.buckets.length - 1];
  const answers = Object.fromEntries(
    b.questions.map((q) => [
      q.id,
      q.options.length ? (q.multi ? { kind: "multi" as const, values: q.recommended, custom: [] } : { kind: "single" as const, value: q.recommended[0] ?? q.options[0].value }) : { kind: "text" as const, text: SAMPLE_DUMP_ANSWERS[q.id] ?? "" },
    ]),
  );
  return { ...initialFlow(b.questions.map(toQuestion)), answers, submitted: true };
}

describe("looksLikeDump", () => {
  const thinking =
    "ok so the thing is people come back once and then drop off. I think it's the substitutions, parents hate getting the wrong milk. Maybe we do a rules thing where you set it once? Also investors want orders up by Q2 and I'm not sure that's the same goal.";
  it("takes a few sentences of someone thinking, in English or Arabic", () => {
    expect(looksLikeDump(thinking)).toBe(true);
    expect(looksLikeDump(SAMPLE_DUMP_TEXT)).toBe(true);
    const arabic =
      "طيب الفكرة إن الناس بترجع مرة واحدة وبعدين بتختفي. أنا شايف إن المشكلة في البدائل، الأهالي بيكرهوا لما يجيلهم نوع لبن غلط ومحدش سألهم. ممكن نعمل حاجة يحددوا فيها القواعد مرة واحدة؟ وكمان المستثمرين عايزين الطلبات تزيد قبل الربع التاني ومش متأكد إن ده نفس الهدف خالص يعني.";
    expect(looksLikeDump(arabic)).toBe(true);
  });

  it("leaves a word, a link or data alone", () => {
    expect(looksLikeDump("Order again shelf")).toBe(false);
    expect(looksLikeDump(`https://example.com/${"a".repeat(300)}`)).toBe(false);
    expect(looksLikeDump(JSON.stringify({ text: thinking }))).toBe(false);
    expect(looksLikeDump("word ".repeat(80))).toBe(false);
  });
});

describe("the board beside a brain dump", () => {
  it("names every card, with what it says and rests on", () => {
    const b = board();
    const outcome = b.tree[0];
    expect(outcome).toMatchObject({ id: "c1", parent: null, kind: "outcome", title: "More customers reorder every week", metric: "Weekly reorders per customer · 1.2 now → 1.5 orders · by March", words: 0 });
    const shelf = b.tree.find((c) => c.title === "Order again shelf on the home screen")!;
    expect(shelf.words).toBe(1);
    expect(shelf.assumptions).toHaveLength(3);
    const finer = b.cards.find((c) => c.title === "Rebuilding my usual basket takes too long")!;
    expect(finer.depth).toBe(2);
  });

  it("swaps the sample's card names for the refs a call gives them", () => {
    const b = board();
    const raw = sampleRaw({ a: "@I forget to reorder until I've run out", b: ["@Nope", "plain"] }, b.cards);
    expect(raw.a).toBe(b.cards.find((c) => c.title === "I forget to reorder until I've run out")!.ref);
    expect(raw.b).toEqual(["@Nope", "plain"]);
  });
});

describe("reading a brain dump", () => {
  it("keeps only pieces found in the builder's words, once each, in the order written", () => {
    const { r } = read();
    expect(r.fragments).toHaveLength(18);
    for (const f of r.fragments) expect(SAMPLE_DUMP_TEXT.slice(f.span[0], f.span[1])).toBe(f.text);
    expect(r.fragments.some((f) => f.text.includes("priority evening slots"))).toBe(false);
    expect(r.fragments.filter((f) => f.text.startsWith("Parents hate substitutions"))).toHaveLength(1);
    const spans = r.fragments.map((f) => f.span[0]);
    expect(spans).toEqual([...spans].sort((a, b) => a - b));
  });

  it("gives every piece a role it knows", () => {
    const { r } = read();
    expect(r.fragments.find((f) => f.text.startsWith("Dubai"))!.role).toBe("context");
    expect(r.fragments.find((f) => f.text.startsWith("Customers need a subscription"))!.role).toBe("need");
    expect(r.fragments.find((f) => f.text.startsWith("We could fake-door"))).toMatchObject({ role: "test", kind: "idea" });
  });

  it("keeps pushback only on kept pieces, and a card only when it's on the board", () => {
    const { r, cards } = read();
    expect(r.challenges.map((c) => c.kind)).toEqual(["business-goal", "solution-as-need", "second-hand", "conflict", "competing-goals"]);
    const box = r.challenges.find((c) => c.kind === "solution-as-need")!;
    expect(box.cardId).toBe(cards.find((c) => c.title === "I forget to reorder until I've run out")!.id);
    expect(r.challenges.find((c) => c.kind === "competing-goals")!.cardId).toBeUndefined();
    for (const c of r.challenges) expect(r.fragments.some((f) => f.id === c.quoteId)).toBe(true);
    expect(r.questions.map((q) => q.id)).toEqual(["which-goal", "subscription-need", "tickets-source", "singles"]);
  });

  it("reads the call's ids in what it says to the builder as what they name", () => {
    const { cards } = read();
    const text = "Parents hate substitutions, they get the wrong milk brand and nobody asked them. We could do a substitution preferences thing.";
    const c = cards.find((x) => x.title === "I forget to reorder until I've run out")!;
    const raw = {
      understanding: "The need in f1 (f1) leads.",
      fragments: [
        { id: "f1", quote: "Parents hate substitutions, they get the wrong milk brand and nobody asked them.", role: "need" },
        { id: "f2", quote: "We could do a substitution preferences thing.", role: "idea" },
      ],
      challenges: [{ kind: "solution-as-need", fragmentId: "f2", cardId: c.ref, text: `f2 is a feature; the need is f1 (f1, f2), close to ${c.ref}. Ask about f9.` }],
    };
    const r = sanitizeRead(raw, text, cards, 1);
    expect(r.understanding).toBe("The need in “Parents hate substitutions, they get the wrong milk…” leads.");
    expect(r.challenges[0].text).toBe("“We could do a substitution preferences thing” is a feature; the need is “Parents hate substitutions, they get the wrong milk…”, close to “I forget to reorder until I've run out”. Ask about f9.");
    const f = sanitizeDumpFollowup({ analysis: "That settles f2.", understanding: "", challenges: [] }, fragmentRefs(r.fragments), cards);
    expect(f.analysis).toBe("That settles “We could do a substitution preferences thing”.");
  });

  it("reads the ids in its questions as what they name too: the question, its why, its options", () => {
    const { cards } = read();
    const c = cards.find((x) => x.title === "I forget to reorder until I've run out")!;
    const text = "Parents hate substitutions, they get the wrong milk brand and nobody asked them.";
    const question = { id: "where", title: `Where does f1 go: under ${c.ref}?`, why: `It decides whether ${c.ref} splits (${c.ref}).`, options: [
        { value: "under", label: `Under ${c.ref}`, description: "A narrower need." },
        { value: "own", label: "On its own", description: `Apart from ${c.ref}.` },
      ] };
    const r = sanitizeRead({ fragments: [{ id: "f1", quote: text, role: "need" }], questions: [question] }, text, cards, 1);
    expect(r.questions[0]).toMatchObject({ title: "Where does “Parents hate substitutions, they get the wrong milk…” go: under “I forget to reorder until I've run out”?", why: "It decides whether “I forget to reorder until I've run out” splits." });
    expect(r.questions[0].options.map((o) => [o.label, o.description])).toEqual([
      ["Under “I forget to reorder until I've run out”", "A narrower need."],
      ["On its own", "Apart from “I forget to reorder until I've run out”."],
    ]);
    const f = sanitizeDumpFollowup({ questions: [question] }, fragmentRefs(r.fragments), cards);
    expect(f.questions[0].options[0].label).toBe("Under “I forget to reorder until I've run out”");
  });

  it("takes pieces only from their parts of the text, never from a question Qalam AI asked", () => {
    const { cards } = read();
    const text = "Which outcome matters most?\nMore restaurants hand over oil every week";
    const r = sanitizeRead({ fragments: [{ id: "f1", quote: "Which outcome matters most?", role: "goal" }, { id: "f2", quote: "More restaurants hand over oil every week", role: "goal" }] }, text, cards, 1, [[28, text.length]]);
    expect(r.fragments.map((f) => f.text)).toEqual(["More restaurants hand over oil every week"]);
  });

  it("adds a round's questions and answers to the text, under a heading, its pieces where they were", () => {
    const text = "Collect more oil from restaurants.";
    const r = withRound(text, [], [{ questionId: "q1", question: "How much do you collect today?", answer: "About 100 tons a month", words: "About 100 tons a month" }, { questionId: "q2", question: "By when?", answer: "", words: "" }], 2);
    expect(r.text).toBe("Collect more oil from restaurants.\n\nQalam AI asked, and you answered (round 2):\n\nHow much do you collect today?\nAbout 100 tons a month");
    expect(r.blocks.map((b) => [b.kind, r.text.slice(...b.span)])).toEqual([
      ["h2", "Qalam AI asked, and you answered (round 2):"],
      ["h3", "How much do you collect today?"],
    ]);
    expect(withRound(text, [], [], 2).text).toBe(text);
  });

  it("adds a look on the web to the text under a heading saying whose words they are, each line with where it was read", () => {
    const text = "Finding the problem to focus on.";
    const look = { query: "why PMs drop new tools", lines: [{ id: "f1", text: "Most PMs drop a tool that doesn't fit their workflow.", url: "https://www.example.com/a", by: "qalam" as const, at: 1 }, { id: "f2", text: "Setup takes too long.", by: "qalam" as const, at: 1 }] };
    const r = withLook(text, [{ kind: "h3", span: [0, 7] }], look);
    expect(r.text).toBe("Finding the problem to focus on.\n\nQalam AI looked on the web for “why PMs drop new tools” (others' words, not yours or your customers'):\n- Most PMs drop a tool that doesn't fit their workflow. (example.com)\n- Setup takes too long.");
    expect(r.blocks.map((b) => [b.kind, r.text.slice(...b.span)])).toEqual([
      ["h3", "Finding"],
      ["h2", "Qalam AI looked on the web for “why PMs drop new tools” (others' words, not yours or your customers'):"],
    ]);
    expect(withLook(text, [], { query: "x", lines: [] }).text).toBe(text);
  });

  it("hears what Qalam AI wants looked up before its next round, in words", () => {
    const { cards } = read();
    const c = cards.find((x) => x.title === "I forget to reorder until I've run out")!;
    expect(sanitizeDumpFollowup({ look: `  why parents   forget ${c.ref} ` }, [], cards).look).toBe("why parents forget “I forget to reorder until I've run out”");
    expect(sanitizeDumpFollowup({ questions: [] }, [], cards).look).toBe("");
  });

  it("says, for a file read for a card, when nothing in it bears on the card, and what file would help, in words", () => {
    const { cards } = read();
    const c = cards.find((x) => x.title === "I forget to reorder until I've run out")!;
    const text = "Croissant 3.50. Pain au chocolat 3.80. Sourdough loaf 6.00. Open daily from seven until two.";
    const off = sanitizeRead({ bears: false, wanted: `Notes from talks with people who say ${c.ref} (${c.ref}).`, understanding: "A price list and opening hours.", fragments: [] }, text, cards, 1);
    expect(off).toMatchObject({ bears: false, wanted: "Notes from talks with people who say “I forget to reorder until I've run out”.", understanding: "A price list and opening hours.", fragments: [] });
    // A read that says nothing about it bears (a brain dump's, or a file's that does).
    expect(sanitizeRead({ fragments: [] }, text, cards, 1)).toMatchObject({ bears: true, wanted: "" });
  });

  it("finds Arabic pieces whatever the hamza or the short vowels", () => {
    const text = "أنا شايف إن الأهالي بيكرهوا البدائل لما محدش يسألهم.";
    const r = sanitizeRead({ fragments: [{ id: "f1", quote: "انا شايف ان الاهالي بيكرهوا البدائل", role: "need" }] }, text, [], 1);
    expect(r.fragments[0]?.text).toBe("أنا شايف إن الأهالي بيكرهوا البدائل");
  });

  it("survives output that isn't what was asked for", () => {
    expect(sanitizeRead(null, SAMPLE_DUMP_TEXT, [])).toMatchObject({ understanding: "", fragments: [], challenges: [], questions: [] });
    expect(sanitizeRead({ fragments: "x", challenges: [{ kind: "rude" }] }, SAMPLE_DUMP_TEXT, []).challenges).toEqual([]);
  });
});

describe("rounds of questions", () => {
  it("reads each round, revises, and asks again until ready", () => {
    const { r, cards } = read();
    let s = closeDumpRound(session(r), answered(session(r)), "analyzing");
    expect(s.phase).toBe("analyzing");
    const pieces = fragmentRefs(r.fragments);
    const f1 = sanitizeDumpFollowup(sampleRaw(SAMPLE_DUMP_FOLLOWUP_RAW[0], cards), pieces, cards);
    expect(f1.roles).toEqual([{ quoteId: pieces.find((p) => p.ref === "f10")!.q.id, role: "idea" }]);
    s = applyDumpFollowup(s, f1);
    expect(s.phase).toBe("asking");
    expect(s.buckets).toHaveLength(2);
    expect(s.buckets[0].analysis).toContain("Weekly reorders lead");
    expect(s.challenges.map((c) => c.kind)).toEqual(["second-hand", "conflict"]);
    expect(withRoles(r.fragments, f1.roles).find((f) => f.text.startsWith("Customers need"))!.role).toBe("idea");
    s = applyDumpFollowup(closeDumpRound(s, answered(s), "analyzing"), sanitizeDumpFollowup(SAMPLE_DUMP_FOLLOWUP_RAW[1], pieces, cards));
    // Something was asked: what's settled shows before it places.
    expect(s.phase).toBe("settled");
    expect(s.buckets).toHaveLength(2);
  });

  it("asks as many rounds as it needs, never a question asked before, and shows what's settled when it's done", () => {
    const { r, cards } = read();
    const raw = sampleRaw(SAMPLE_DUMP_FOLLOWUP_RAW[0], cards);
    const more = sanitizeDumpFollowup(raw, fragmentRefs(r.fragments), cards);
    let s = session(r);
    for (let i = 0; i < 5; i++) s = applyDumpFollowup(closeDumpRound(s, answered(s), "analyzing"), more);
    expect(s.buckets).toHaveLength(6);
    expect(s.phase).toBe("asking");
    // The same questions again are asked already: nothing new, so what's settled shows.
    const again = sanitizeDumpFollowup(raw, fragmentRefs(r.fragments), cards, askedOf(s));
    expect(again.questions).toEqual([]);
    expect(applyDumpFollowup(closeDumpRound(s, answered(s), "analyzing"), again).phase).toBe("settled");
    // Questions with nothing to say they're needed mean ready too.
    expect(sanitizeDumpFollowup({ ready: false, questions: [] }, [], []).ready).toBe(true);
  });

  it("holds a question that waits on another of the same turn", () => {
    const { r, cards } = read();
    const q = (id: string, title: string, after: string[] = []) => ({ id, title, why: "", multi: false, options: [], recommended: [], allowOther: true, after });
    const f = sanitizeDumpFollowup({ ready: false, questions: [q("who", "Who orders weekly?"), q("how", "How do weekly orderers pay?", ["who"])] }, fragmentRefs(r.fragments), cards);
    const s = applyDumpFollowup(closeDumpRound(session(r), answered(session(r)), "analyzing"), f);
    expect(s.buckets.at(-1)?.questions.map((x) => x.id)).toEqual(["who"]);
    expect(s.held?.map((x) => x.id)).toEqual(["how"]);
  });

  it("takes as the builder's words only what they typed, and files the answers in the Library", () => {
    const { r } = read();
    const s = closeDumpRound(session(r), answered(session(r)), "analyzing");
    const [round] = roundAnswers(s);
    expect(round.map((a) => a.questionId)).toEqual(["which-goal", "subscription-need", "tickets-source", "singles"]);
    expect(round[0].answer).toBe("Weekly reorders (Existing customers coming back every week)");
    expect(round[0].words).toBe("");
    expect(round[0].said).toBe("Weekly reorders");
    // One they left stays empty, and reads as skipped: never a preference, never their words.
    const left = roundAnswers(closeDumpRound(session(r), { ...answered(session(r)), answers: {} }, "analyzing"))[0];
    expect(left.every((a) => a.answer === "" && a.words === "" && a.said === "")).toBe(true);
    expect(round[2].words).toBe("Omar's guess from a busy week, we never counted them.");
    const brief = briefFromDump("d1", s, 5);
    expect(brief.map((a) => a.id)).toEqual(["dump:d1:which-goal", "dump:d1:subscription-need", "dump:d1:tickets-source", "dump:d1:singles"]);
    // Skipping half-way counts only what was answered.
    const whole = answered(session(r));
    const half = closeDumpRound(session(r), { ...whole, answers: { "tickets-source": whole.answers["tickets-source"] }, submitted: false }, "skipped");
    expect(half.phase).toBe("settled");
    expect(roundAnswers(half)[0].map((a) => a.questionId)).toEqual(["tickets-source"]);
  });
});
