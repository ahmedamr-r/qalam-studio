import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setEngineState } from "@/ai/engine";
import { posthogSearch } from "@/connectors/numbers";
import { runTools } from "./claude-code";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-runner-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A stand-in `claude -p`: it makes these tool calls (answering each), then lingers as a model that wanders would. */
async function fake(calls: { input: Record<string, unknown>; answer: string }[]) {
  const lines = [
    { type: "system", subtype: "init" },
    ...calls.flatMap((c, i) => [
      { type: "assistant", message: { content: [{ type: "tool_use", id: `t${i}`, name: "mcp__plugin_posthog_posthog__exec", input: c.input }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: `t${i}`, content: [{ type: "text", text: c.answer }] }] } },
    ]),
  ];
  const file = path.join(dir, `claude-${Math.random().toString(36).slice(2)}`);
  await writeFile(file, `#!/bin/sh\ncat > /dev/null\n${lines.map((l) => `echo '${JSON.stringify(l).replace(/'/g, "'\\''")}'`).join("\n")}\nsleep 30\n`);
  await chmod(file, 0o755);
  setEngineState({ bin: file });
}

describe("the tool-runner", () => {
  it("keeps an answer when the planned arguments are as asked (metadata the model filled in aside), and stops once answered", async () => {
    const call = posthogSearch("orders");
    await fake([{ input: { ...call.args, llm_model: "claude-haiku", context: "its own words" }, answer: '{"results":[]}' }]);
    const t0 = Date.now();
    expect(await runTools("plugin:posthog:posthog", [call])).toEqual(['{"results":[]}']);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it("drops a call the model changed", async () => {
    const call = posthogSearch("orders");
    await fake([{ input: { ...call.args, command: "call insight-query {}" }, answer: "other data" }]);
    const t0 = Date.now();
    const out = runTools("plugin:posthog:posthog", [call], AbortSignal.timeout(3000));
    await expect(out).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(10_000);
  });
});
