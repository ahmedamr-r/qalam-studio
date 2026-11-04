import { afterEach, describe, expect, it } from "vitest";
import { labOn } from "./lab";

const before = process.env.QALAM_LAB;
afterEach(() => {
  if (before === undefined) delete process.env.QALAM_LAB;
  else process.env.QALAM_LAB = before;
});

describe("what v0.1 hides that's on here", () => {
  it("takes QALAM_LAB over the settings", async () => {
    process.env.QALAM_LAB = "1";
    expect(await labOn()).toBe(true);
    process.env.QALAM_LAB = "feeds,seen";
    expect(await labOn()).toEqual(["feeds", "seen"]);
    process.env.QALAM_LAB = "0";
    expect(await labOn()).toEqual([]);
  });
});
