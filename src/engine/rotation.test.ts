import { describe, expect, it } from "vitest";
import { angleOf, insidePolygon, normalizeDeg, rotateAround, rotationCornerAt, rotationDelta, snapAngle } from "./rotation";

const box = [
  { x: 100, y: 100 },
  { x: 200, y: 100 },
  { x: 200, y: 200 },
  { x: 100, y: 200 },
];

describe("angles", () => {
  it("normalises to (-180, 180] without -0", () => {
    expect(normalizeDeg(370)).toBe(10);
    expect(normalizeDeg(-190)).toBe(170);
    expect(normalizeDeg(-180)).toBe(180);
    expect(normalizeDeg(-0.001)).toBe(0);
    expect(normalizeDeg(45.678)).toBe(45.68);
  });

  it("snaps to 15° steps", () => {
    expect(snapAngle(7)).toBe(0);
    expect(snapAngle(8)).toBe(15);
    expect(snapAngle(-52)).toBe(-45);
    expect(snapAngle(178)).toBe(180);
  });

  it("measures directions clockwise on screen", () => {
    expect(angleOf({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0);
    expect(angleOf({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe(90);
  });

  it("turns points around a centre", () => {
    const p = rotateAround({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });
});

describe("rotation zone", () => {
  it("is just outside a corner, past the resize handle", () => {
    expect(rotationCornerAt(box, { x: 90, y: 90 })).toBe(0);
    expect(rotationCornerAt(box, { x: 212, y: 212 })).toBe(2);
    expect(rotationCornerAt(box, { x: 212, y: 95 })).toBe(1);
  });

  it("leaves the inside, the handle itself and the far field alone", () => {
    expect(rotationCornerAt(box, { x: 105, y: 105 })).toBeNull();
    expect(rotationCornerAt(box, { x: 97, y: 97 })).toBeNull();
    expect(rotationCornerAt(box, { x: 70, y: 70 })).toBeNull();
    expect(rotationCornerAt(box, { x: 150, y: 90 })).toBeNull();
  });

  it("works on a turned box", () => {
    const turned = box.map((p) => rotateAround(p, { x: 150, y: 150 }, 30));
    const corner = turned[0];
    const out = { x: corner.x - 8, y: corner.y - 8 };
    expect(insidePolygon(turned, { x: 150, y: 150 })).toBe(true);
    expect(rotationCornerAt(turned, out)).toBe(0);
  });
});

describe("rotationDelta", () => {
  const c = { x: 0, y: 0 };
  it("follows the pointer around the centre", () => {
    expect(rotationDelta(c, { x: 10, y: 0 }, { x: 0, y: 10 }, 0, false)).toBe(90);
    expect(rotationDelta(c, { x: 10, y: 0 }, { x: 10, y: -10 }, 0, false)).toBe(-45);
  });

  it("with ⇧ lands the layer's own angle on 15° steps", () => {
    // A layer at 10°, turned by about 22°: 32° snaps to 30°, so the turn is 20°.
    const now = rotateAround({ x: 10, y: 0 }, c, 22);
    expect(rotationDelta(c, { x: 10, y: 0 }, now, 10, true)).toBe(20);
  });
});
