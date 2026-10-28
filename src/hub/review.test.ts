import { describe, expect, it } from "vitest";
import type { Decision } from "@/decisions/model";
import type { Doc } from "@/doc/schema";
import type { CheckBoard } from "./checks";
import { reviewMaterial, sanitizeReview } from "./review";
import type { Topic } from "./topics";

const AT = new Date(2026, 9, 20).getTime();

const board: CheckBoard = {
  id: "delivery",
  name: "Delivery experience",
  product: "grocery",
  createdAt: AT,
  doc: {
    roots: ["o2"],
    nodes: {
      o2: { id: "o2", type: "frame", name: "", parentId: null, children: ["n4"], x: 0, y: 0, w: 1, h: 1, meta: { ost: { v: 1, kind: "outcome", title: "Deliveries arrive when promised", stage: "active", createdBy: "user", evidence: [], metric: { name: "On-time deliveries", unit: "%", direction: "increase", baseline: 71, current: 71, target: 90 } } } },
      n4: { id: "n4", type: "frame", name: "", parentId: "o2", children: [], x: 0, y: 0, w: 1, h: 1, meta: { ost: { v: 1, kind: "opportunity", title: "Evening slots are full when I need them", stage: "target", createdBy: "user", evidence: [{ id: "e1", kind: "quote", text: "By then every evening slot for tomorrow is gone.", addedBy: "ai", at: AT }] } } },
    },
  } as unknown as Doc,
};

const topic: Topic = {
  id: "tp9",
  kind: "need",
  title: "My delivery shows up later than the slot I booked",
  products: ["grocery"],
  createdAt: AT,
  updatedAt: AT,
  lines: [{ id: "l1", section: "know", text: "Late or missed delivery leads support tickets, mostly evening slots that slipped past 10pm.", by: "qalam", cites: ["hub:quote:tix-1"], from: ["Support tickets"], at: AT }],
  history: [],
};

const decision: Decision = { id: "d3", at: AT, kind: "target", board: "delivery", boardName: "Delivery experience", card: "n4", cardTitle: "Evening slots are full when I need them", what: "Made “Evening slots are full when I need them” the target", why: "131 late-delivery tickets are mostly evening slots", by: "you", big: true };

describe("a review by Qalam AI", () => {
  const m = reviewMaterial({ org: "Basket delivers groceries.", topics: [topic], boards: [board], decisions: [decision], flagged: ["“Deliveries arrive when promised” hasn't moved"], productName: (id) => (id === "grocery" ? "Grocery app" : undefined) });

  it("reads the pages, the boards and the decisions under ids", () => {
    expect(m.text).toContain("## t1 · need · My delivery shows up later than the slot I booked (Grocery app)");
    expect(m.text).toContain("- l1 · We know: Late or missed delivery leads support tickets");
    expect(m.text).toContain("- c1 · outcome · active · Deliveries arrive when promised");
    expect(m.text).toContain("  - c2 · opportunity · target · Evening slots are full when I need them · 1 quote");
    expect(m.text).toContain("- d1 · 2026-10-20 · Made “Evening slots are full when I need them” the target · Why: 131 late-delivery tickets are mostly evening slots");
    expect(m.text).toContain("Already flagged by code's checks (don't repeat these):");
    expect(m.ids).toEqual(["l1", "c1", "c2", "d1"]);
    expect(m.about).toEqual(["t1", "c1", "c2"]);
  });

  it("keeps findings resting on what was sent, their words found in it", () => {
    const found = sanitizeReview(
      {
        findings: [
          { title: "The target rests on slots selling out, but tickets say lateness", why: "The target's reason was “131 late-delivery tickets are mostly evening slots”, and the page says they “slipped past 10pm”.", cites: ["d1", "l1", "c2"], about: "c2" },
          { title: "Invented", why: "Customers said “we hate it”.", cites: ["l1"], about: "none" },
          { title: "No pieces", why: "Something.", cites: ["k7"], about: "t1" },
          { title: "A number out of nowhere", why: "Half of 300 tickets are late.", cites: ["l1"], about: "t1" },
          { title: "About the page", why: "Lateness has no card on the board.", cites: ["l1"], about: "t1" },
        ],
      },
      m,
      AT,
    );
    expect(found).toEqual([
      {
        key: expect.stringMatching(/^review:/),
        kind: "review",
        title: "The target rests on slots selling out, but tickets say lateness",
        why: "The target's reason was “131 late-delivery tickets are mostly evening slots”, and the page says they “slipped past 10pm”.",
        at: AT,
        board: "delivery",
        card: "n4",
        refs: ["hub:decision:d3", "hub:topic:tp9:l1", "hub:card:delivery:n4"],
        products: ["grocery"],
      },
      { key: expect.stringMatching(/^review:/), kind: "review", title: "About the page", why: "Lateness has no card on the board.", at: AT, topic: "tp9", refs: ["hub:topic:tp9:l1"], products: ["grocery"] },
    ]);
    // The same finding again keeps its key (a dismissed one stays dismissed).
    expect(sanitizeReview({ findings: [{ title: "About the page.", why: "Again.", cites: ["l1"], about: "t1" }] }, m, AT + 1)[0].key).toBe(found[1].key);
  });
});
