import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { SAMPLE_ANSWERS, SAMPLE_DRAFT_RAW, SAMPLE_DUMP_ANSWERS, SAMPLE_DUMP_FOLLOWUP_RAW, SAMPLE_DUMP_PLACE_RAW, SAMPLE_DUMP_READ_RAW, SAMPLE_DUMP_TEXT } from "@/ai/fixtures-discovery";
import type { Doc } from "@/doc/schema";
import { isNote, isOstCard, treeBounds } from "@/doc/board";
import { initialFlow, type FlowState } from "@/ui/ai/questionFlow";
import { toQuestion } from "@/ui/ai/plan";
import { draftToDoc } from "./draft-doc";
import { sanitizeDraft } from "./sanitize";
import { quoteEvidence, hasQuote, type SourceRecord } from "./sources";
import { isAssumed } from "./evidence";
import { applyDumpFollowup, closeDumpRound, firstRound, fragmentRefs, outlineOf, roundAnswers, sampleRaw, sanitizeDumpFollowup, sanitizeRead, type DumpSession } from "./dump";
import { partialPlace, sanitizePlace, type PlaceContext } from "./place";
import { applyProposal, arrangeNew, proposalDoc, proposalKey, touchedRoots, withDependents, withNeeds, type EvidenceOf, type Proposal } from "./proposals";

/** A round answered with Qalam AI's picks, open questions in the founder's words. */
function answered(s: DumpSession): FlowState {
  const b = s.buckets[s.buckets.length - 1];
  const answers = Object.fromEntries(b.questions.filter((q) => !q.options.length).map((q) => [q.id, { kind: "text" as const, text: SAMPLE_DUMP_ANSWERS[q.id] ?? "" }]));
  return { ...initialFlow(b.questions.map(toQuestion)), answers, submitted: true };
}

/** Basket's board as the interview drafted it (one board, so its card ids hold across runs). */
const built = draftToDoc(sanitizeDraft(SAMPLE_DRAFT_RAW, SAMPLE_ANSWERS), { x: 0, y: 0 })!;

/** The sample, all the way: Basket's board, the founder's dump read, both rounds answered. */
function sample(settled: string[] = []) {
  const doc = built.doc;
  const { cards } = outlineOf(doc);
  const read = sanitizeRead(sampleRaw(SAMPLE_DUMP_READ_RAW, cards), SAMPLE_DUMP_TEXT, cards, 1);
  let s: DumpSession = { v: 1, phase: "asking", understanding: read.understanding, challenges: read.challenges, buckets: firstRound(read.questions), anchor: built.rootId };
  const pieces = fragmentRefs(read.fragments);
  for (const raw of SAMPLE_DUMP_FOLLOWUP_RAW) s = applyDumpFollowup(closeDumpRound(s, answered(s), "analyzing"), sanitizeDumpFollowup(sampleRaw(raw, cards), pieces, cards));
  const source: SourceRecord = { v: 1, id: "dump1", projectId: "p", kind: "dump", title: "Basket founder", text: SAMPLE_DUMP_TEXT, addedAt: 1, read: [], quotes: read.fragments, needs: [], dump: s };
  const answers = roundAnswers(s)
    .flat()
    .map((a, i) => ({ ref: `a${i + 1}`, answerId: `dump:dump1:${a.questionId}`, words: a.words }));
  const ctx: PlaceContext = {
    cards,
    pieces,
    sourceId: "dump1",
    answers,
    said: [SAMPLE_DUMP_TEXT, ...answers.map((a) => a.words)].join("\n"),
    settled: new Set(settled),
    has: (cardId, span) => {
      const n = doc.nodes[cardId];
      return isOstCard(n) && hasQuote(n.meta.ost, "dump1", span);
    },
    anchor: built.rootId,
  };
  const evidenceOf: EvidenceOf = (q, against) => {
    const quote = source.quotes.find((x) => x.id === q.quoteId);
    return q.sourceId === "dump1" && quote ? quoteEvidence(source, quote, "ai", { against, now: 1 }) : null;
  };
  const byTitle = (t: string) => cards.find((c) => c.title === t)!.id;
  const raw = sampleRaw(SAMPLE_DUMP_PLACE_RAW, cards);
  return { doc, rootId: built.rootId, cards, ctx, evidenceOf, byTitle, raw, proposals: sanitizePlace(raw, ctx, new Map(), 1) };
}

