import { describe, expect, it } from "vitest";
import { emptyDoc } from "@/doc/schema";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import { GAPS } from "@/discovery/layout";
import { emptyMarket } from "@/market/types";
import { emptyContext } from "@/org/context-md";
import { layoutSpace } from "@/space/layout";
import { PLACE_CARD, placeCardOf } from "./card";
import { editBusiness } from "./edit";
import { emptyBusiness } from "./types";

let n = 0;
const o = { now: 1, id: () => `b${++n}` };

describe("the Business card", () => {
  it("says how it earns, who it serves and its numbers, from the business page first", () => {
    let b = editBusiness(emptyBusiness(), { op: "add", section: "earns", text: "A delivery fee and a cut from each shop" }, o);
    b = editBusiness(b, { op: "add", section: "numbers", text: "About 300 orders a day" }, o);
    b = editBusiness(b, { op: "add", section: "numbers", text: "A basket of about 180 pounds" }, o);
    b = editBusiness(b, { op: "add", section: "numbers", text: "A third number" }, o);
    const card = placeCardOf({ business: b, about: { ...emptyContext(), audience: "Families in Cairo" }, market: emptyMarket(), org: "Sallety" });
    expect(card).toEqual({
      title: "How Sallety works",
      rows: [
        { label: "Earns", text: "A delivery fee and a cut from each shop" },
        { label: "Serves", text: "Families in Cairo" },
        { label: "Numbers", text: "About 300 orders a day · A basket of about 180 pounds" },
      ],
      empty: false,
    });
  });

  it("falls back on what was read on the web, and is empty with nothing known", () => {
    const market = { ...emptyMarket(), company: [{ id: "m1", text: "It takes a commission on each order", field: "model" as const, by: "qalam" as const, at: 1 }] };
    expect(placeCardOf({ business: emptyBusiness(), about: emptyContext(), market, org: "X" }).rows[0].text).toBe("It takes a commission on each order");
    expect(placeCardOf({ business: emptyBusiness(), about: emptyContext(), market: emptyMarket(), org: "X" }).empty).toBe(true);
  });

  it("gets a slot centred over the trees, above them, and none on a canvas with no trees", () => {
    const doc = emptyDoc();
    const a = makeCardNode(newCard("outcome", { title: "Revenue from orders" }));
    const b = makeCardNode(newCard("outcome", { title: "More repeat customers" }));
    addCardIn(doc, a, null);
    addCardIn(doc, b, null);
    const { doc: laid, slots } = layoutSpace(doc, { place: PLACE_CARD });
    const slot = slots.get("place")!;
    expect(slot).toMatchObject({ w: PLACE_CARD.w, h: PLACE_CARD.h, y: -(PLACE_CARD.h + GAPS.tb.levelGap) });
    const left = laid.nodes[a.id].x;
    const right = laid.nodes[b.id].x + laid.nodes[b.id].w;
    expect(Math.abs(slot.x + slot.w / 2 - (left + right) / 2)).toBeLessThanOrEqual(1);
    expect(layoutSpace(emptyDoc(), { place: PLACE_CARD }).slots.has("place")).toBe(false);
    expect(layoutSpace(doc).slots.has("place")).toBe(false);
  });
});
