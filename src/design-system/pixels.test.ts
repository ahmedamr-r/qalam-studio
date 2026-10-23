import { describe, expect, it } from "vitest";
import { captureScale, measureElement, toLogical } from "./pixels";

/** A w×h canvas (ImageData isn't available in Node) with rounded rectangles drawn on it. */
function canvas(w: number, h: number, bg = "#FFFFFF") {
  const data = new Uint8ClampedArray(w * h * 4);
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const put = (x: number, y: number, hex: string) => data.set([...rgb(hex), 255], (y * w + x) * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, bg);
  const img = { width: w, height: h, data, colorSpace: "srgb" } as ImageData;
  return {
    img,
    /** A filled rounded rectangle (pixel centres inside the shape). */
    rect(x0: number, y0: number, rw: number, rh: number, r: number, hex: string) {
      for (let y = y0; y < y0 + rh; y++)
        for (let x = x0; x < x0 + rw; x++) {
          const cx = Math.min(Math.max(x + 0.5, x0 + r), x0 + rw - r);
          const cy = Math.min(Math.max(y + 0.5, y0 + r), y0 + rh - r);
          if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) put(x, y, hex);
        }
    },
    text(x0: number, y0: number, tw: number, th: number, hex: string) {
      for (let y = y0; y < y0 + th; y += 2) for (let x = x0; x < x0 + tw; x++) put(x, y, hex);
    },
  };
}

describe("capture scale", () => {
  it("reads iPhone captures as 3x and 2x", () => {
    expect(captureScale(1170, 2532)).toMatchObject({ scale: 3, logicalWidth: 390, confident: true, kind: "phone" });
    expect(captureScale(1179, 2556)).toMatchObject({ scale: 3, logicalWidth: 393, confident: true });
    expect(captureScale(1290, 2796)).toMatchObject({ scale: 3, logicalWidth: 430, confident: true });
    expect(captureScale(750, 1334)).toMatchObject({ scale: 2, logicalWidth: 375, confident: true });
  });

  it("flags Android widths that fit two densities", () => {
    const c = captureScale(1080, 2400);
    expect(c.confident).toBe(false);
    expect([c.scale, c.alternative].sort()).toEqual([2.625, 3]);
  });

  it("reads Retina desktop captures as 2x, not 1x", () => {
    expect(captureScale(2880, 1800)).toMatchObject({ scale: 2, logicalWidth: 1440, confident: true, kind: "desktop" });
    expect(captureScale(1440, 900)).toMatchObject({ scale: 1, confident: true });
    expect(captureScale(2560, 1600)).toMatchObject({ scale: 2, logicalWidth: 1280, confident: false, alternative: 1 });
  });

  it("treats small or odd captures as 1x without claiming confidence", () => {
    expect(captureScale(390, 844)).toMatchObject({ scale: 1, confident: true });
    expect(captureScale(1654, 980)).toMatchObject({ scale: 1, confident: false });
  });

  it("converts sent pixels back to logical ones", () => {
    // A 1290-wide 3x capture sent at 1188 px wide.
    expect(toLogical({ width: 1290, sentWidth: 1188, scale: 3 }) * 1188).toBeCloseTo(430, 5);
  });
});

describe("measuring an element", () => {
  it("reads a pill button's height and roundness through its label", () => {
    const c = canvas(400, 300);
    c.rect(40, 100, 300, 52, 26, "#5B21B6");
    c.text(150, 118, 100, 16, "#FFFFFF");
    const m = measureElement(c.img, [45 / 400, 102 / 300, 335 / 400, 150 / 300], 1)!;
    expect(m.h).toBe(52);
    expect(m.w).toBe(300);
    expect(m.x).toBe(40);
    expect(m.pill).toBe(true);
    expect(m.fill).toBe("#5B21B6");
  });

  it("reads a card's corner radius and converts to logical px", () => {
    const c = canvas(600, 600, "#F4F4F5");
    c.rect(48, 60, 504, 300, 36, "#FFFFFF"); // 12px radius at 3x
    const m = measureElement(c.img, [50 / 600, 70 / 600, 540 / 600, 350 / 600], 1 / 3)!;
    expect(m.pill).toBe(false);
    expect(m.radius).toBeGreaterThan(11);
    expect(m.radius).toBeLessThan(13);
    expect(m.x).toBe(16);
    expect(m.h).toBe(100);
  });

  it("reads square corners as 0", () => {
    const c = canvas(300, 200);
    c.rect(20, 20, 200, 60, 0, "#101828");
    expect(measureElement(c.img, [0.1, 0.12, 0.7, 0.38], 1)!.radius).toBe(0);
  });

  it("gives up when the fill leaks into a same-coloured background", () => {
    const c = canvas(300, 300);
    c.text(100, 100, 60, 10, "#000000");
    expect(measureElement(c.img, [0.3, 0.3, 0.6, 0.4], 1)).toBeNull();
  });

  it("gives up when the box points at something else", () => {
    const c = canvas(400, 400);
    c.rect(10, 10, 40, 40, 4, "#00AA55");
    // Box far larger than the green square: the square is the dominant flat colour only if it covers the box.
    expect(measureElement(c.img, [0, 0, 0.9, 0.9], 1)).toBeNull();
  });
});
