import { describe, expect, it } from "vitest";
import { ADDRESS, ARABIC, CART } from "./fixtures";
import { boxOf, noteLine, onScreen, personal } from "./words";

describe("words on a screen", () => {
  it("finds a label word for word, as whole words, and keeps the screen's own spelling", () => {
    expect(onScreen("checkout", CART)).toBe("Checkout");
    expect(onScreen("“Apply coupon”", CART)).toBe("Apply coupon");
    expect(onScreen("Pay", { ...CART, lines: [{ text: "Payment", box: [0, 0, 1, 0.1], conf: 1 }] })).toBeNull();
    expect(onScreen("Place order", CART)).toBeNull();
    expect(onScreen("Checkout", undefined)).toBeNull();
  });

  it("forgives how Arabic is spelt either way", () => {
    expect(onScreen("اتمام الطلب", ARABIC)).toBe("إتمام الطلب");
  });

  it("finds a label wrapped over two lines", () => {
    const wrapped = { ...ADDRESS, lines: [{ text: "Continue to", box: [0, 0.8, 1, 0.03] as [number, number, number, number], conf: 1 }, { text: "payment", box: [0, 0.83, 1, 0.03] as [number, number, number, number], conf: 1 }] };
    expect(onScreen("Continue to payment", wrapped)).toBe("Continue to payment");
  });

  it("says where on the screenshot words are: the part of their line", () => {
    const box = boxOf("Change", ADDRESS)!;
    expect(box[1]).toBeCloseTo(0.25);
    expect(box[2]).toBeGreaterThan(0.5);
    expect(boxOf("Nile Street", ADDRESS)![0]).toBeGreaterThan(0.1);
    expect(boxOf("Nowhere", ADDRESS)).toBeNull();
  });

  it("keeps a line of notes only when its quoted words and numbers are on the screen, and no one's contact", () => {
    expect(noteLine("Lists what's in the basket with its total", [CART])).toBe("Lists what's in the basket with its total");
    expect(noteLine("Shows a total of 24.50 and “Apply coupon”", [CART])).toBe("Shows a total of 24.50 and “Apply coupon”");
    expect(noteLine("Shows a total of 31.00", [CART])).toBeNull();
    expect(noteLine("Offers “Free delivery”", [CART])).toBeNull();
    expect(noteLine("Anything with a number 3", [undefined])).toBeNull();
    expect(personal("Signed in as sara@example.com")).toBe(true);
    expect(personal("Call +20 100 123 4567")).toBe(true);
    expect(personal("Arrives today 10:00 - 12:00")).toBe(false);
  });
});