const ofKind = <K extends Proposal["kind"]>(list: Proposal[], kind: K) => list.filter((p): p is Extract<Proposal, { kind: K }> => p.kind === kind);

describe("placing a brain dump", () => {
  it("adds cards only where the tree lets them hang, each on the founder's words", () => {
    const { proposals, byTitle } = sample();
    const cards = ofKind(proposals, "card");
    expect(cards.map((p) => p.card.title)).toEqual([
      "Reach 2M dirhams a month in orders",
      "More first-time customers order a second time",
      "I get the wrong brand and nobody asks me",
      "Substitution rules you set once",
      "Staples subscription box",
      "Fake-door subscription button",
      "WhatsApp delivery updates",
    ]);
    const [goal, second, need, rules, box, fake] = cards;
    expect(goal.parentId).toBeNull();
    expect(second.parentId).toBe(goal.cardId);
    expect(need.parentId).toBe(byTitle("More customers reorder every week"));
    expect(rules.parentId).toBe(need.cardId);
    expect(box.parentId).toBe(byTitle("I forget to reorder until I've run out"));
    expect(fake.parentId).toBe(box.cardId);
    expect(fake.card.test).toEqual({ assumptionIds: [], method: "A subscription button that leads to a waitlist", criterion: "1 in 10 who see it tap it" });
    for (const p of cards) expect(p.card.createdBy).toBe("ai");
    for (const p of cards) expect(p.backing.quotes.length).toBeGreaterThan(0);
  });

  it("drops what has nothing of the founder's behind it, and what repeats a card", () => {
    const titles = ofKind(sample().proposals, "card").map((p) => p.card.title);
    expect(titles).not.toContain("Priority evening slots for a fee");
    expect(titles).not.toContain("Bigger baskets");
    expect(titles).not.toContain("I can't find what I ordered last time");
  });

  it("keeps a number only where the founder wrote it, and answer words only where they typed them", () => {
    const { proposals, byTitle } = sample();
    const [goal, second, need] = ofKind(proposals, "card");
    expect(goal.card.metric).toEqual({ name: "Orders per month", unit: "AED", direction: "increase", baseline: 1_400_000, current: 1_400_000, target: 2_000_000, timeframe: "by end of Q2" });
    // 42 was never said: "now" falls back to where things are.
    expect(second.card.metric).toMatchObject({ baseline: 38, current: 38, target: 50 });
    expect(need.backing.words).toEqual([]);
    const metric = ofKind(proposals, "metric");
    expect(metric).toHaveLength(1);
    expect(metric[0].cardId).toBe(byTitle("More customers reorder every week"));
    expect(metric[0].metric).toEqual({ current: 1.3 });
  });

  it("puts the dump's words on cards that can take them, for and against", () => {
    const { proposals, byTitle } = sample();
    const words = proposals.filter((p): p is Extract<Proposal, { kind: "attach" | "against" }> => p.kind === "attach" || p.kind === "against");
    expect(words.map((p) => [p.kind, p.cardId])).toEqual([
      ["attach", byTitle("More customers reorder every week")],
      ["attach", byTitle("I'm never sure when my order will arrive")],
      ["against", byTitle("I'm never sure when my order will arrive")],
      ["attach", byTitle("Evening slots are full when I need them")],
      ["attach", byTitle("Order again shelf on the home screen")],
    ]);
  });

  it("rewords, moves and merges only as the tree allows", () => {
    const { proposals, byTitle } = sample();
    const [goal] = ofKind(proposals, "card");
    expect(ofKind(proposals, "edit")).toMatchObject([{ cardId: byTitle("Evening slots are full when I need them"), from: "Evening slots are full when I need them", title: "The 8–10pm slots are gone by the time I shop" }]);
    expect(ofKind(proposals, "move")).toMatchObject([{ cardId: byTitle("More customers reorder every week"), fromParent: null, parentId: goal.cardId }]);
    expect(ofKind(proposals, "merge")).toMatchObject([{ cardId: byTitle("Order again shelf on the home screen"), dropId: byTitle("Saved baskets to reorder in one tap"), title: "One usual basket button on the home screen" }]);
    expect(ofKind(proposals, "assumption")[0].assumptions.map((a) => a.text)).toEqual(["Most weeks' baskets are close to one usual basket."]);
    expect(ofKind(proposals, "note").map((p) => [p.color, p.anchorId])).toEqual([
      ["yellow", goal.cardId],
      ["pink", byTitle("I'm never sure when my order will arrive")],
    ]);
  });

  it("never moves a card under itself, nor merges a card with one it holds", () => {
    const { ctx, byTitle, cards } = sample();
    const ref = (t: string) => cards.find((c) => c.id === byTitle(t))!.ref;
    const out = sanitizePlace(
      {
        moves: [{ cardId: ref("More customers reorder every week"), parentCard: ref("I can't find what I ordered last time"), parentNew: null, why: "" }],
        merges: [{ keep: ref("I can't find what I ordered last time"), drop: ref("Rebuilding my usual basket takes too long"), title: null, why: "" }],
      },
      ctx,
    );
    expect(out).toEqual([]);
  });

  it("lets a need of Qalam AI's own reading stay only while it holds something of the founder's", () => {
    const { ctx, byTitle, cards } = sample();
    const ref = cards.find((c) => c.id === byTitle("More customers reorder every week"))!.ref;
    const need = { id: "n1", kind: "opportunity", parentCard: ref, parentNew: null, title: "I run out of staples between shops", description: "", fragmentIds: [], answers: [], metric: null, assumptions: [], test: null, why: "" };
    const idea = { ...need, id: "n2", kind: "solution", parentCard: null, parentNew: "n1", title: "Staples box", fragmentIds: ["f10"] };
    const alone = ofKind(sanitizePlace({ cards: [need] }, ctx), "card");
    expect(alone).toEqual([]);
    const both = ofKind(sanitizePlace({ cards: [need, idea] }, ctx), "card");
    expect(both.map((p) => p.card.title)).toEqual(["I run out of staples between shops", "Staples box"]);
    expect(isAssumed({ ...both[0].card, evidence: [] })).toBe(true);
  });

  it("doesn't propose again what the founder discarded", () => {
    const first = sample();
    const box = ofKind(first.proposals, "card").find((p) => p.card.title === "Staples subscription box")!;
    const edit = ofKind(first.proposals, "edit")[0];
    const again = sample([proposalKey(box, first.proposals), proposalKey(edit)]).proposals;
    expect(ofKind(again, "card").map((p) => p.card.title)).not.toContain("Staples subscription box");
    // What waits on it goes too.
    expect(ofKind(again, "card").map((p) => p.card.title)).not.toContain("Fake-door subscription button");
    expect(ofKind(again, "edit")).toEqual([]);
  });

  it("keeps the ids of what's already written while the answer streams in", () => {
    const { ctx, raw } = sample();
    const ids = new Map<string, string>();
    const text = JSON.stringify(raw);
    const half = partialPlace(JSON.parse(text.slice(0, text.indexOf('"id":"n4"') - 2) + "]}"), ctx, ids);
    const full = sanitizePlace(raw, ctx, ids);
    const first = ofKind(half, "card");
    expect(first.map((p) => p.card.title)).toEqual(["Reach 2M dirhams a month in orders", "More first-time customers order a second time", "I get the wrong brand and nobody asks me"]);
    for (const p of first) expect(ofKind(full, "card").find((x) => x.card.title === p.card.title)!.cardId).toBe(p.cardId);
  });
});

