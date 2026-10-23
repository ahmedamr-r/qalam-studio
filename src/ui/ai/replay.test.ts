import { describe, expect, it } from "vitest";
import type { AIDelta } from "@/ai/client";
import { SAMPLE_GENERATE } from "@/ai/fixtures";
import { chunks, replayStream } from "./replay";

describe("replayStream", () => {
  it("sends the whole answer, in pieces, after any thinking", async () => {
    const got: AIDelta[] = [];
    await replayStream(SAMPLE_GENERATE, { onDelta: (d) => got.push(d), ms: 5, thinking: [] });
    const json = got.map((d) => (d.kind === "json" ? d.text : "")).join("");
    expect(JSON.parse(json)).toEqual(SAMPLE_GENERATE);
    expect(got.length).toBeGreaterThan(20);
  });

  it("stops with an AbortError", async () => {
    const ctrl = new AbortController();
    const done = replayStream(SAMPLE_GENERATE, { onDelta: () => {}, ms: 10_000, signal: ctrl.signal });
    ctrl.abort();
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
  });

  it("splits text into pieces that join back", () => {
    const text = "x".repeat(1000);
    expect(chunks(text).join("")).toBe(text);
  });
});
