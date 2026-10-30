import { describe, expect, it } from "vitest";
import { ADDRESS, CART, ref } from "./fixtures";
import { readMaterial, sanitizeRead } from "./read";

const shots = [
  { ref: ref(1), name: "Screenshot 2026-10-29 at 10.12.33.png" },
  { ref: ref(2), name: "address.png", modified: Date.UTC(2026, 9, 29, 10, 13) },
  { ref: ref(3), name: "unread.png" },
];
const sent = readMaterial(shots, new Map([[ref(1), CART], [ref(2), ADDRESS]]));

describe("reading a batch", () => {
  it("sends each screenshot with its id, when it was taken, its size and the words this Mac read", () => {
    expect(sent.blocks[0].head).toBe("Screen s1 · Screenshot 2026-10-29 at 10.12.33.png · taken 2026-10-29 10:12:33 · 1179×2556 (phone):");
    expect(sent.blocks[0].words).toContain("(bottom) Home");
    expect(sent.blocks[1].head).toContain("taken 2026-10-29 10:13:00");
    expect(sent.blocks[2].words).toBe("This Mac didn't read the words on s3.");
  });

  it("keeps a note's labels only as the screen shows them, its lines only where their words and numbers are on it", () => {
    const why: [string, unknown][] = [];
    const notes = sanitizeRead(
      {
        screens: [
          {
            id: "s1",
            name: "Cart",
            kind: "list",
            does: "Lists the basket with its total of 24.50",
            on: "Two items and a “Free delivery” banner",
            can: [{ label: "checkout", does: "goes on to the address" }, { label: "Place order" }],
            nav: ["Home", "Cart", "Orders"],
            design: "Rows of items, a fixed bar at the bottom",
            state: "Filled, before a coupon",
          },
          { id: "s1", name: "Cart again" },
          { id: "s9", name: "Not sent" },
          { id: "s2", name: "Address 99", kind: "form" },
          { id: "s3", name: "Unread", kind: "wizard", does: "Asks for 3 things", can: [{ label: "Next" }] },
        ],
      },
      sent,
      (w, x) => why.push([w, x]),
    );
    expect(notes.get(ref(1))).toEqual({
      name: "Cart",
      kind: "list",
      does: "Lists the basket with its total of 24.50",
      can: [{ label: "Checkout", does: "goes on to the address" }],
      nav: ["Home", "Cart"],
      state: "Filled, before a coupon",
      design: "Rows of items, a fixed bar at the bottom",
    });
    // Without its words read, nothing on a screen can be checked: no labels, no numbers.
    expect(notes.get(ref(3))).toEqual({ name: "Unread", kind: "other", can: [], nav: [] });
    expect(notes.has(ref(2))).toBe(false);
    expect(why.map(([w]) => w)).toEqual([
      "a control whose label isn't on the screen",
      "navigation not on the screen",
      "its on holds a word or number not on the screen, or someone's contact",
      "read twice",
      "a screenshot not sent",
      "its name holds a word or number not on the screen",
      "a control on a screen whose words weren't read",
      "its does holds a word or number not on the screen, or someone's contact",
      "not read",
    ]);
  });
});
