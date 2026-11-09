import { describe, expect, it } from "vitest";
import { evidenceLabel, isAssumed } from "@/discovery/evidence";
import { laneOf } from "@/discovery/lane";
import type { OstCard } from "@/discovery/types";
import { planMaterial, sanitizePlan, type PlanSeen } from "@/space/plan";
import { screensProposals } from "./proposals";
import type { ScreenReview } from "./types";

const review = (x: Partial<ScreenReview> = {}): ScreenReview => ({
  v: 1,
  id: "rev1",
  at: 1,
  map: "org",
  focus: "People leave the basket",
  shots: [{ asset: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Basket", screen: "basket", source: "src1" }],
  findings: [
    { key: "aaa:fee", shot: "aaaaaaaaaaaaaaaaaaaaaaaa", screen: "basket", name: "Basket", side: "customer", title: "The fee shows up only after Checkout", why: "People leave when it appears", on: { words: "Delivery fee calculated at checkout", box: [0.1, 0.4, 0.6, 0.03] }, change: { does: "replace", what: "Show the fee under the subtotal, in place of the line that puts it off", insteadOf: "Delivery fee calculated at checkout" } },
    { key: "aaa:price", shot: "aaaaaaaaaaaaaaaaaaaaaaaa", screen: "basket", name: "Basket", side: "business", title: "The fee is large next to a small basket", why: "No layout makes it smaller", rests: [{ kind: "answer", text: "x" }] },
  ],
  left: [],
  ...x,
});

let n = 0;
const id = () => `id${++n}`;

describe("a look's findings on the canvas", () => {
  it("makes each finding a problem resting on its screen, and its change a solution under it, under the card it's given", () => {
    const ps = screensProposals(review(), { parentId: "goal1", id, now: 5 });
    expect(ps.map((p) => p.id)).toEqual(["screen:aaa:fee", "change:aaa:fee", "screen:aaa:price"]);
    const [fee, change, price] = ps as Extract<(typeof ps)[number], { kind: "card" }>[];
    expect(fee).toMatchObject({ kind: "card", parentId: "goal1", card: { kind: "opportunity", title: "The fee shows up only after Checkout", came: "seen", createdBy: "ai" } });
    expect(fee.backing.words[0]).toMatchObject({ kind: "screen", sourceId: "src1", text: "Delivery fee calculated at checkout", shot: { asset: "asset:aaaaaaaaaaaaaaaaaaaaaaaa", name: "Basket", box: [0.1, 0.4, 0.6, 0.03], review: "rev1", finding: "aaa:fee" } });
    expect(change).toMatchObject({ parentId: fee.cardId, card: { kind: "solution", solutionType: "change", came: "seen", how: "In place of “Delivery fee calculated at checkout”" } });
    expect(price.card.kind).toBe("opportunity");
  });

  it("leaves out what was decided already", () => {
    expect(screensProposals(review({ decided: { "aaa:fee": "discarded" } }), { parentId: null, id, now: 5 }).map((p) => p.id)).toEqual(["screen:aaa:price"]);
  });

  it("shows a card seen on a screen as Assumed, never as known", () => {
    const [fee] = screensProposals(review(), { parentId: null, id, now: 5 }) as Extract<ReturnType<typeof screensProposals>[number], { kind: "card" }>[];
    const card: OstCard = { ...fee.card, evidence: fee.backing.words };
    expect(isAssumed(card)).toBe(true);
    expect(evidenceLabel(card)).toBe("Assumed · seen on your screens");
  });
});

describe("a screen in the lane", () => {
  it("wires a card's screen in as its source, its tile the picture, named for the screen", () => {
    const card: OstCard = { v: 1, kind: "opportunity", title: "The fee shows late", stage: "idea" as OstCard["stage"], createdBy: "ai", came: "seen", evidence: [{ id: "e1", kind: "screen", text: "Delivery fee calculated at checkout", sourceId: "src1", sourceTitle: "Basket", shot: { asset: "asset:aaaaaaaaaaaaaaaaaaaaaaaa", name: "Basket" }, addedBy: "ai", at: 1 }] } as unknown as OstCard;
    const doc = { roots: ["c1"], nodes: { c1: { id: "c1", type: "frame", name: "c", parentId: null, children: [], x: 0, y: 0, width: 280, height: 120, visible: true, meta: { ost: card } } } } as never;
    const lane = laneOf(doc, [{ id: "src1", title: "Basket", kind: "image", quotes: [], screen: { map: "org", key: "basket" }, image: { asset: "aaaaaaaaaaaaaaaaaaaaaaaa", type: "image/png", shows: "screen", reading: [] } }]);
    expect(lane.items[0]).toMatchObject({ sourceId: "src1", title: "Basket", line: "Your screen", shot: "asset:aaaaaaaaaaaaaaaaaaaaaaaa", cards: ["c1"] });
  });
});

describe("a diagnosis that rests a cause on what was seen on a screen", () => {
  it("names the findings with v ids, keeps a cause citing one, and says it was seen there", () => {
    const seen: PlanSeen[] = [{ review: "rev1", key: "aaa:fee", title: "The fee shows up only after Checkout", why: "People leave when it appears", name: "Basket", shot: "aaaaaaaaaaaaaaaaaaaaaaaa", source: "src1", on: "Delivery fee calculated at checkout" }];
    const m = planMaterial({ org: "Basket", said: "People leave the basket", outline: [], answers: [], looks: [], pieces: [], seen });
    expect(m.text).toContain("- v1 · Basket · The fee shows up only after Checkout. People leave when it appears");
    const draft = sanitizePlan({ cards: [{ ref: "n1", kind: "opportunity", under: "", title: "The fee shows up only after Checkout", description: "", why: "", cites: ["v1"], type: "none", how: "", needed: "no", helps: [], assumptions: [], test: {}, check: {} }], start: "", doubt: "" }, m, { id }, () => {});
    expect(draft.cards[0]).toMatchObject({ came: "seen", seen: [{ key: "aaa:fee" }] });
  });
});
