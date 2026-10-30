import { spawn, execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { codexBin } from "../engine";
import { splitBlocks } from "../content";
import { fromCodexUsage, reportUsage, type CodexUsage } from "../usage";
import { checkAnswer, repairPrompt, strictSchema } from "../validate";
import { EngineError, registerAdapter, type EngineAdapter } from "./index";

/*
 * The person's own Codex, signed in with their ChatGPT plan, as an engine: `codex exec` run
 * headless for each call, the way OpenAI allows other tools to use it. It runs from an empty
 * folder with its own instructions replaced by the call's, no shell, no apps, plugins, skills or
 * web, and nothing kept on disk; the answer is held to the call's schema (made strict, as Codex
 * asks) and checked again by code. OPENAI_API_KEY and CODEX_API_KEY are left out of its
 * environment so the plan pays, and Codex's own credentials are never read. Server-only.
 */

/** Codex's tools and extras a call never needs. */
const OFF = ["shell_tool", "unified_exec", "apps", "plugins", "browser_use", "browser_use_external", "computer_use", "image_generation", "multi_agent", "hooks", "skill_search", "tool_suggest", "view_image"];

/** What Codex adds to a call that Qalam's don't need: its sandbox note, the folder, apps and skills, AGENTS.md. */
const QUIET = ["project_doc_max_bytes=0", "include_permissions_instructions=false", "include_environment_context=false", "include_apps_instructions=false", "include_collaboration_mode_instructions=false", "skills.include_instructions=false"];

export interface CodexRun {
  /** The folder it runs from (empty) and the files it's given. */
  dir: string;
  instructions: string;
  schema: string | null;
  images: string[];
  model: string;
  effort: string;
  search?: boolean;
}

/** `codex exec`'s arguments for one call (the prompt goes on stdin). */
export function codexArgs(r: CodexRun): string[] {
  return [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "-s",
    "read-only",
    "-C",
    r.dir,
    ...OFF.flatMap((f) => ["--disable", f]),
    ...QUIET.flatMap((c) => ["-c", c]),
    "-c",
    `web_search="${r.search ? "live" : "disabled"}"`,
    "-c",
    `model_reasoning_effort="${r.effort}"`,
    "-c",
    `model_instructions_file=${JSON.stringify(r.instructions)}`,
    ...(r.model ? ["-m", r.model] : []),
    ...(r.schema ? ["--output-schema", r.schema] : []),
    ...r.images.flatMap((f) => ["--image", f]),
    "-",
  ];
}

/** Codex's environment: this computer's, without a key that would be used instead of the ChatGPT sign-in. */
export function codexEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && k !== "NODE_OPTIONS" && !/^(OPENAI_|CODEX_API_KEY$)/.test(k)) out[k] = v;
  return out as NodeJS.ProcessEnv;
}

export interface CodexOutcome {
  text: string | null;
  usage: CodexUsage | null;
  /** What Codex said went wrong (its own words, or the API's JSON). */
  error: string | null;
}

/** Codex's `--json` lines, folded: the last message, the turn's usage, and an error if the turn failed. */
export function readCodexEvents(lines: string[]): CodexOutcome {
  const out: CodexOutcome = { text: null, usage: null, error: null };
  for (const line of lines) {
    let ev: { type?: string; item?: { type?: string; text?: string }; usage?: CodexUsage; message?: string; error?: { message?: string } };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === "item.completed" && ev.item?.type === "agent_message" && typeof ev.item.text === "string") out.text = ev.item.text;
    else if (ev.type === "turn.completed" && ev.usage) out.usage = ev.usage;
    else if (ev.type === "turn.failed") out.error = ev.error?.message ?? out.error ?? "Codex's turn failed.";
    else if (ev.type === "error" && typeof ev.message === "string") out.error ??= ev.message;
  }
  return out;
}

/** What went wrong, as the codes the window knows (Codex passes the API's JSON on as its message). */
export function codexError(raw: string, model: string): EngineError {
  let said = raw;
  let status = 0;
  let code = "";
  try {
    const j = JSON.parse(raw) as { status?: number; error?: { message?: string; code?: string } };
    said = j.error?.message ?? raw;
    status = j.status ?? 0;
    code = j.error?.code ?? "";
  } catch {
    // Codex's own words.
  }
  if (code === "invalid_json_schema") return new EngineError("schema", said);
  if (code === "model_not_found" || /model.*not (supported|found)/i.test(said)) return new EngineError("no_model", `Codex can't run ${model || "that model"} with this sign-in. Pick another in Connections.`);
  if (status === 401 || /not logged in|log ?in again|unauthori[sz]ed|sign in/i.test(said)) return new EngineError("auth", "Codex isn't signed in. Run codex login in a terminal, then test again.");
  if (status === 429 || /usage limit|rate limit|too many requests/i.test(said)) return new EngineError("rate_limited", `Codex says to wait: ${said}`);
  return new EngineError(status ? `api_${status}` : "api_error", said.slice(0, 400));
}

/** The models Codex lists for this sign-in, most preferred first, from its own catalog (`codex debug models`). */
export function catalogModels(json: string): string[] {
  try {
    const j = JSON.parse(json) as { models?: { slug?: string; visibility?: string; priority?: number }[] };
    return (j.models ?? [])
      .filter((m) => typeof m.slug === "string" && m.visibility === "list")
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
      .map((m) => m.slug!);
  } catch {
    return [];
  }
}

