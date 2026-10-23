import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { CallOpts } from "./server";
import { deltaBatcher } from "./deltas";

/**
 * Local-dev backend (AI_BACKEND=cli): runs the signed-in `claude` CLI headless, so calls
 * use your Claude subscription instead of an API key. Emits the same NDJSON as the API path.
 */

export const BIN = process.env.CLAUDE_CLI_PATH || "claude";

// Variables a parent Claude Code session sets (if this dev server runs inside one), plus any
// API key, which would take precedence over the login. The token/config ones are the user's own.
const KEEP = new Set(["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]);
export function childEnv(maxTokens: number): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k === "NODE_OPTIONS") continue;
    if (/^(ANTHROPIC_|CLAUDE)/.test(k) && !KEEP.has(k)) continue;
    env[k] = v;
  }
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(maxTokens);
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = "1";
  return env as NodeJS.ProcessEnv;
}

// Run outside the repo so the CLI doesn't pick up this project's CLAUDE.md or settings.
let dir: string | null = null;
export function workDir() {
  dir ??= join(tmpdir(), "qalam-studio-cli");
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface CliResult {
  subtype: string;
  is_error?: boolean;
  result?: string;
  stop_reason?: string | null;
  structured_output?: unknown;
  usage?: unknown;
  errors?: string[];
}

export function streamViaCli(opts: CallOpts, model: string): Response {
  const encoder = new TextEncoder();
  let child: ChildProcess | undefined;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (o: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      };
      const finish = (o: unknown) => {
        send(o);
        if (!closed) controller.close();
        closed = true;
      };

      const args = [
        "-p",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--json-schema", JSON.stringify(opts.schema),
        "--system-prompt", Array.isArray(opts.system) ? opts.system.join("\n\n") : opts.system,
        "--model", model,
        "--effort", opts.effort,
        "--tools", "",
        "--setting-sources", "",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--no-session-persistence",
      ];
      // The binary path is dynamic; keep Turbopack from tracing the whole project for it.
      const proc = spawn(/*turbopackIgnore: true*/ BIN, args, { cwd: workDir(), env: childEnv(opts.maxTokens ?? 32000) });
      child = proc;
      proc.on("error", (e) =>
        finish({ type: "error", error: "cli_missing", message: `Couldn't start the Claude CLI (${e.message}). Install Claude Code or set CLAUDE_CLI_PATH.` }),
      );
      proc.stdin.on("error", () => {});
      proc.stdin.end(JSON.stringify({ type: "user", message: { role: "user", content: opts.content } }) + "\n");

      let stderr = "";
      proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));

      let chars = 0;
      let last = 0;
      const deltas = opts.deltas ? deltaBatcher(send) : null;
      let answers = 0;
      let modelName = model;
      let apiError: string | undefined;
      let result: CliResult | undefined;
      createInterface({ input: proc.stdout }).on("line", (line) => {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          return;
        }
        if (ev.type === "system" && ev.subtype === "init") modelName = ev.model ?? modelName;
        else if (ev.type === "stream_event" && ev.event?.type === "content_block_start") {
          // Each StructuredOutput call writes the answer from the start (the CLI retries on schema errors).
          if (ev.event.content_block?.type === "tool_use") {
            if (++answers > 1) console.warn(`[qalam] the model is writing its answer again (attempt ${answers}): the last one failed the schema check`);
            deltas?.reset();
          }
        } else if (ev.type === "stream_event" && ev.event?.type === "content_block_delta") {
          const d = ev.event.delta;
          chars += (d.text ?? d.partial_json ?? d.thinking ?? "").length;
          if (deltas) {
            if (d.type === "input_json_delta") deltas.push("json", d.partial_json ?? "");
            else if (d.type === "thinking_delta") deltas.push("thinking", d.thinking ?? "");
            else if (d.type === "text_delta") deltas.push("text", d.text ?? "");
          }
          const now = Date.now();
          if (now - last > 400) {
            last = now;
            send({ type: "progress", tokens: Math.round(chars / 4) });
          }
        } else if (ev.type === "assistant" && ev.error) apiError = ev.error;
        else if (ev.type === "result") result = ev;
      });

      proc.on("close", (code) => {
        deltas?.flush();
        if (!result) return finish({ type: "error", error: "cli", message: stderr.trim() || `The Claude CLI exited with code ${code}.` });
        if (result.stop_reason === "refusal") return finish({ type: "error", error: "refusal", message: "The model declined this request." });
        if (result.stop_reason === "max_tokens") return finish({ type: "error", error: "max_tokens", message: "The response was cut off. Try a simpler brief." });
        if (result.subtype === "error_max_structured_output_retries") return finish({ type: "error", error: "parse", message: "Model output did not match the schema." });
        if (result.is_error || result.subtype !== "success") {
          if (apiError === "authentication_failed")
            return finish({ type: "error", error: "auth", message: "The Claude CLI isn't signed in. Run `claude auth login` in a terminal, then try again." });
          return finish({ type: "error", error: apiError?.includes("rate") ? "rate_limited" : "cli", message: result.result || result.errors?.join("; ") || result.subtype });
        }
        let data = result.structured_output;
        if (data == null) {
          const text = result.result ?? "";
          try {
            data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
          } catch {
            return finish({ type: "error", error: "parse", message: "Model output was not valid JSON." });
          }
        }
        finish({ type: "result", data, usage: result.usage, model: modelName });
      });
    },
    cancel() {
      closed = true;
      child?.kill();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
