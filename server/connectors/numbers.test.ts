import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "@/connectors/recipes";
import { writeSettings } from "../settings";

const ran: { server: string; calls: ToolCall[] }[] = [];
let answer: string | null = null;
vi.mock("./claude-code", () => ({
  runTools: async (server: string, calls: ToolCall[]) => {
    ran.push({ server, calls });
    return calls.map(() => answer);
  },
}));
const { readInsight, searchInsights } = await import("./numbers");

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-numbers-"));
  process.env.QALAM_HOME = dir;
  ran.length = 0;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("an outcome's number from PostHog, through Claude Code", () => {
  it("asks to connect PostHog first", async () => {
    await expect(searchInsights("orders")).rejects.toThrow(/Connections/);
  });

  it("finds saved insights and reads one's number on the PostHog server Claude Code has", async () => {
    await writeSettings({ connectors: { posthog: { via: "claude-code", server: "plugin:posthog:posthog" } } });
    answer = `${JSON.stringify({ results: [{ id: 1, short_id: "7mlKKF3J", name: "Weekly orders", _posthogUrl: "https://ph/i/7mlKKF3J" }] })}\n{"conversation_id":"x"}`;
    expect(await searchInsights("orders")).toEqual([{ id: "7mlKKF3J", title: "Weekly orders", url: "https://ph/i/7mlKKF3J" }]);
    expect(ran[0]).toMatchObject({ server: "plugin:posthog:posthog", calls: [{ tool: "exec" }] });

    answer = JSON.stringify({ query: { kind: "TrendsQuery" }, insight: { name: "Weekly orders" }, results: [{ data: [40, 52, 61], action: { custom_name: "Orders" } }], _posthogUrl: "https://ph/i/7mlKKF3J" });
    expect(await readInsight("7mlKKF3J")).toEqual({ name: "Weekly orders", url: "https://ph/i/7mlKKF3J", series: [{ label: "Orders", value: 61 }] });

    answer = null;
    await expect(readInsight("7mlKKF3J")).rejects.toThrow(/didn't run/);
  });
});