describe("proposals on the board", () => {
  /** Everything accepted, in order. */
  const acceptAll = (doc: Doc, list: Proposal[], ev: EvidenceOf) => produce(doc, (d) => void list.forEach((p) => applyProposal(d, p, ev)));

  it("carry out every kind: the board as the founder would have it", () => {
    const { doc, proposals, evidenceOf, byTitle } = sample();
    const placed = arrangeNew(doc, proposals, evidenceOf);
    const after = acceptAll(doc, placed, evidenceOf);
    const [goal, second] = ofKind(placed, "card");
    const cardRoots = after.roots.filter((r) => isOstCard(after.nodes[r]));
    expect(cardRoots).toEqual([goal.cardId]);
    expect(after.nodes[goal.cardId].children).toEqual([second.cardId, byTitle("More customers reorder every week")]);
    expect(after.nodes[byTitle("Evening slots are full when I need them")].meta.ost!.title).toBe("The 8–10pm slots are gone by the time I shop");
    expect(after.nodes[byTitle("Saved baskets to reorder in one tap")]).toBeUndefined();
    const shelf = after.nodes[byTitle("Order again shelf on the home screen")].meta.ost!;
    expect(shelf.title).toBe("One usual basket button on the home screen");
    expect(shelf.assumptions!.length).toBe(3 + 2 + 1);
    expect(shelf.evidence.some((e) => e.kind === "dump")).toBe(true);
    expect(after.nodes[byTitle("More customers reorder every week")].meta.ost!.metric!.current).toBe(1.3);
    const notes = after.roots.filter((r) => isNote(after.nodes[r]));
    expect(notes).toHaveLength(2);
    const against = after.nodes[byTitle("I'm never sure when my order will arrive")].meta.ost!.evidence;
    expect(against.map((e) => e.stance ?? "for")).toEqual(["for", "for", "against"]);
  });

  it("go to the right of the board when they start a tree, notes beside their card", () => {
    const { doc, rootId, proposals, evidenceOf } = sample();
    const placed = arrangeNew(doc, proposals, evidenceOf);
    const [goal] = ofKind(placed, "card");
    const board = treeBounds(doc, rootId);
    expect(goal.at!.x).toBeGreaterThanOrEqual(board.x + board.w + 240);
    for (const n of ofKind(placed, "note")) expect(n.at).toBeDefined();
    const [a, b] = ofKind(placed, "note");
    expect(Math.abs(a.at!.y - b.at!.y) > 100 || Math.abs(a.at!.x - b.at!.x) > 200).toBe(true);
  });

  it("are drawn together when a move joins two trees, untouched cards exactly as they are", () => {
    const { doc, rootId, proposals, evidenceOf, byTitle } = sample();
    const placed = arrangeNew(doc, proposals, evidenceOf);
    const [goal] = ofKind(placed, "card");
    const move = ofKind(placed, "move")[0];
    expect(touchedRoots(doc, move, placed).sort()).toEqual([goal.cardId, rootId].sort());
    const g = proposalDoc(doc, [rootId, goal.cardId], placed.filter((p) => p.kind !== "note"), evidenceOf)!;
    expect(g.roots).toEqual([goal.cardId]);
    const still = byTitle("I have to stay home waiting for the delivery");
    expect(g.nodes[still].meta.ost).toBe(doc.nodes[still].meta.ost);
    // The moved card draws as a change, at its new place.
    expect(g.nodes[rootId].meta.ost).not.toBe(doc.nodes[rootId].meta.ost);
    expect(g.nodes[rootId].parentId).toBe(goal.cardId);
  });

  it("take what they wait on when accepted, and what waits on them when discarded", () => {
    const { proposals } = sample();
    const cards = ofKind(proposals, "card");
    const rules = cards.find((p) => p.card.title === "Substitution rules you set once")!;
    const need = cards.find((p) => p.card.title === "I get the wrong brand and nobody asks me")!;
    expect(withNeeds([rules.id], proposals).sort()).toEqual([rules.id, need.id].sort());
    const box = cards.find((p) => p.card.title === "Staples subscription box")!;
    const fake = cards.find((p) => p.card.title === "Fake-door subscription button")!;
    expect(withDependents([box.id], proposals).sort()).toEqual([box.id, fake.id].sort());
  });

  it("don't apply once they no longer fit", () => {
    const { doc, proposals, evidenceOf, byTitle } = sample();
    const edit = ofKind(proposals, "edit")[0];
    const renamed = produce(doc, (d) => void (d.nodes[byTitle("Evening slots are full when I need them")].meta.ost!.title = "Something else"));
    expect(produce(renamed, (d) => void expect(applyProposal(d, edit, evidenceOf)).toBe(false))).toBeDefined();
    const merge = ofKind(proposals, "merge")[0];
    const gone = produce(doc, (d) => {
      const id = merge.dropId;
      const parent = d.nodes[d.nodes[id].parentId!];
      parent.type === "frame" && (parent.children = parent.children.filter((c) => c !== id));
      delete d.nodes[id];
    });
    produce(gone, (d) => void expect(applyProposal(d, merge, evidenceOf)).toBe(false));
  });
});
