import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setEngineState } from "../engine";
import { structured, type CallOpts } from "../server";
import { onUsage } from "../usage";
import type { UsageEntry } from "../usage-shared";
import { catalogModels, codexArgs, codexEnv, codexError, readCodexEvents } from "./codex";

let dir: string;
let out: string;
let used: UsageEntry[];

/** A stand-in `codex exec`: records what it was given, and answers by the model it's asked for. */
const STAND_IN = `#!${process.execPath}
const fs = require("fs");
const args = process.argv.slice(2);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
let stdin = "";
process.stdin.on("data", (d) => (stdin += d)).on("end", () => {
  const model = val("-m");
  const schemaFile = val("--output-schema");
  const instr = args.find((a) => a.startsWith("model_instructions_file="));
  const images = args.flatMap((a, i) => (a === "--image" ? [args[i + 1]] : []));
  fs.appendFileSync(process.env.STANDIN_OUT, JSON.stringify({
    args, stdin, model, cwd: process.cwd(),
    schema: schemaFile ? JSON.parse(fs.readFileSync(schemaFile, "utf8")) : null,
    instructions: instr ? fs.readFileSync(JSON.parse(instr.slice("model_instructions_file=".length)), "utf8") : null,
    images: images.map((f) => fs.statSync(f).size),
    openai: process.env.OPENAI_API_KEY ?? null,
  }) + "\\n");
  const say = (o) => console.log(JSON.stringify(o));
  say({ type: "thread.started", thread_id: "t" });
  say({ type: "turn.started" });
  const fail = (e) => { say({ type: "error", message: JSON.stringify(e) }); say({ type: "turn.failed", error: { message: JSON.stringify(e) } }); process.exit(1); };
  if (model === "missing") fail({ type: "error", status: 400, error: { message: "The 'missing' model is not supported when using Codex with a ChatGPT account.", code: "model_not_found" } });
  if (model === "refuse-schema" && schemaFile) fail({ type: "error", status: 400, error: { message: "Invalid schema for response_format", code: "invalid_json_schema" } });
  const answer = model === "repair" && !stdin.includes("Your previous answer") ? '{"kind":"wish"}' : '{"kind":"need","note":null}';
  say({ type: "item.completed", item: { id: "i", type: "agent_message", text: answer } });
  say({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 } });
});
`;

const schema = { type: "object", additionalProperties: false, properties: { kind: { type: "string", enum: ["need", "idea"] }, note: { type: "string" } }, required: ["kind"] };
const call = (content: { type: string; text?: string; source?: unknown }[] = [{ type: "text", text: "Read it." }]): CallOpts => ({ system: ["Stable part.", "This call."], content: content as CallOpts["content"], schema, effort: "low", kind: "jobs" });
const records = async () => (await readFile(out, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-codex-test-"));
  const bin = path.join(dir, "codex");
  await writeFile(bin, STAND_IN);
  await chmod(bin, 0o755);
  setEngineState({ codex: bin });
});
afterAll(async () => {
  setEngineState({ kind: "api", models: undefined, codex: undefined });
  delete process.env.STANDIN_OUT;
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  out = path.join(dir, `out-${Math.random().toString(36).slice(2)}.jsonl`);
  await writeFile(out, "");
  process.env.STANDIN_OUT = out;
  used = [];
  onUsage((e) => used.push(e));
});

