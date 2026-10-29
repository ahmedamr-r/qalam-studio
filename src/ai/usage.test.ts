import { describe, expect, it } from "vitest";
import { fromApiUsage, fromCliResult } from "./usage";
import { shortCount, summarizeUsage, type UsageEntry } from "./usage-shared";

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 28, 12).getTime();

describe("what Qalam AI used", () => {
  it("reads an API call's tokens, cache included, with no cost (the API doesn't say)", () => {
    expect(fromApiUsage({ input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: null }, "claude-opus-5-5", "synthesize", NOW)).toEqual({
      at: NOW,
      engine: "api",
      model: "claude-opus-5-5",
      kind: "synthesize",
      input: 120,
      output: 40,
      cacheRead: 900,
      cacheWrite: 0,
      cost: null,
    });
    expect(fromApiUsage(null, "m")).toBeNull();
    expect(fromApiUsage({ input_tokens: 1 }, "m", undefined, NOW)).not.toHaveProperty("kind");
  });

  it("reads Claude Code's result line, with its own estimate of the cost", () => {
    const e = fromCliResult({ usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.0123, duration_ms: 2100 }, "claude-haiku-5-5", "connector", NOW);
    expect(e).toMatchObject({ engine: "cli", kind: "connector", input: 10, output: 5, cost: 0.0123, ms: 2100 });
    expect(fromCliResult({ usage: { input_tokens: 1 } }, "m", undefined, NOW)?.cost).toBeNull();
    expect(fromCliResult(undefined, "m")).toBeNull();
  });

  it("sums the last week: calls a day, tokens in and out, and cost only where it was reported", () => {
    const e = (daysAgo: number, cost: number | null): UsageEntry => ({ at: NOW - daysAgo * DAY, engine: "cli", model: "m", input: 100, output: 10, cacheRead: 50, cacheWrite: 0, cost });
    const s = summarizeUsage([e(0.1, 0.5), e(1.5, null), e(6.5, 0.25), e(8, 9)], NOW, 7);
    expect(s).toMatchObject({ calls: 3, input: 450, output: 30, cost: 0.75, days: [1, 0, 0, 0, 0, 1, 1] });
    expect(summarizeUsage([e(1, null)], NOW).cost).toBeNull();
  });

  it("breaks the week down by model family and by job, most calls first", () => {
    const e = (model: string, kind: UsageEntry["kind"], cost: number | null = null): UsageEntry => ({ at: NOW - DAY, engine: "cli", model, kind, input: 10, output: 1, cacheRead: 0, cacheWrite: 0, cost });
    const s = summarizeUsage(
      [e("claude-sonnet-5-5", "extract", 0.1), e("claude-sonnet-5-5", "extract", 0.1), e("sonnet", "topics"), e("claude-opus-5-5", "synthesize", 0.4), e("claude-haiku-5-5", "connector"), e("claude-opus-5-5[1m]", undefined)],
      NOW,
    );
    expect(s.byModel.map((m) => [m.model, m.calls])).toEqual([
      ["Sonnet", 3],
      ["Opus", 2],
      ["Haiku", 1],
    ]);
    expect(s.byModel[0]).toMatchObject({ input: 30, output: 3, cost: 0.2 });
    expect(s.byKind.map((k) => [k.kind, k.model, k.calls])).toEqual([
      ["extract", "Sonnet", 2],
      ["topics", "Sonnet", 1],
      ["synthesize", "Opus", 1],
      ["connector", "Haiku", 1],
      ["other", "Opus", 1],
    ]);
    expect(s.byKind.find((k) => k.kind === "topics")?.cost).toBeNull();
  });

  it("writes token counts short", () => {
    expect([shortCount(950), shortCount(1234), shortCount(48_000), shortCount(2_400_000)]).toEqual(["950", "1.2k", "48k", "2.4M"]);
  });
});