// Kept a few minutes per binary: the catalog changes with Codex's updates, not between calls.
const g = globalThis as { __qalamCodexModels?: { bin: string; at: number; models: string[] } };
const CATALOG_MS = 10 * 60_000;

/** The models this Codex offers (empty when it can't say). */
export async function codexModels(bin = codexBin()): Promise<string[]> {
  const kept = g.__qalamCodexModels;
  if (kept && kept.bin === bin && Date.now() - kept.at < CATALOG_MS && kept.models.length) return kept.models;
  const models = await new Promise<string[]>((resolve) =>
    execFile(bin, ["debug", "models"], { env: codexEnv(), timeout: 15_000, maxBuffer: 32 * 1024 * 1024 }, (_e, out) => resolve(catalogModels(String(out ?? "")))),
  );
  g.__qalamCodexModels = { bin, at: Date.now(), models };
  return models;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** One `codex exec`: the prompt on stdin, the call's instructions and schema as files in a folder of its own, removed after. */
async function runCodex(o: { prompt: string; instructions: string; schema: Record<string, unknown> | null; images: { media: string; data: string }[]; model: string; effort: string; signal: AbortSignal }): Promise<CodexOutcome> {
  const dir = await mkdtemp(path.join(tmpdir(), "qalam-codex-"));
  try {
    const work = path.join(dir, "empty");
    await mkdir(work);
    const instructions = path.join(dir, "instructions.md");
    await writeFile(instructions, o.instructions);
    const schema = o.schema ? path.join(dir, "schema.json") : null;
    if (schema) await writeFile(schema, JSON.stringify(strictSchema(o.schema!)));
    const images = await Promise.all(
      o.images.map(async (img, i) => {
        const file = path.join(dir, `image-${i + 1}.${EXT[img.media] ?? "png"}`);
        await writeFile(file, Buffer.from(img.data, "base64"));
        return file;
      }),
    );
    const args = codexArgs({ dir: work, instructions, schema, images, model: o.model, effort: o.effort });
    return await new Promise<CodexOutcome>((resolve, reject) => {
      const child = spawn(/*turbopackIgnore: true*/ codexBin(), args, { cwd: work, env: codexEnv(), stdio: ["pipe", "pipe", "pipe"] });
      const lines: string[] = [];
      let stderr = "";
      const stop = () => child.kill("SIGTERM");
      const timer = setTimeout(stop, 10 * 60_000);
      o.signal.addEventListener("abort", stop, { once: true });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new EngineError("codex_missing", `Couldn't start Codex (${e.message}). Install Codex or the ChatGPT app, then sign in with codex login.`));
      });
      child.stdin.on("error", () => {});
      child.stdin.end(o.prompt);
      child.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString("utf8")).slice(-2000)));
      createInterface({ input: child.stdout }).on("line", (l) => lines.push(l));
      child.on("close", (code) => {
        clearTimeout(timer);
        o.signal.removeEventListener("abort", stop);
        const out = readCodexEvents(lines);
        if (code !== 0 && !out.error && out.text === null) out.error = stderr.trim().split("\n").pop() || `Codex stopped (${code}).`;
        resolve(out);
      });
    });
  } finally {
    void rm(dir, { recursive: true, force: true });
  }
}

const asking = (schema: Record<string, unknown>) => `Respond with only a JSON object (no prose, no code fence) that validates against this JSON Schema:\n${JSON.stringify(schema)}`;

export const codexAdapter: EngineAdapter = async ({ opts, model, send, signal }) => {
  const picked = model || (await codexModels())[0] || "";
  const instructions = (Array.isArray(opts.system) ? opts.system : [opts.system]).join("\n\n");
  const { text, images } = splitBlocks(opts.content);
  const effort = opts.effort;
  let schema: Record<string, unknown> | null = opts.schema;
  send({ type: "progress", tokens: 0 });
  const ask = async (prompt: string) => {
    let out = await runCodex({ prompt: schema ? prompt : `${prompt}\n\n${asking(opts.schema)}`, instructions, schema, images, model: picked, effort, signal });
    if (out.error && schema && codexError(out.error, picked).code === "schema") {
      // The schema can't be held as Codex's output format: it goes in the prompt, as words.
      schema = null;
      out = await runCodex({ prompt: `${prompt}\n\n${asking(opts.schema)}`, instructions, schema, images, model: picked, effort, signal });
    }
    if (out.usage) reportUsage(fromCodexUsage(out.usage, picked || "codex", opts.kind));
    if (out.text === null) throw codexError(out.error ?? "Codex gave no answer.", picked);
    return out.text;
  };
  let answer = await ask(text);
  let checked = checkAnswer(answer, opts.schema);
  if (!checked.ok) {
    // One repair turn: the answer it gave, what didn't hold, and the call again.
    send({ type: "progress", tokens: 0, note: "repair" });
    answer = await ask(`${text}\n\nYour previous answer:\n${answer}\n\n${repairPrompt(checked.problems)}`);
    checked = checkAnswer(answer, opts.schema);
  }
  if (!checked.ok) throw new EngineError("parse", `Codex's answer didn't match what Qalam asked for: ${checked.problems.join("; ")}`);
  send({ type: "result", data: checked.data, model: picked || "codex" });
};

registerAdapter("codex", codexAdapter);