describe("Codex, signed in with ChatGPT", () => {
  it("runs from an empty folder with the call's instructions in place of its own, its tools off, the schema made strict, and the plan paying", async () => {
    process.env.OPENAI_API_KEY = "sk-not-for-codex";
    setEngineState({ kind: "codex", models: { decide: "gpt-test" } });
    try {
      expect(await structured(call())).toEqual({ data: { kind: "need" }, model: "gpt-test" });
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
    const [r] = await records();
    expect(r).toMatchObject({ model: "gpt-test", stdin: "Read it.", instructions: "Stable part.\n\nThis call.", openai: null });
    expect(r.schema).toEqual({ type: "object", additionalProperties: false, properties: { kind: { type: "string", enum: ["need", "idea"] }, note: { type: ["string", "null"] } }, required: ["kind", "note"] });
    expect(r.args).toEqual(expect.arrayContaining(["exec", "--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "read-only", "shell_tool", "apps", "skills.include_instructions=false", 'web_search="disabled"', 'model_reasoning_effort="low"']));
    expect(path.basename(String(r.cwd))).toBe("empty");
    expect(used).toMatchObject([{ engine: "codex", model: "gpt-test", kind: "jobs", input: 100, cacheRead: 40, output: 7, cost: null }]);
  });

  it("gives it pictures as files, each named where it was", async () => {
    setEngineState({ kind: "codex", models: { decide: "gpt-test" } });
    await structured(call([{ type: "text", text: "Read this screen." }, { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("not really a png").toString("base64") } }]));
    const [r] = await records();
    expect(r).toMatchObject({ stdin: "Read this screen.\n\n[Image 1]", images: [16] });
  });

  it("puts the schema in the prompt when Codex won't hold it, and gives one repair turn to an answer that doesn't hold", async () => {
    setEngineState({ kind: "codex", models: { decide: "refuse-schema" } });
    expect((await structured(call())).data).toEqual({ kind: "need" });
    let rs = await records();
    expect(rs.map((r) => !!r.schema)).toEqual([true, false]);
    expect(String(rs[1].stdin)).toContain("validates against this JSON Schema");

    await writeFile(out, "");
    setEngineState({ kind: "codex", models: { decide: "repair" } });
    expect((await structured(call())).data).toEqual({ kind: "need" });
    rs = await records();
    expect(rs).toHaveLength(2);
    expect(String(rs[1].stdin)).toContain("Your previous answer:\n{\"kind\":\"wish\"}");
  });

  it("says what's wrong in words: a model this sign-in can't run, or no Codex at all", async () => {
    setEngineState({ kind: "codex", models: { decide: "missing" } });
    await expect(structured(call())).rejects.toThrow("Codex can't run missing with this sign-in. Pick another in Connections.");
    setEngineState({ kind: "codex", models: { decide: "gpt-test" }, codex: path.join(dir, "no-such-codex") });
    await expect(structured(call())).rejects.toThrow("Couldn't start Codex");
    setEngineState({ codex: path.join(dir, "codex") });
  });

  it("reads its events, its errors and its model catalog", () => {
    expect(readCodexEvents(['{"type":"turn.started"}', '{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}', '{"type":"turn.completed","usage":{"input_tokens":3}}', "not json"])).toEqual({ text: "{}", usage: { input_tokens: 3 }, searches: [], error: null });
    expect(readCodexEvents(['{"type":"item.completed","item":{"type":"web_search","action":{"type":"search","queries":["slots sold out reddit","more"]}}}']).searches).toEqual(["slots sold out reddit"]);
    expect(readCodexEvents(['{"type":"error","message":"first"}', '{"type":"turn.failed","error":{"message":"failed"}}']).error).toBe("failed");
    expect(codexError('{"status":401,"error":{"message":"Unauthorized"}}', "m").code).toBe("auth");
    expect(codexError('{"status":429,"error":{"message":"You have hit your usage limit"}}', "m").code).toBe("rate_limited");
    expect(codexError("something else", "m")).toMatchObject({ code: "api_error", message: "something else" });
    expect(catalogModels(JSON.stringify({ models: [{ slug: "hidden", visibility: "hide", priority: 1 }, { slug: "b", visibility: "list", priority: 9 }, { slug: "a", visibility: "list", priority: 5 }] }))).toEqual(["a", "b"]);
    expect(catalogModels("nope")).toEqual([]);
    expect(codexEnv({ PATH: "/bin", OPENAI_API_KEY: "x", OPENAI_BASE_URL: "y", CODEX_API_KEY: "z", NODE_OPTIONS: "--x", HOME: "/h" })).toEqual({ PATH: "/bin", HOME: "/h" });
    expect(codexArgs({ dir: "/d", instructions: "/i.md", schema: null, images: [], model: "", effort: "high", search: true })).toEqual(expect.arrayContaining(['web_search="live"', 'model_instructions_file="/i.md"']));
    expect(codexArgs({ dir: "/d", instructions: "/i.md", schema: null, images: [], model: "", effort: "high" })).not.toContain("-m");
  });
});
