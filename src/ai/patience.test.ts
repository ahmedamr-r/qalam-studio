import { describe, expect, it } from "vitest";
import { briefLimit, patiently } from "./patience";

const limited = (message = "slow down") => Object.assign(new Error(message), { code: "rate_limited" });
const noSleep = async () => {};

describe("a limit that passes", () => {
  it("asks again after a wait, and gets there", async () => {
    let calls = 0;
    const waited: number[] = [];
    const got = await patiently(
      async () => {
        if (++calls < 3) throw limited();
        return "answer";
      },
      { sleep: noSleep, onWait: (ms) => waited.push(ms) },
    );
    expect(got).toBe("answer");
    expect(calls).toBe(3);
    expect(waited).toEqual([30_000, 60_000]);
  });

  it("gives up after its waits, saying what the engine said", async () => {
    let calls = 0;
    await expect(
      patiently(
        async () => {
          calls++;
          throw limited("still slow");
        },
        { sleep: noSleep, waits: [1, 2] },
      ),
    ).rejects.toThrow("still slow");
    expect(calls).toBe(3);
  });

  it("says anything else at once, and a plan's usage limit too", async () => {
    let calls = 0;
    const tries = (e: Error) =>
      patiently(
        async () => {
          calls++;
          throw e;
        },
        { sleep: noSleep },
      );
    await expect(tries(new Error("broken"))).rejects.toThrow("broken");
    await expect(tries(limited("You have hit your usage limit"))).rejects.toThrow("usage limit");
    await expect(tries(limited("You've hit your limit · resets 3pm"))).rejects.toThrow("limit");
    expect(calls).toBe(3);
    expect(briefLimit(limited("exceeded retry limit, last status: 429 Too Many Requests"))).toBe(true);
    expect(briefLimit(null)).toBe(false);
  });

  it("stops waiting when it's stopped", async () => {
    const stop = new AbortController();
    let calls = 0;
    await expect(
      patiently(
        async () => {
          calls++;
          throw limited();
        },
        { signal: stop.signal, sleep: async () => stop.abort() },
      ),
    ).rejects.toThrow("slow down");
    expect(calls).toBe(1);
  });
});
