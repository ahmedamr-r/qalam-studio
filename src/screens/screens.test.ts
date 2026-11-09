import { describe, expect, it } from "vitest";
import { keepQuestions } from "@/asking/sanitize";
import { toolAsk } from "@/connectors/suggest";
import { gateOf } from "@/memory/gate";
import { lineOf, linesFor, foldAsked } from "@/memory/fold";
import { toQuestion } from "@/ui/ai/plan";
import { SHOTS_MAX, addAnswerShots, answerOf, answerWords, knownAnswer, removeShot, summarize, validate, type Question } from "@/ui/ai/questionFlow";
import { keptScreens } from "@/consult/material";
import { emptyAsking, lookupAgain, startLookup } from "@/asking/engine";
import { reviewLines, screenLines } from "./lines";
import type { ScreenReview } from "./types";

describe("a look at the screens, as the next turn reads it", () => {
  const review = (x: Partial<ScreenReview>): ScreenReview => ({ v: 1, id: "r1", at: 1, map: "org", focus: "People leave the basket", shots: [], findings: [], left: [], ...x });
  it("reads each finding as Qalam AI's reading, the worst first, or says it couldn't look or found nothing", () => {
    const lines = reviewLines("v1", review({ findings: [{ key: "k", shot: "h", name: "Basket", side: "customer", title: "The fee shows late", why: "People leave when it appears", change: { does: "replace", what: "Show the fee under the subtotal", insteadOf: "Delivery fee calculated at checkout" } }] }));
    expect(lines).toEqual([{ ref: "v1-f1", text: "On Basket, from the customer's side: The fee shows late. People leave when it appears Change: Show the fee under the subtotal", from: "Qalam AI's look at their screens", whose: "Qalam AI's reading of their screens, not their words" }]);
    expect(reviewLines("v1", review({ unseen: true }))[0].text).toMatch(/can't see pictures/);
    expect(reviewLines("v1", review({}))[0].text).toMatch(/Nothing on these screens bears/);
    expect(reviewLines("v1", null)).toEqual([]);
  });

  it("tells later conversations which screens are kept, a flow in order and the screens in none", () => {
    expect(keptScreens([{ flows: [{ name: "Checkout", steps: ["a", "b"] }], screens: [{ key: "a", name: "Basket" }, { key: "b", name: "Pay" }, { key: "c", name: "Orders" }] }])).toEqual(["Checkout: Basket → Pay", "Screens on their own: Orders"]);
  });

  it("looks again at screens it stopped looking at, and at nothing else", () => {
    let s = startLookup(emptyAsking(), { id: "v1", kind: "screens", query: "the basket", waits: 0, shots: [{ asset: "asset:1", title: "Basket" }] }, 1);
    s = { ...s, lookups: s.lookups.map((l) => ({ ...l, state: "stopped" as const })) };
    expect(lookupAgain(s, "v1", 2).lookups[0]).toMatchObject({ state: "running", waits: "later", shots: [{ asset: "asset:1", title: "Basket" }] });
    const web = startLookup(emptyAsking(), { id: "l1", kind: "web", query: "x", waits: 0 }, 1);
    expect(lookupAgain({ ...web, lookups: web.lookups.map((l) => ({ ...l, state: "stopped" as const })) }, "l1", 2).lookups[0].state).toBe("stopped");
  });
});

const asked = (x: Record<string, unknown>) => ({ id: "see", title: "What does the basket look like today?", why: "", multi: false, options: [], recommended: [], allowOther: false, from: "screens", look_for: "the basket", ...x });
const shot = (n: number, title = `Screen ${n}`) => ({ asset: `asset:${String(n).padStart(24, "0")}`, title });

describe("a question that asks to see a screen", () => {
  it("is kept only where the flow asks to see screens; anywhere else it's an ordinary question", () => {
    expect(toolAsk("screens", "the basket", { screens: true })).toEqual({ kind: "screens", lookFor: "the basket" });
    expect(toolAsk("screens", "the basket")).toBeUndefined();
    const check = { who: "person" as const, asked: [], lookups: [] };
    expect(keepQuestions([asked({})], { ...check, screens: true }).questions[0].tool).toEqual({ kind: "screens", lookFor: "the basket" });
    const plain = keepQuestions([asked({})], check).questions[0];
    expect(plain.title).toBe("What does the basket look like today?");
    expect(plain.tool).toBeUndefined();
  });

  it("is never held back after a run of don't-knows: showing a screen isn't a fact they must know", () => {
    const check = { who: "person" as const, asked: [], lookups: [], screens: true, streak: 5 };
    expect(keepQuestions([asked({})], check).questions).toHaveLength(1);
    expect(keepQuestions([asked({ id: "rate", title: "What's the basket's conversion rate?", from: "numbers", look_for: "basket conversion" })], check).questions).toHaveLength(0);
  });

  it("asks with a drop area and words beside it, whatever choices came with it", () => {
    const q = toQuestion({ id: "see", title: "What does it look like?", why: "", multi: false, options: [{ value: "a", label: "A list", description: "" }, { value: "b", label: "A grid", description: "" }], recommended: [], allowOther: false, tool: { kind: "screens" } });
    expect(q).toMatchObject({ kind: "shots", max: SHOTS_MAX, optional: true, dontKnow: true });
  });
});

describe("screenshots in an answer", () => {
  const q = toQuestion({ id: "see", title: "What does it look like?", why: "", multi: false, options: [], recommended: [], allowOther: false, tool: { kind: "screens" } }) as Extract<Question, { kind: "shots" }>;

  it("adds each once, in order, up to the most an answer takes, and takes one out", () => {
    const empty = answerOf(q, {});
    expect(empty).toEqual({ kind: "shots", shots: [], text: "" });
    let a = addAnswerShots(empty, [shot(1), shot(2), shot(1)]);
    expect(a.shots.map((s) => s.title)).toEqual(["Screen 1", "Screen 2"]);
    a = addAnswerShots(a, [3, 4, 5, 6, 7, 8].map((n) => shot(n)));
    expect(a.shots).toHaveLength(SHOTS_MAX);
    expect(removeShot(a, shot(2).asset).shots.map((s) => s.title)).toEqual(["Screen 1", "Screen 3", "Screen 4", "Screen 5", "Screen 6"]);
  });

  it("keeps what they typed as their words, and the screenshots apart", () => {
    expect(answerWords(q, { kind: "shots", shots: [shot(1)], text: " after they add items " })).toEqual({ text: "after they add items", typed: "after they add items", how: "own", shots: [shot(1)] });
    expect(answerWords(q, { kind: "shots", shots: [shot(1)], text: "" })).toMatchObject({ text: "", typed: "", how: "own" });
    expect(answerWords(q, { kind: "shots", shots: [], text: "" }).how).toBe("left");
    expect(answerWords(q, { kind: "shots", shots: [], text: "No idea" }).how).toBe("unknown");
    expect(summarize(q, { kind: "shots", shots: [shot(1), shot(2)], text: "after they add items" })).toBe("2 screenshots · after they add items");
  });

  it("takes screenshots, words or nothing (it can be left), but not more than it holds", () => {
    expect(validate(q, { kind: "shots", shots: [], text: "" })).toBeNull();
    expect(validate({ ...q, optional: false }, { kind: "shots", shots: [], text: "" })).toBe("Add a screenshot, or say it in words.");
    expect(validate(q, { kind: "shots", shots: [1, 2, 3, 4, 5, 6, 7].map((n) => shot(n)), text: "" })).toBe(`Up to ${SHOTS_MAX} screenshots in one answer.`);
  });

  it("takes words said before as words, never as screenshots", () => {
    expect(knownAnswer(q, { text: "It's the old basket", how: "own" })).toEqual({ kind: "shots", shots: [], text: "It's the old basket" });
    expect(knownAnswer(q, { text: "A list", how: "pick" })).toBeNull();
  });
});

describe("what the next turn reads about them", () => {
  it("says the flow they make, then each screen with what it shows and what's printed on it", () => {
    const lines = screenLines("v1", {
      map: "grocery",
      flow: { key: "the-basket", name: "The basket" },
      shots: [
        { asset: "1", title: "IMG_1", source: "s1", screen: { map: "grocery", key: "basket", name: "Basket" }, about: "The basket with its total", printed: "Your basket\nTotal 24.50", shows: "screen" },
        { asset: "2", title: "IMG_2", source: "s2", screen: { map: "grocery", key: "pay", name: "Pay" }, printed: "", shows: "screen" },
        { asset: "3", title: "Chart", source: "s3", about: "Orders by week", printed: "", shows: "chart" },
        { asset: "4", title: "Old", source: "s4", screen: { map: "grocery", key: "old", name: "Old" }, printed: "", unread: true },
      ],
    });
    expect(lines.map((l) => l.ref)).toEqual(["v1-flow", "v1-1", "v1-2", "v1-3", "v1-4"]);
    expect(lines[0].text).toBe("In the order they showed them, kept as the “The basket” flow: Basket → Pay → Old");
    expect(lines[1]).toMatchObject({ text: "Basket (The basket with its total). Printed on it: Your basket Total 24.50", whose: "their own screen" });
    expect(lines[2].text).toBe("Pay. Nothing printed on it could be read here");
    expect(lines[3]).toMatchObject({ text: "Not a screen of theirs: chart, Orders by week", whose: "a picture they showed" });
    expect(lines[4].text).toBe("Old: nothing on it could be read on this computer");
  });
});

describe("remembering an answer that showed screenshots", () => {
  const me = { id: "u1" };
  it("keeps their words and the screenshots' names, never what's on them", () => {
    const { shared } = linesFor({ flow: "consult", key: "t1", about: { product: null }, answers: [{ qid: "see", q: "What does the basket look like?", a: "", how: "own", shots: ["Basket", "Pay"] }], by: me, at: 5, have: foldAsked([]) });
    expect(shared[0]).toMatchObject({ a: "", how: "own", shots: ["Basket", "Pay"] });
    expect(lineOf(JSON.parse(JSON.stringify(shared[0])))).toMatchObject({ shots: ["Basket", "Pay"] });
  });

  it("asks a screens question again, however lately it was answered: a screen changes", () => {
    const k = { text: "the old one", how: "own" as const, match: "exact" as const, mine: true, at: 1, who: "you", flow: "consult" as const };
    expect(gateOf({ title: "What does the basket look like?", known: [k as never] }, 2)).not.toBeNull();
    expect(gateOf({ title: "What does the basket look like?", known: [k as never], tool: { kind: "screens" } }, 2)).toBeNull();
  });
});
