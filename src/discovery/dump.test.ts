import { describe, expect, it } from "vitest";
import { SAMPLE_ANSWERS, SAMPLE_DRAFT_RAW, SAMPLE_DUMP_ANSWERS, SAMPLE_DUMP_FOLLOWUP_RAW, SAMPLE_DUMP_READ_RAW, SAMPLE_DUMP_TEXT } from "@/ai/fixtures-discovery";
import { initialFlow, type FlowState } from "@/ui/ai/questionFlow";
import { toQuestion } from "@/ui/ai/plan";
import { draftToDoc } from "./draft-doc";
import { sanitizeDraft } from "./sanitize";
import {
  MAX_DUMP_ROUNDS,
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
  const answers = Object.fromEntries(b.questions.filter((q) => !q.options.length).map((q) => [q.id, { kind: "text" as const, text: SAMPLE_DUMP_ANSWERS[q.id] ?? "" }]));
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
    expect(s.phase).toBe("ready");
    expect(s.buckets).toHaveLength(2);
  });

  it("stops after the last round even when Qalam AI would ask more", () => {
    const { r, cards } = read();
    const more = sanitizeDumpFollowup(sampleRaw(SAMPLE_DUMP_FOLLOWUP_RAW[0], cards), fragmentRefs(r.fragments), cards);
    let s = session(r);
    for (let i = 0; i < 5; i++) s = applyDumpFollowup(closeDumpRound(s, answered(s), "analyzing"), more);
    expect(s.buckets).toHaveLength(MAX_DUMP_ROUNDS);
    expect(s.phase).toBe("ready");
    // Questions with nothing to say they're needed mean ready too.
    expect(sanitizeDumpFollowup({ ready: false, questions: [] }, [], []).ready).toBe(true);
  });

  it("takes as the builder's words only what they typed, and files the answers in the Library", () => {
    const { r } = read();
    const s = closeDumpRound(session(r), answered(session(r)), "analyzing");
    const [round] = roundAnswers(s);
    expect(round.map((a) => a.questionId)).toEqual(["which-goal", "subscription-need", "tickets-source", "singles"]);
    expect(round[0].answer).toBe("Weekly reorders (Existing customers coming back every week)");
    expect(round[0].words).toBe("");
    expect(round[2].words).toBe("Omar's guess from a busy week, we never counted them.");
    const brief = briefFromDump("d1", s, 5);
    expect(brief.map((a) => a.id)).toEqual(["dump:d1:which-goal", "dump:d1:subscription-need", "dump:d1:tickets-source", "dump:d1:singles"]);
    // Skipping half-way counts only what was answered.
    const half = closeDumpRound(session(r), { ...answered(session(r)), submitted: false }, "skipped");
    expect(half.phase).toBe("ready");
    expect(roundAnswers(half)[0].map((a) => a.questionId)).toEqual(["tickets-source"]);
  });
});
