import { describe, expect, it } from "vitest";
import type { SeenText } from "@/seen/types";
import { fit, reviewMaterial, sanitizeScreenReview, type ReviewScreen } from "./review";
import type { FindingRest } from "./types";

/* Four kinds of product, as this Mac would read their screens: the checks hold on each. */

const line = (text: string, y: number) => ({ text, box: [0.1, y, 0.8, 0.03] as [number, number, number, number], conf: 0.95 });
const screen = (lines: string[]): SeenText => ({ w: 780, h: 1688, dhash: "0000000000000000", lines: lines.map((t, i) => line(t, 0.05 + i * 0.08)) });

const BASKET = screen(["Your basket", "Subtotal 26.50", "Delivery fee calculated at checkout", "Have a promo code?", "Checkout"]);
const TRANSFER = screen(["Send money", "Amount", "Fee 2.00", "Exchange rate shown on the next step", "Continue"]);
const SIGNUP = screen(["Create your account", "Work email", "Password", "Company size", "Phone number", "Start free trial"]);
const BOOKING = screen(["احجز موعدك", "اختر الطبيب", "الرسوم تُدفع في العيادة", "تأكيد الحجز"]);

const s = (id: string, read: SeenText | null, name = id): ReviewScreen => ({ id, shot: `hash-${id}`, name, screen: `screen-${id}`, read });
const sent = new Map<string, FindingRest>([
  ["b1", { kind: "business", text: "How it earns: a cut from the shops and the delivery fee" }],
  ["g1", { kind: "goal", text: "More orders from people who reach the basket" }],
  ["a1", { kind: "answer", text: "What's going wrong? → “People add items but leave before they pay”" }],
]);
const ctx = (screens: ReviewScreen[], also = "People add items but leave before they pay") => ({ screens, sent, also });
const f = (x: Record<string, unknown>) => ({ screen: "s1", side: "customer", title: "A finding", why: "It bears on people leaving", on: "", cites: [], change: { does: "none", what: "", instead_of: "" }, ...x });

