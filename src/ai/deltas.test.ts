import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deltaBatcher, type DeltaMessage } from "./deltas";

describe("deltaBatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("joins text per kind and sends it in batches", () => {
    const sent: DeltaMessage[] = [];
    const b = deltaBatcher((m) => sent.push(m), 100);
    b.push("json", '{"a"');
    b.push("thinking", "Plan");
    b.push("json", ":1");
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([
      { type: "delta", kind: "json", text: '{"a":1' },
      { type: "delta", kind: "thinking", text: "Plan" },
    ]);
  });

  it("drops unsent text on reset and sends the reset at once", () => {
    const sent: DeltaMessage[] = [];
    const b = deltaBatcher((m) => sent.push(m), 100);
    b.push("json", "{");
    b.reset();
    expect(sent).toEqual([{ type: "delta", kind: "reset" }]);
    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(1);
  });

  it("flushes on demand and ignores empty text", () => {
    const sent: DeltaMessage[] = [];
    const b = deltaBatcher((m) => sent.push(m), 100);
    b.push("text", "");
    b.push("text", "Hi");
    b.flush();
    expect(sent).toEqual([{ type: "delta", kind: "text", text: "Hi" }]);
  });
});
