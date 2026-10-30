import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { modelOf, setEngineState } from "./engine";
import { readStructured, streamStructured } from "./server";
import { onUsage } from "./usage";
import type { UsageEntry } from "./usage-shared";

let dir: string;
let used: UsageEntry[] = [];

/** A stand-in `claude`: it can't use `sonnet` (as on a plan without the alias), answers on any other model. */
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-tiers-"));
  const file = path.join(dir, "claude");
  await writeFile(
    file,
    `#!/bin/sh
model=""
while [ $# -gt 0 ]; do if [ "$1" = "--model" ]; then model="$2"; fi; shift; done
cat > /dev/null
echo "{\\"type\\":\\"system\\",\\"subtype\\":\\"init\\",\\"model\\":\\"$model\\"}"
if [ "$model" = "sonnet" ]; then
  echo '{"type":"assistant","error":"model_not_found","message":{"model":"<synthetic>","content":[]}}'
  echo '{"type":"result","subtype":"success","is_error":true,"result":"There is an issue with the selected model (sonnet)."}'
  exit 0
fi
echo '{"type":"result","subtype":"success","structured_output":{"ok":true},"usage":{"input_tokens":5,"output_tokens":2},"total_cost_usd":0.001}'
`,
  );
  await chmod(file, 0o755);
  onUsage((e) => used.push(e));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  used = [];
  for (const k of ["QALAM_MODEL_DECIDE", "QALAM_MODEL_READ", "DISCOVERY_MODEL", "GENERATE_MODEL", "CLAUDE_MODEL"]) delete process.env[k];
  setEngineState({ kind: "cli", bin: path.join(dir, "claude"), mix: "balanced", readFailed: [] });
});

const call = (kind: "extract" | "synthesize" | "setup-shape" | "claims") => ({ kind, system: "s", content: [{ type: "text" as const, text: "t" }], schema: { type: "object" }, effort: "low" as const });

// Its stand-in is a script with a shebang, which Windows can't start.
describe.skipIf(process.platform === "win32")("calls on Claude Code, by job", () => {
  it("runs a read call on its model, and once more on the decide model when Claude Code can't use it, from then on", async () => {
    expect(modelOf("extract")).toBe("sonnet");
    const out = await readStructured<{ ok: boolean }>(streamStructured(call("extract")));
    expect(out).toEqual({ data: { ok: true }, model: "claude-opus-5-5" });
    expect(modelOf("extract")).toBe("claude-opus-5-5");
    expect(used).toEqual([expect.objectContaining({ engine: "cli", kind: "extract", model: "claude-opus-5-5", input: 5, output: 2 })]);
  });

  it("runs decide calls on the decide model, and with \"best\" reads there too, except the ones that hold on Sonnet", async () => {
    expect((await readStructured(streamStructured(call("synthesize")))).model).toBe("claude-opus-5-5");
    setEngineState({ mix: "best" });
    expect([modelOf("extract"), modelOf("topics"), modelOf("setup-shape"), modelOf("claims")]).toEqual(["claude-opus-5-5", "claude-opus-5-5", "sonnet", "sonnet"]);
    expect(used.map((e) => e.kind)).toEqual(["synthesize"]);
  });

  it('retries a "best" read on Sonnet on the decide model when Claude Code can\'t use Sonnet', async () => {
    setEngineState({ mix: "best" });
    expect((await readStructured(streamStructured(call("setup-shape")))).model).toBe("claude-opus-5-5");
    expect(modelOf("claims")).toBe("claude-opus-5-5");
    expect(used).toEqual([expect.objectContaining({ kind: "setup-shape", model: "claude-opus-5-5" })]);
  });

  it("says why when a call's own model can't be used and nothing is left to try", async () => {
    process.env.QALAM_MODEL_DECIDE = "sonnet";
    await expect(readStructured(streamStructured(call("synthesize")))).rejects.toThrow("Claude Code can't use sonnet here.");
  });
});