describe("what code keeps of a look at the screens", () => {
  it("on a delivery basket: a mark where the words are printed, a swap kept, an add with nothing taken away dropped", () => {
    const kept = sanitizeScreenReview(
      {
        findings: [
          f({ title: "The delivery fee shows up only after Checkout", why: "“Delivery fee calculated at checkout” hides the fee until people have decided", on: "Delivery fee calculated at checkout", change: { does: "replace", what: "Show the delivery fee under the subtotal", instead_of: "Delivery fee calculated at checkout" } }),
          f({ title: "The promo code link sends people off to look for codes", why: "Some leave to hunt for a code and don't come back", on: "Have a promo code?", change: { does: "remove", what: "Take the promo code link off the basket", instead_of: "Have a promo code?" } }),
          f({ title: "People can't tell the payment is safe", why: "Doubt at the last step makes people leave", change: { does: "add", what: "Add a badge saying payments are safe", instead_of: "" } }),
          f({ title: "Reword the promo link", why: "It pulls people away", change: { does: "reword", what: "Call it a voucher", instead_of: "Have a promo code?" } }),
        ],
        none: false,
      },
      ctx([s("s1", BASKET, "Basket")]),
    );
    expect(kept.findings.map((x) => x.title)).toEqual(["The delivery fee shows up only after Checkout", "The promo code link sends people off to look for codes", "People can't tell the payment is safe", "Reword the promo link"]);
    const [fee, promo, badge, again] = kept.findings;
    expect(fee.on).toEqual({ words: "Delivery fee calculated at checkout", box: expect.any(Array) });
    expect(fee.change).toEqual({ does: "replace", what: "Show the delivery fee under the subtotal", insteadOf: "Delivery fee calculated at checkout" });
    expect(promo.change).toMatchObject({ does: "remove", insteadOf: "Have a promo code?" });
    // Swap, don't add: a badge with nothing taken away isn't kept as a change; the finding stays.
    expect(badge.change).toBeUndefined();
    // What one change takes away, a lower one can't take away again.
    expect(again.change).toBeUndefined();
    expect(kept.left.map((l) => l.why)).toEqual(["It adds to the screen without taking anything away", "A change above it already changes that"]);
    expect(fee).toMatchObject({ shot: "hash-s1", screen: "screen-s1", name: "Basket", side: "customer" });
  });

  it("on a bank transfer: a finding whose words it points at aren't printed keeps no mark; quoted words that aren't printed or said drop it", () => {
    const kept = sanitizeScreenReview(
      {
        findings: [
          f({ title: "The exchange rate comes a step too late", why: "People can't see what arrives before they go on", on: "Rate locked for 30 minutes" }),
          f({ title: "The fee reads “Fee 5.00”", why: "A fee that high puts people off" }),
          f({ title: "The amount shows no total with the fee", why: "“Fee 2.00” sits apart from the amount" }),
        ],
        none: false,
      },
      ctx([s("s1", TRANSFER)]),
    );
    expect(kept.findings.map((x) => x.title)).toEqual(["The exchange rate comes a step too late", "The amount shows no total with the fee"]);
    expect(kept.findings[0].on).toBeUndefined();
    expect(kept.left).toEqual([{ what: "The fee reads “Fee 5.00”", why: "Its quoted words or numbers aren't printed on the screens or in what they said" }]);
  });

  it("on a SaaS sign-up: the business's side only resting on how the business works, a goal or what they said", () => {
    const kept = sanitizeScreenReview(
      {
        findings: [
          f({ side: "business", title: "Asking for a phone number costs sign-ups", why: "Every extra field loses people before the trial", on: "Phone number", cites: ["g1"], change: { does: "remove", what: "Drop the phone number field", instead_of: "Phone number" } }),
          f({ side: "business", title: "Company size isn't used for anything", why: "It slows people down", cites: [] }),
          f({ side: "business", title: "The trial button undersells it", why: "It's the one action that matters", cites: ["b9"] }),
        ],
        none: false,
      },
      ctx([s("s1", SIGNUP)]),
    );
    expect(kept.findings).toHaveLength(1);
    expect(kept.findings[0].rests).toEqual([{ kind: "goal", text: "More orders from people who reach the basket" }]);
    expect(kept.left.map((l) => l.why)).toEqual(["A finding from the business's side has to rest on how their business works, a goal or what they said", "A finding from the business's side has to rest on how their business works, a goal or what they said"]);
  });

  it("on a clinic's booking in Arabic: marks and swaps in Arabic as printed", () => {
    const kept = sanitizeScreenReview(
      {
        findings: [
          f({ title: "الرسوم لا تظهر قبل الحجز", why: "المريض لا يعرف كم سيدفع قبل أن يحجز", on: "الرسوم تُدفع في العيادة", change: { does: "reword", what: "اذكر قيمة الرسوم بجانب زر الحجز", instead_of: "الرسوم تُدفع في العيادة" } }),
        ],
        none: false,
      },
      ctx([s("s1", BOOKING)], "الناس يبدأون الحجز ولا يكملونه"),
    );
    expect(kept.findings).toHaveLength(1);
    expect(kept.findings[0].on?.words).toBe("الرسوم تُدفع في العيادة");
    expect(kept.findings[0].change).toMatchObject({ does: "reword", insteadOf: "الرسوم تُدفع في العيادة" });
  });

  it("off a Mac: nothing printed can be checked, so no marks, quote marks off, and a swap only as they named it", () => {
    const kept = sanitizeScreenReview(
      {
        findings: [f({ title: "The fee shows “late”", why: "People see it after deciding", on: "Delivery fee", change: { does: "add", what: "Add the fee under the subtotal", instead_of: "the line about the fee later" } }), f({ title: "Too many steps", why: "Three screens to pay", change: { does: "remove", what: "Drop the extra step", instead_of: "" } })],
        none: false,
      },
      ctx([s("s1", null)]),
    );
    expect(kept.findings[0]).toMatchObject({ title: "The fee shows late", change: { does: "add", insteadOf: "the line about the fee later" } });
    expect(kept.findings[0].on).toBeUndefined();
    expect(kept.findings[1].change).toBeUndefined();
    expect(kept.left.at(-1)?.why).toBe("It doesn't say what on the screen it changes");
  });

  it("keeps wording a change proposes as proposed, its numbers held to what's printed, and takes the call's ids out", () => {
    const kept = sanitizeScreenReview(
      {
        findings: [
          f({ title: "“Checkout” reads as the last step (s1)", why: "People expect to be done on s1", on: "Checkout", change: { does: "reword", what: "Call it “Review your order”", instead_of: "Checkout" } }),
          f({ title: "The subtotal hides the fee", why: "People decide on “Subtotal 26.50”", on: "Subtotal 26.50", change: { does: "replace", what: "Show ‘Total with delivery 41.50’ under it", instead_of: "Subtotal 26.50" } }),
        ],
        none: false,
      },
      ctx([s("s1", BASKET, "Basket")]),
    );
    expect(kept.findings[0]).toMatchObject({ title: "“Checkout” reads as the last step", why: "People expect to be done on Basket", change: { what: "Call it ‘Review your order’" } });
    // A figure nobody printed or said is never proposed: the change goes, the finding stays.
    expect(kept.findings[1].change).toBeUndefined();
  });

  it("keeps a long change whole when its figures are printed on another screen, and cuts one too long without leaving a quote open", () => {
    const CHECKOUT = screen(["Checkout", "Delivery fee 15.00", "Service fee 3.00", "Total 44.50", "Place order"]);
    const what = "Replace “Delivery fee calculated at checkout” with the real rows shown later: ‘Delivery fee 15.00’ and ‘Service fee 3.00’, plus a ‘Total 44.50’ line.";
    const kept = sanitizeScreenReview({ findings: [f({ title: "The fee shows up only after Checkout", why: "People leave when it appears", on: "Delivery fee calculated at checkout", change: { does: "replace", what, instead_of: "Delivery fee calculated at checkout" } })], none: false }, ctx([s("s1", BASKET), s("s2", CHECKOUT)]));
    expect(kept.findings[0].change?.what).toBe(what);
    expect(fit("Show ‘Delivery fee 15.00’ under the subtotal and ‘Total 44.50’ beside the button", 60)).toBe("Show ‘Delivery fee 15.00’ under the subtotal and…");
  });

  it("says nothing bears on it only when it found nothing, and keeps to the screens it was shown, within its guards", () => {
    expect(sanitizeScreenReview({ findings: [], none: true }, ctx([s("s1", BASKET)])).none).toBe(true);
    // Titles with no figures in them: a number that isn't printed would drop the finding.
    const many = Array.from({ length: 14 }, (_, i) => f({ title: `Finding ${String.fromCharCode(65 + i)}`, why: "It bears on it" }));
    const kept = sanitizeScreenReview({ findings: [f({ screen: "s9", title: "Elsewhere" }), ...many], none: true }, ctx([s("s1", BASKET)]));
    expect(kept.none).toBe(false);
    expect(kept.findings).toHaveLength(12);
    expect(kept.left[0]).toEqual({ what: "Elsewhere", why: "It names a screen it wasn't shown" });
    expect(kept.left.filter((l) => l.why === "Past the most one look keeps")).toHaveLength(2);
  });

  it("weighs both sides: the business side known only resting on what was sent, apart only where it's known", () => {
    const GROCERY = screen(["Bakeries & Pastries", "Sold out", "Sold out", "5 Mini Shami Bread", "Add"]);
    const weighs = (weigh: Record<string, unknown>, cites: string[] = []) =>
      sanitizeScreenReview({ findings: [f({ title: "Sold-out bread fills the first rows", why: "People find little they can add", on: "Sold out", cites, weigh, change: { does: "move", what: "Move “Sold out” products to the end", instead_of: "Sold out" } })], none: false }, ctx([s("s1", GROCERY, "Bakeries")])).findings[0];

    // Nothing sent says why sold-out items come first: whatever it claims, the business side isn't known.
    const guessed = weighs({ customers: "They scroll past what they can't buy", business: "Whether sold-out items lead on purpose, to show the range, isn't known", known: true, apart: true });
    expect(guessed.weigh).toEqual({ customers: "They scroll past what they can't buy", business: "Whether sold-out items lead on purpose, to show the range, isn't known", known: false });

    // Resting on what they said, it's known, and the two may pull apart.
    const told = weighs({ customers: "They scroll past what they can't buy", business: "The team keeps sold-out items in view to show the range", known: true, apart: true }, ["a1"]);
    expect(told.weigh).toEqual({ customers: "They scroll past what they can't buy", business: "The team keeps sold-out items in view to show the range", known: true, apart: true });
    expect(told.rests).toEqual([sent.get("a1")]);

    // Shown as not known yet, it doesn't say so twice.
    expect(weighs({ customers: "They scroll past what they can't buy", business: "This would need to be true: the range is shown on purpose.", known: false }).weigh?.business).toBe("The range is shown on purpose.");

    // Its words are held as a finding's: a number that isn't printed or said loses the weighing, not the finding.
    const loose = weighs({ customers: "Five of six rows are sold out", business: "Sold-out rows cost “12%” of orders", known: false, apart: false });
    expect(loose.weigh).toBeUndefined();
    expect(loose.title).toBe("Sold-out bread fills the first rows");
  });
});

