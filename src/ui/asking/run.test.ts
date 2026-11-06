import { describe, expect, it } from "vitest";
import { emptyAsking, startLookup } from "@/asking/engine";
import type { AskTurn, AskingState, FoundLine } from "@/asking/types";
import { generateNow, goOn, type AskingHost } from "./run";

/* The interview's runner with a stand-in flow: turns, lookups and the generation it ends in. */

const done: AskTurn = { questions: [], lookups: [], done: true, understood: [], terms: [], choices: [] };
let n = 0;

function host(s0: AskingState, lookup: (signal: AbortSignal) => Promise<{ lines?: FoundLine[] }>) {
  let s = s0;
  const log: string[] = [];
  const h: AskingHost = {
    key: `test-${n++}`,
    get: () => s,
    set: (fn) => {
      s = fn(s);
    },
    turn: async () => {
      log.push("turn");
      return done;
    },
    lookup: (l, signal) => {
      log.push(`lookup:${l.id}`);
      return lookup(signal);
    },
    generate: async (x) => {
      log.push(`generate:${x.lookups.map((l) => l.state).join(",")}`);
    },
  };
  return { h, log, state: () => s };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const inBackground = (s: AskingState) => startLookup(s, { id: "web-draft", kind: "web", query: "", waits: "draft" }, 1);
const never = (signal: AbortSignal) => new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError"))));

describe("a look in the background before a draft", () => {
  it("doesn't hold the turns, and the draft waits for it, then reads what it found", async () => {
    let land: (r: { lines: FoundLine[] }) => void = () => {};
    const { h, log, state } = host(inBackground(emptyAsking()), () => new Promise((r) => (land = r)));
    const going = goOn(h, new AbortController().signal);
    await tick();
    // The turn ran while the look did; nothing more to ask, so only the draft waits.
    expect(log).toEqual(["lookup:web-draft", "turn"]);
    expect(state().end?.by).toBe("done");
    land({ lines: [{ ref: "web-draft-1", text: "Parents order again when the window is short.", from: "example.com" }] });
    await expect(going).resolves.toBe("generated");
    expect(log.at(-1)).toBe("generate:done");
  });

  it("goes now on Draft now: the look stops, and the draft runs without it", async () => {
    const { h, log, state } = host(inBackground(emptyAsking()), never);
    const going = goOn(h, new AbortController().signal);
    await tick();
    expect(log).not.toContain("generate:running");
    generateNow(h);
    await expect(going).resolves.toBe("generated");
    expect(state().lookups[0].state).toBe("stopped");
    expect(log.at(-1)).toBe("generate:stopped");
  });

  it("is let go after a reload: nothing runs it any more, so the draft doesn't wait on it", async () => {
    // Running in the state, with nothing here running it: the page closed while it ran.
    const s = { ...inBackground(emptyAsking()), end: { by: "done" as const, at: 2 } };
    const { h, log } = host(s, never);
    // startLookups would start it again: a reload's state is marked stopped first (loaded), as the chat does.
    h.set((x) => ({ ...x, lookups: x.lookups.map((l) => ({ ...l, state: "stopped" as const })) }));
    await expect(goOn(h, new AbortController().signal)).resolves.toBe("generated");
    expect(log).toEqual(["generate:stopped"]);
  });
});
