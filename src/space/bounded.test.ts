import { describe, expect, it } from "vitest";
import { bounded } from "./bounded";

describe("work started a few at a time", () => {
  it("runs at most n at once, starts the next as one ends, and keeps the order given", async () => {
    let running = 0;
    let most = 0;
    const started: number[] = [];
    const job = (i: number, ms: number) => async () => {
      started.push(i);
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      return i;
    };
    const out = bounded([job(0, 30), job(1, 5), job(2, 20), job(3, 5), job(4, 5)], 2);
    expect(await Promise.all(out)).toEqual([0, 1, 2, 3, 4]);
    expect(most).toBe(2);
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it("goes on past one that fails, which fails on its own", async () => {
    const out = bounded([async () => 1, async () => Promise.reject(new Error("unreadable")), async () => 3], 1);
    await expect(out[1]).rejects.toThrow("unreadable");
    expect(await out[0]).toBe(1);
    expect(await out[2]).toBe(3);
  });
});
