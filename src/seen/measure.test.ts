import { describe, expect, it } from "vitest";
import { ADDRESS, CART, CART_COUPON, CART_EMPTY, PAY, SLOT, ref } from "./fixtures";
import { hashDistance, nearPairs, platformOf, sharedNav, takenAt, takenOrder, wordOverlap, wordsOn } from "./measure";

describe("what code works out about a batch", () => {
  it("reads when a screenshot was taken from the names phones, Macs and simulators give them", () => {
    expect(takenAt("Screenshot 2026-10-29 at 10.12.33.png").at).toBe(20261029101233);
    expect(takenAt("Screen Shot 2020-05-01 at 1.02.03 PM.png").at).toBe(20200501130203);
    expect(takenAt("Simulator Screenshot - iPhone 17 Pro - 2026-10-29 at 09.00.01.png").at).toBe(20261029090001);
    expect(takenAt("Screenshot_20261029-101233.png").at).toBe(20261029101233);
    expect(takenAt("Screenshot_2026-10-29-10-12-33-123_com.app.jpg").at).toBe(20261029101233);
    expect(takenAt("IMG_1234.PNG").seq).toBe(1234);
    expect(takenAt("checkout.png")).toEqual({});
  });

  it("puts them in the order they were taken, then by when their files changed, then by name", () => {
    const shots = [
      { ref: ref(1), name: "Screenshot 2026-10-29 at 10.12.40.png" },
      { ref: ref(2), name: "Screenshot 2026-10-29 at 10.12.33.png" },
      { ref: ref(3), name: "b.png", modified: 2 },
      { ref: ref(4), name: "a.png", modified: 1 },
      { ref: ref(5), name: "step 10.png" },
      { ref: ref(6), name: "step 9.png" },
    ];
    const order = takenOrder(shots);
    expect(order.indexOf(ref(2))).toBeLessThan(order.indexOf(ref(1)));
    expect(order.indexOf(ref(4))).toBeLessThan(order.indexOf(ref(3)));
    expect(order.indexOf(ref(6))).toBeLessThan(order.indexOf(ref(5)));
  });

  it("finds the pairs that look like one screen in two states, by picture or by words", () => {
    expect(hashDistance(CART.dhash, CART_COUPON.dhash)).toBe(1);
    expect(hashDistance(CART.dhash, undefined)).toBe(64);
    expect(wordOverlap(wordsOn(CART), wordsOn(CART_COUPON))).toBeGreaterThan(0.5);
    const pairs = nearPairs(new Map([[ref(1), CART], [ref(2), CART_COUPON], [ref(3), ADDRESS], [ref(4), CART_EMPTY]]));
    expect(pairs.map((p) => [p.a, p.b])).toEqual([[ref(1), ref(2)]]);
  });

  it("finds the navigation that repeats at the top or bottom", () => {
    expect(sharedNav([CART, CART_COUPON, CART_EMPTY, ADDRESS, SLOT, PAY])).toEqual(["Home", "Search", "Cart", "Account"]);
    expect(sharedNav([CART, ADDRESS])).toEqual([]);
  });

  it("tells a phone's screenshot from a tablet's and a desktop's", () => {
    expect(platformOf(1179, 2556)).toBe("phone");
    expect(platformOf(2048, 2732)).toBe("tablet");
    expect(platformOf(2880, 1800)).toBe("desktop");
  });
});