describe("what the look is sent", () => {
  it("leads with what they're working out, names what a finding may rest on, then each screen with its printed words", () => {
    const m = reviewMaterial({
      screens: [s("s1", BASKET, "Basket"), s("s2", null, "Pay")],
      focus: { said: "People leave the basket", asked: "What does the basket look like?", typed: "After they add items", settled: ["The fee shows at checkout"] },
      flow: "The basket",
      business: ["How it earns: a cut from the shops"],
      goals: ["More orders"],
      answers: [{ q: "Since when?", a: "March" }],
    });
    expect(m.intro.startsWith("What they're working out (only what bears on this counts):\n“People leave the basket”")).toBe(true);
    expect(m.intro).toContain("- b1 · How it earns: a cut from the shops");
    expect(m.intro).toContain("- g1 · More orders");
    expect(m.intro).toContain("- a1 · Since when? → “March”");
    expect([...m.sent.keys()]).toEqual(["b1", "g1", "a1"]);
    expect(m.screens[0]).toMatchObject({ id: "s1", head: "s1 · “Basket”, screen 1 of 2:" });
    expect(m.screens[0].words).toContain("Delivery fee calculated at checkout");
    expect(m.screens[1].words).toBe("What's printed on s2 couldn't be read here: describe what you see, and quote nothing from it.");
    expect(m.also).toContain("March");
  });

  it("says whether it's a first look, and names what they said before as what a business side may rest on", () => {
    const input = { screens: [s("s1", BASKET, "Basket")], focus: { said: "People leave the basket", settled: [] }, business: [], goals: [], answers: [] };
    const block = "What's already known (m1…):\n\nAsked before, in other conversations (id · where, when · the question → the answer):\n- m1 · Working it out with you, 2 Nov · Why do sold-out items show first? → “The brand team wants the whole range seen”";
    const first = reviewMaterial({ ...input, first: true, remembered: { block, hay: "The brand team wants the whole range seen" }, company: "Basket delivers groceries in Cairo." });
    expect(first.intro).toContain("This is a first look");
    expect(first.intro).toContain("- m1 · Working it out with you, 2 Nov");
    expect(first.sent.get("m1")).toEqual({ kind: "answer", text: "Working it out with you, 2 Nov · Why do sold-out items show first? → “The brand team wants the whole range seen”" });
    expect(first.intro).toContain("What's known of the company (background, read on the web or told; nothing a finding rests on):\nBasket delivers groceries in Cairo.");
    // The company is background: nothing a finding may quote from.
    expect(first.also).toContain("The brand team wants the whole range seen");
    expect(first.also).not.toContain("Cairo");
    expect(reviewMaterial({ ...input, first: false }).intro).toContain("They've been asked what these screens are for");
  });
});
