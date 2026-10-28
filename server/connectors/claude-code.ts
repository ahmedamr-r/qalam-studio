import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { childEnv, workDir } from "@/ai/cli";
import { bin } from "@/ai/engine";
import { resultText } from "@/ai/research-shared";
import { fromCliResult, reportUsage } from "@/ai/usage";
import { parseMcpList, toolPrefix, type ListedServer } from "@/connectors/claude-code";
import type { ToolCall } from "@/connectors/recipes";

/*
 * The connectors the user's Claude Code already has, used through it. `claude mcp list` says which
 * there are (it checks each, so it runs only when asked, and its answer is kept five minutes). The
 * tool-runner makes the calls code planned, on that server, in a short `claude -p` whose only
 * allowed tools are those, and keeps each call's answer exactly as the server gave it; a call
 * the model changed is dropped. Claude Code holds the sign-ins: Qalam never reads them.
 */

const FRESH_MS = 5 * 60_000;
const g = globalThis as { __qalamMcpList?: { at: number; list: ListedServer[] } };

export async function listClaudeCode(force = false): Promise<ListedServer[] | null> {
  const kept = g.__qalamMcpList;
  if (!force && kept && Date.now() - kept.at < FRESH_MS) return kept.list;
  const out = await new Promise<string | null>((resolve) =>
    execFile(bin(), ["mcp", "list"], { cwd: workDir(), env: childEnv(4000), timeout: 90_000, maxBuffer: 1 << 20 }, (err, stdout) => resolve(err && !stdout ? null : String(stdout))),
  );
  if (out === null) return null;
  g.__qalamMcpList = { at: Date.now(), list: parseMcpList(out) };
  return g.__qalamMcpList.list;
}

/** The last answer, without asking again (null: never asked since Qalam started). */
export const claudeCodeKnown = () => (g.__qalamMcpList ? { at: g.__qalamMcpList.at, list: g.__qalamMcpList.list } : null);

// An alias Claude Code knows (a full id it doesn't know yet falls back to its default).
const MODEL = process.env.CONNECTOR_MODEL || "haiku";
/** A run that hasn't made its calls by now is stopped. */
const LIMIT_MS = 150_000;
const pick = (args: Record<string, unknown>, keys: string[] | undefined) => (keys ? Object.fromEntries(keys.map((k) => [k, args?.[k]])) : args);
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/** Each call's answer, in order (null: it failed, or wasn't made as planned). */
export function runTools(server: string, calls: ToolCall[], signal?: AbortSignal): Promise<(string | null)[]> {
  const prefix = toolPrefix(server);
  const names = [...new Set(calls.map((c) => prefix + c.tool))];
  const asked = calls.map((c, i) => `${i + 1}. ${prefix}${c.tool} with ${JSON.stringify(c.args)}`).join("\n");
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--model", MODEL,
      "--system-prompt", "You run the tools you're asked to, each exactly once with exactly the arguments given, and then reply with the word done.",
      "--tools", "",
      "--allowedTools", ...names,
      // Nothing can answer a permission prompt here: anything not allowed above is denied.
      "--permission-prompts", "none",
      // The account's claude.ai connectors load with the user's settings, so no --strict-mcp-config.
      "--disable-slash-commands",
      "--no-session-persistence",
    ];
    const proc = spawn(/*turbopackIgnore: true*/ bin(), args, { cwd: workDir(), env: { ...childEnv(4000), MAX_MCP_OUTPUT_TOKENS: "40000" } });
    const results: (string | null)[] = calls.map(() => null);
    const made = new Map<string, number>();
    let result: Parameters<typeof fromCliResult>[0] | undefined;
    // Settled once: with every answer in, on a stop, at the time limit, or when the run ends. It
    // doesn't wait for the process's output to close (something it started may hold it open).
    let settled = false;
    const finish = (then: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(limit);
      signal?.removeEventListener("abort", stop);
      reportUsage(fromCliResult(result, MODEL));
      proc.kill();
      then();
    };
    const stop = () => finish(() => reject(new DOMException("Stopped.", "AbortError")));
    signal?.addEventListener("abort", stop, { once: true });
    const limit = setTimeout(() => finish(() => resolve(results)), LIMIT_MS);
    proc.on("error", (e) => finish(() => reject(new Error(`Couldn't start Claude Code (${e.message}).`))));
    proc.stdin.on("error", () => {});
    proc.stdin.end(`${JSON.stringify({ type: "user", message: { role: "user", content: `Call:\n${asked}` } })}\n`);
    createInterface({ input: proc.stdout }).on("line", (line) => {
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.type === "assistant")
        for (const b of ev.message?.content ?? []) {
          if (b.type !== "tool_use") continue;
          // Kept only when it's one of the planned calls, as planned (and not one already made).
          const i = calls.findIndex((c, k) => prefix + c.tool === b.name && canonical(pick(c.args, c.match)) === canonical(pick(b.input ?? {}, c.match)) && ![...made.values()].includes(k));
          if (i >= 0) made.set(b.id, i);
        }
      else if (ev.type === "user") {
        for (const b of Array.isArray(ev.message?.content) ? ev.message.content : []) {
          if (b.type !== "tool_result" || b.is_error || !made.has(b.tool_use_id)) continue;
          results[made.get(b.tool_use_id)!] = resultText(b.content);
        }
        // Every planned call answered: nothing more is needed (and the model can't wander off).
        if (results.every((x) => x !== null)) finish(() => resolve(results));
      } else if (ev.type === "result") result = ev;
    });
    proc.on("close", () => finish(() => (signal?.aborted ? reject(new DOMException("Stopped.", "AbortError")) : resolve(results))));
  });
}
