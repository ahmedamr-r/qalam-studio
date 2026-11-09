import { describe, expect, it } from "vitest";
import type { ShotLine, ShotRead } from "@/seen/shot";
import { imageFrom, imageText, imageTitle, imageUnreadLine, sanitizeImage, sureLines } from "./image";

const line = (text: string, y: number, conf = 0.95): ShotLine => ({ text, box: [0.05, y, 0.8, 0.03], conf });
const READ: ShotRead = {
  w: 1170,
  h: 2532,
  dhash: "0000000000000000",
  lines: [line("Basket", 0.02), line("Checkout", 0.06), line("Your order couldn't be placed", 0.12), line("Pay 42.50 SAR", 0.2), line("Sara M.", 0.3), line("The delivery was two hours late", 0.33), line("sara@example.com", 0.36), line("blurry", 0.5, 0.3)],
};

describe("a picture, as code keeps it", () => {
  it("keeps only lines it's sure of", () => {
    expect(sureLines(READ)!.lines.map((l) => l.text)).not.toContain("blurry");
    expect(sureLines(null)).toBeNull();
  });

  it("keeps what Qalam AI read where the picture prints its words and numbers, and says why the rest went", () => {
    const read = sureLines(READ);
    const k = sanitizeImage(
      {
        shows: "screen",
        about: "Basket's checkout screen, showing “Your order couldn't be placed” after paying 42.50 SAR.",
        reading: ["The error gives no reason or next step.", "It says “Payment declined”.", "It costs 99 SAR."],
        product: "basket",
        said: [{ who: "Sara M.", words: "the delivery was two hours late" }, { who: "Omar", words: "I love it" }, { who: "", words: "sara@example.com" }],
      },
      read,
    );
    expect(k.shows).toBe("screen");
    expect(k.about).toMatch(/^Basket's checkout screen/);
    expect(k.reading).toEqual(["The error gives no reason or next step."]);
    // Kept as the picture prints it.
    expect(k.product).toBe("Basket");
    expect(k.said).toEqual([{ who: "Sara M.", words: "The delivery was two hours late" }]);
    expect(k.left.map((l) => l.said)).toEqual(expect.arrayContaining(["It says “Payment declined”.", "It costs 99 SAR.", "I love it", "sara@example.com"]));
  });

  it("off a Mac claims nothing as printed, and still describes it", () => {
    const k = sanitizeImage({ shows: "photo", about: "A grocery bag on a doorstep.", reading: ["It reads “Thanks”."], product: "Basket", said: [{ who: "x", words: "y" }] }, null);
    expect(k.about).toBe("A grocery bag on a doorstep.");
    expect(k.reading).toEqual(["It reads Thanks."]);
    expect(k.product).toBeUndefined();
    expect(k.said).toEqual([]);
    expect(k.left).toHaveLength(2);
  });

  it("takes an unknown kind as other, and an answer that isn't one as nothing", () => {
    expect(sanitizeImage({ shows: "selfie" }, null)).toEqual({ shows: "other", reading: [], said: [], left: [] });
    expect(sanitizeImage(null, null).shows).toBe("other");
  });

  it("writes who said what first, then the printed lines no one's words cover", () => {
    const read = sureLines(READ)!;
    const text = imageText(read, { said: [{ who: "Sara M.", words: "The delivery was two hours late" }] });
    expect(text.startsWith("Sara M.: The delivery was two hours late")).toBe(true);
    expect(text).toContain("Your order couldn't be placed");
    expect(text.split("The delivery was two hours late")).toHaveLength(2);
    expect(text).not.toMatch(/^Sara M\.$/m);
    expect(imageText(null, { said: [] })).toBe("");
  });

  it("keeps a screen's title only as it's printed on the screen", () => {
    const read = sureLines(READ);
    expect(sanitizeImage({ shows: "screen", screen: "checkout" }, read).screen).toBe("Checkout");
    const made = sanitizeImage({ shows: "screen", screen: "Payment details" }, read);
    expect(made.screen).toBeUndefined();
    expect(made.left).toEqual([{ said: "Payment details", why: "That title isn't printed on the screen" }]);
    // Only a screen has one, and off a Mac nothing is claimed as printed.
    expect(sanitizeImage({ shows: "chart", screen: "Checkout" }, read).screen).toBeUndefined();
    expect(sanitizeImage({ shows: "screen", screen: "Checkout" }, null).screen).toBeUndefined();
  });

  it("names a camera's or screenshot tool's file by what it shows", () => {
    expect(imageTitle("Checkout error.png", { shows: "screen" })).toBe("Checkout error");
    expect(imageTitle("Screenshot 2026-11-09 at 10.12.33.png", { shows: "screen", screen: "Your basket", about: "The basket screen with three items." })).toBe("Your basket");
    expect(imageTitle("IMG_2041.HEIC", { shows: "screen", about: "Basket's checkout screen with a payment error. It gives no reason." })).toBe("Basket's checkout screen with a payment error");
    expect(imageTitle("Screenshot 2026-11-06 at 10.03.12.png", { shows: "screen", product: "Basket" })).toBe("Basket picture");
    expect(imageTitle("image.png", { shows: "other" })).toBe("Picture");
  });

  it("checks a picture's record as it comes from a window", () => {
    expect(imageFrom({ asset: "0123456789abcdef01234567", type: "image/png", shows: "chat", reading: ["a", 3], unread: ["no-reader", "x"], left: [{ said: "s", why: "w" }, { said: "" }] })).toEqual({
      asset: "0123456789abcdef01234567",
      type: "image/png",
      shows: "chat",
      reading: ["a"],
      unread: ["no-reader"],
      left: [{ said: "s", why: "w" }],
    });
    expect(imageFrom({ asset: "../x", type: "image/png" })).toBeNull();
    expect(imageFrom({ asset: "0123456789abcdef01234567", type: "image/svg+xml" })).toBeNull();
  });

  it("says what couldn't be read", () => {
    expect(imageUnreadLine({ unread: ["no-reader"] }, false)).toMatch(/nothing in it can back a card/);
    expect(imageUnreadLine({ unread: ["no-vision"] }, true)).toMatch(/can't look at pictures/);
    expect(imageUnreadLine({}, false)).toMatch(/Nothing printed/);
    expect(imageUnreadLine({}, true)).toBeNull();
  });
});
