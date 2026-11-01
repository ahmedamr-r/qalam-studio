import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { childEnv, lastRateLimit, workDir } from "@/ai/cli";
import { spawnCli } from "@/ai/commands";
import { backend, bin, codexBin } from "@/ai/engine";
import { codexEnv } from "@/ai/engines/codex";
import { fromClaudeUsage, fromCodexLimits, withClaudeEvent, type PlanLimits } from "@/ai/limits";
import pkg from "../package.json";

/*
 * The plan limits of the engine Qalam AI runs on, for its card in Connections, asked of the
 * person's own binary with no model call and never with their credentials: Claude Code answers its
 * `get_usage` control request (what its /usage shows: the plan's session and weekly windows and
 * usage credits; Claude Code calls it experimental) over its stream-json input, and Codex answers
 * `account/rateLimits/read` from its app server. Each call's own rate-limit line (src/ai/cli.ts)
 * says at once when a limit stops calls. Kept a minute; a key or a model on this computer has no
 * plan, so none. Checked against Claude Code 2.1.284 and Codex 0.155 (November 2026).
 */

const FRESH_MS = 60_000;
const ASK_MS = 15_000;

// One per process, whichever copy of this module asks (the dev server reloads routes).
const g = globalThis as { __qalamLimits?: { engine: string; bin: string; at: number; answer: Promise<PlanLimits | null> } };

/** The live engine's plan limits (null: no plan, or the engine didn't say). `fresh`: ask again now. */
export async function planLimits(fresh = false, now = Date.now()): Promise<PlanLimits | null> {
  const engine = backend();
  if (engine !== "cli" && engine !== "codex") return null;
  const binPath = engine === "cli" ? bin() : codexBin();
  const k = g.__qalamLimits;
  if (fresh || !k || k.engine !== engine || k.bin !== binPath || now - k.at > FRESH_MS) {
    const answer = engine === "cli" ? askClaudeUsage(binPath).then((a) => fromClaudeUsage(a)) : askCodexLimits(binPath).then((a) => fromCodexLimits(a));
    g.__qalamLimits = { engine, bin: binPath, at: now, answer };
  }
  const limits = await g.__qalamLimits!.answer;
  if (engine !== "cli") return limits;
  const line = lastRateLimit();
  // A line that names no reset tells nothing after an hour.
  return line && (now - line.at < 3_600_000 || (line.info as { resetsAt?: unknown }).resetsAt !== undefined) ? withClaudeEvent(limits, line.info, now) : limits;
}

/** Forget what was asked (tests). */
export const resetLimits = () => void (g.__qalamLimits = undefined);

/** One line in, the answer for `id` out; null when the binary can't start, refuses, or says nothing in time. */
function exchange(binPath: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv }, first: object, answer: (msg: Record<string, unknown>, send: (m: object) => void) => unknown | undefined, ms: number): Promise<unknown | null> {
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawnCli>;
    try {
      proc = spawnCli(binPath, args, { cwd: o.cwd, env: o.env, stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      return resolve(null);
    }
    let done = false;
    const finish = (v: unknown | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      proc.stdin.end();
      // It leaves once its input ends; one that doesn't is stopped.
      setTimeout(() => proc.exitCode === null && proc.kill(), 3000).unref();
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), ms);
    const send = (m: object) => proc.stdin.write(`${JSON.stringify(m)}\n`);
    proc.on("error", () => finish(null));
    proc.on("close", () => finish(null));
    proc.stdin.on("error", () => {});
    createInterface({ input: proc.stdout }).on("line", (line) => {
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      const got = answer(msg as Record<string, unknown>, send);
      if (got !== undefined) finish(got);
    });
    send(first);
  });
}

const USAGE_ID = "qalam-usage";

/** Claude Code's `get_usage` answer, asked over its control protocol (its transcripts aren't scanned). */
export function askClaudeUsage(binPath: string, ms = ASK_MS): Promise<unknown | null> {
  const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"];
  return exchange(binPath, args, { cwd: workDir(), env: childEnv(1024) }, { type: "control_request", request_id: USAGE_ID, request: { subtype: "get_usage", skip_behaviors: true } }, (msg) => {
    const res = msg.type === "control_response" ? (msg.response as { subtype?: string; request_id?: string; response?: unknown } | undefined) : undefined;
    if (res?.request_id !== USAGE_ID) return undefined;
    return res.subtype === "success" ? (res.response ?? null) : null;
  }, ms);
}

let codexDir: string | null = null;

/** Codex's `account/rateLimits/read` answer, from its app server (started, asked, and stopped). */
export function askCodexLimits(binPath: string, ms = ASK_MS): Promise<unknown | null> {
  codexDir ??= path.join(tmpdir(), "qalam-studio-codex");
  mkdirSync(codexDir, { recursive: true });
  const init = { method: "initialize", id: 0, params: { clientInfo: { name: "qalam_studio", title: "Qalam Studio", version: pkg.version }, capabilities: null } };
  return exchange(binPath, ["app-server"], { cwd: codexDir, env: codexEnv() }, init, (msg, send) => {
    if (msg.id === 0) {
      if (msg.error) return null;
      send({ method: "initialized" });
      send({ method: "account/rateLimits/read", id: 1, params: { excludeResetCreditDetails: true } });
      return undefined;
    }
    if (msg.id !== 1) return undefined;
    return msg.error ? null : (msg.result ?? null);
  }, ms);
}
