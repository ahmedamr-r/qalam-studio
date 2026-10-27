import { describe, expect, it } from "vitest";
import { dot } from "@/hub/fuse";
import { models } from "./client";

/**
 * The real models, in their own process: run with QALAM_MODEL_TESTS=1 (they download on first use,
 * about 75 MB, into the models cache).
 */
describe.skipIf(!process.env.QALAM_MODEL_TESTS)("the models process", () => {
  it("embeds into unit vectors where related sentences are nearer, and ranks documents for a question", async () => {
    const m = models();
    const [q] = await m.embed(["why do parents rebuild their weekly shop?"], "query");
    const [a, b] = await m.embed(["I rebuild my basket from scratch every week", "The courier never says when he will arrive"], "doc");
    expect(q.length).toBe(384);
    expect(dot(q, q)).toBeCloseTo(1, 4);
    expect(dot(q, a)).toBeGreaterThan(dot(q, b));
    expect(m.state().status).toBe("ready");
    const scores = await m.rank("What is the capital of France?", ["Paris is the capital of France.", "Bananas are rich in potassium."]);
    expect(scores[0]).toBeGreaterThan(scores[1]);
  }, 180_000);
});
