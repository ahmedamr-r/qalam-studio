import { describe, expect, it } from "vitest";
import type { SourceQuote } from "./sources";
import { rankQuotes, wordOverlap } from "./near";

const q = (id: string, text: string, dismissed?: string[]): SourceQuote => ({ id, text, span: [0, text.length], kind: "pain", addedBy: "ai", at: 0, ...(dismissed ? { dismissed } : {}) });
const QUOTES = [q("cash", "The driver never has change for 200"), q("gate", "The driver went to gate 1, I was at gate 13"), q("pin", "The pin jumps around inside the compound gate"), q("air", "Airport pickups are chaos", ["c1"])];

describe("quotes nearest a card", () => {
  it("counts the words two texts share, past the small ones", () => {
    expect(wordOverlap("Riders can't find the gate at the compound", "The pin jumps around inside the compound gate")).toBe(2);
  });

  it("puts what shares the card's words first, then its parent's, dismissed ones last, and leaves out what's on it", () => {
    const card = { id: "c1", title: "Riders miss the driver at the compound gate" };
    expect(rankQuotes(QUOTES, card, "Cut cancellations at pickup", new Set()).map((x) => x.id)).toEqual(["gate", "pin", "cash", "air"]);
    expect(rankQuotes(QUOTES, card, "", new Set(["pin"])).map((x) => x.id)).toEqual(["gate", "cash", "air"]);
    // What it's under counts too: cash shares nothing with the card, but its parent is about change.
    expect(rankQuotes(QUOTES, { id: "c2", title: "Paying" }, "Nobody has change", new Set()).map((x) => x.id)[0]).toBe("cash");
  });
});
