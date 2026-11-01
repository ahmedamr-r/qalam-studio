import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setEngineState } from "@/ai/engine";
import { askClaudeUsage, askCodexLimits, planLimits, resetLimits } from "./limits";

let dir: string;
let out: string;
// The stand-ins are scripts with a shebang, which Windows can't start.
const win = process.platform === "win32";

/** A stand-in `claude -p` that answers `get_usage` over its control protocol (and records what it was given). */
const CLAUDE = `#!${process.execPath}
const fs = require("fs");
const rl = require("readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
  fs.appendFileSync(process.env.STANDIN_OUT, JSON.stringify({ args: process.argv.slice(2), line }) + "\\n");
  const msg = JSON.parse(line);
  if (msg.type !== "control_request") return;
  const response = { subscription_type: "team", rate_limits_available: true, rate_limits: { extra_usage: { is_enabled: false, disabled_reason: "org_level_disabled" }, limits: [
    { kind: "session", group: "session", percent: 41, severity: "normal", resets_at: "2026-11-01T08:00:00Z" },
    { kind: "weekly_all", group: "weekly", percent: 88, severity: "warning", resets_at: "2026-11-06T16:00:00Z" },
  ] } };
  console.log(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: msg.request_id, response } }));
});
`;

/** A stand-in \`codex app-server\`: initialize, then the rate limits. */
const CODEX = `#!${process.execPath}
const fs = require("fs");
const rl = require("readline").createInterface({ input: process.stdin });
const say = (o) => console.log(JSON.stringify(o));
rl.on("line", (line) => {
  fs.appendFileSync(process.env.STANDIN_OUT, JSON.stringify({ args: process.argv.slice(2), line, openai: process.env.OPENAI_API_KEY ?? null }) + "\\n");
  const msg = JSON.parse(line);
  if (msg.method === "initialize") say({ id: msg.id, result: { userAgent: "codex" } });
  else if (msg.method === "account/rateLimits/read") {
    say({ method: "account/updated", params: { authMode: "chatgpt", planType: "plus" } });
    say({ id: msg.id, result: { ordinaryUsageAllowed: true, rateLimits: { limitId: "codex", primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1793520000 }, secondary: { usedPercent: 30, windowDurationMins: 10080, resetsAt: 1793900000 }, credits: { hasCredits: false, unlimited: false, balance: null }, planType: "plus" }, rateLimitsByLimitId: null } });
  }
});
`;

const records = async () => (await readFile(out, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { args: string[]; line: string; openai?: string | null });

async function standIn(name: string, body: string) {
  const file = path.join(dir, name);
  await writeFile(file, body);
  await chmod(file, 0o755);
  return file;
}

let claude: string;
let codex: string;
const env = { ...process.env };

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-limits-"));
  claude = await standIn("claude", CLAUDE);
  codex = await standIn("codex", CODEX);
});
afterAll(async () => {
  process.env = env;
  setEngineState({ kind: "api", bin: "claude", codex: undefined });
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  out = path.join(dir, `out-${Math.random().toString(36).slice(2)}.jsonl`);
  await writeFile(out, "");
  process.env.STANDIN_OUT = out;
  resetLimits();
  (globalThis as { __qalamClaudeLimit?: unknown }).__qalamClaudeLimit = undefined;
});

describe("asking an engine for its plan's limits", () => {
  it.skipIf(win)("asks Claude Code's get_usage with no tools, no settings and no prompt: no model call", async () => {
    const answer = (await askClaudeUsage(claude)) as { subscription_type?: string };
    expect(answer.subscription_type).toBe("team");
    const [rec] = await records();
    expect(rec.args.slice(0, 5)).toEqual(["-p", "--input-format", "stream-json", "--output-format", "stream-json"]);
    expect(rec.args).toEqual(expect.arrayContaining(["--tools", "", "--setting-sources", "", "--no-session-persistence"]));
    expect(JSON.parse(rec.line)).toEqual({ type: "control_request", request_id: "qalam-usage", request: { subtype: "get_usage", skip_behaviors: true } });
    expect(await records()).toHaveLength(1);
  });

  it.skipIf(win)("asks Codex's app server, without a key that would be used instead of the ChatGPT sign-in", async () => {
    process.env.OPENAI_API_KEY = "sk-not-this";
    try {
      const answer = (await askCodexLimits(codex)) as { rateLimits?: { planType?: string } };
      expect(answer.rateLimits?.planType).toBe("plus");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
    const recs = await records();
    expect(recs[0].args).toEqual(["app-server"]);
    expect(recs.map((r) => (JSON.parse(r.line) as { method: string }).method)).toEqual(["initialize", "initialized", "account/rateLimits/read"]);
    expect(recs.every((r) => r.openai === null)).toBe(true);
  });

  it("is nothing when the binary isn't there, or doesn't answer in time", async () => {
    expect(await askClaudeUsage(path.join(dir, "no-such-claude"))).toBeNull();
    const silent = await standIn("silent", `#!${process.execPath}\nprocess.stdin.resume();\n`);
    expect(await askCodexLimits(silent, 300)).toBeNull();
  });

  it.skipIf(win)("reads the live engine's, keeps them a minute, and adds what the last call's rate-limit line says", async () => {
    setEngineState({ kind: "cli", bin: claude });
    const now = Date.parse("2026-11-01T04:00:00Z");
    const first = await planLimits(false, now);
    expect(first).toMatchObject({ engine: "cli", plan: "Team", seat: true, credits: { line: "Turned off by your organization: ask your admin" } });
    expect(first!.rows.map((r) => [r.label, r.percent, r.tone])).toEqual([
      ["Session", 41, "normal"],
      ["Week", 88, "warning"],
    ]);
    await planLimits(false, now + 30_000);
    expect(await records()).toHaveLength(1);
    // A call just hit the team's shared budget.
    (globalThis as { __qalamClaudeLimit?: unknown }).__qalamClaudeLimit = { info: { status: "rejected", limitScope: "group_pool", resetsAt: Date.parse("2026-11-01T08:00:00Z") / 1000 }, at: now };
    expect((await planLimits(false, now + 40_000))!.reached).toEqual({ until: Date.parse("2026-11-01T08:00:00Z"), why: "Your team's shared budget is used up" });
    await planLimits(true, now + 50_000);
    expect(await records()).toHaveLength(2);

    setEngineState({ kind: "codex", codex });
    expect(await planLimits(false, now)).toMatchObject({ engine: "codex", plan: "Plus", rows: [{ label: "5 hours", percent: 12 }, { label: "Week", percent: 30 }] });
    setEngineState({ kind: "api" });
    expect(await planLimits(false, now)).toBeNull();
  });
});
