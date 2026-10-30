import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setEngineState } from "../engine";
import { structured } from "../server";
import { onUsage } from "../usage";
import type { UsageEntry } from "../usage-shared";
import { listModels, setChatFetch } from "./compat";
import { loopbackBase } from "./presets";

const schema = { type: "object", additionalProperties: false, properties: { kind: { type: "string", enum: ["need", "idea"] } }, required: ["kind"] };
const call = { system: ["Stable part.", "This call."], content: [{ type: "text" as const, text: "Read it." }], schema, effort: "low" as const, kind: "jobs" as const };

type Sent = { url: string; body: Record<string, unknown>; auth: string | null };
let sent: Sent[];
let answers: (Response | (() => Response))[];
let used: UsageEntry[];
const reply = (content: string, usage = { prompt_tokens: 10, completion_tokens: 3 }) => Response.json({ model: "served-model", choices: [{ message: { content }, finish_reason: "stop" }], usage });

beforeEach(() => {
  sent = [];
  answers = [];
  used = [];
  onUsage((e) => used.push(e));
  setChatFetch(async (url, init) => {
    sent.push({ url: String(url), body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}, auth: new Headers(init?.headers).get("authorization") });
    const next = answers.shift() ?? reply("{}");
    return typeof next === "function" ? next() : next;
  });
});
afterEach(() => {
  setChatFetch(undefined);
  setEngineState({ kind: "api", models: undefined, keys: undefined, bases: undefined });
});

describe("engines that speak OpenAI's chat API", () => {
  it("asks OpenAI with its key and a strict schema, and keeps what holds", async () => {
    setEngineState({ kind: "openai", keys: { openai: "sk-test-0000000000000000" }, models: { decide: "gpt-test" } });
    answers.push(reply('{"kind":"need"}'));
    expect(await structured(call)).toEqual({ data: { kind: "need" }, model: "served-model" });
    expect(sent[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sent[0].auth).toBe("Bearer sk-test-0000000000000000");
    expect(sent[0].body).toMatchObject({ model: "gpt-test", max_completion_tokens: 16000, response_format: { type: "json_schema", json_schema: { name: "answer", schema, strict: true } } });
    expect(sent[0].body.messages).toEqual([
      { role: "system", content: "Stable part.\n\nThis call." },
      { role: "user", content: [{ type: "text", text: "Read it." }] },
    ]);
    expect(used).toMatchObject([{ engine: "openai", model: "served-model", kind: "jobs", input: 10, output: 3, cost: null }]);
  });

  it("puts the schema in the prompt when a provider won't take it as a format", async () => {
    setEngineState({ kind: "gemini", keys: { gemini: "g-key-00000000000000000" }, models: { decide: "gemini-test" } });
    answers.push(Response.json({ error: { message: "Invalid JSON payload: response_format.json_schema is not supported" } }, { status: 400 }), reply('{"kind":"idea"}'));
    expect((await structured(call)).data).toEqual({ kind: "idea" });
    expect(sent[1].body.response_format).toBeUndefined();
    expect(JSON.stringify(sent[1].body.messages)).toContain("validates against this JSON Schema");
  });

  it("gives one repair turn to an answer that doesn't hold, then gives up saying why", async () => {
    setEngineState({ kind: "ollama", models: { decide: "qwen3" } });
    answers.push(reply('<think>hmm</think>{"kind":"wish"}'), reply('{"kind":"need"}'));
    expect((await structured(call)).data).toEqual({ kind: "need" });
    expect(sent[0].url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(sent[0].auth).toBeNull();
    expect(JSON.stringify(sent[1].body.messages)).toContain("didn't match the schema");
    expect(used.map((u) => u.cost)).toEqual([0, 0]);
    answers.push(reply("nope"), reply('{"kind":"wish"}'));
    await expect(structured(call)).rejects.toThrow("Ollama's answer didn't match what Qalam asked for");
  });

  it("says what's wrong with the key, the model or the server, in words", async () => {
    setEngineState({ kind: "openrouter", keys: { openrouter: "or-key-000000000000000" }, models: { decide: "some/model" } });
    answers.push(Response.json({ error: { message: "No auth credentials found" } }, { status: 401 }));
    await expect(structured(call)).rejects.toThrow("OpenRouter didn't accept the key: No auth credentials found");
    setEngineState({ kind: "lmstudio", models: {} });
    await expect(structured(call)).rejects.toThrow("Pick a model for LM Studio in Connections.");
    setEngineState({ kind: "openai", keys: {}, models: { decide: "gpt-test" } });
    await expect(structured(call)).rejects.toThrow("There's no OpenAI key here.");
  });

  it("lists an engine's models from its own list", async () => {
    setEngineState({ kind: "gemini", keys: { gemini: "g-key-00000000000000000" } });
    answers.push(Response.json({ data: [{ id: "models/gemini-b" }, { id: "models/gemini-a" }] }));
    expect(await listModels("gemini")).toEqual(["gemini-a", "gemini-b"]);
    expect(sent[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/models");
  });

  it("takes a model on this computer only at a local address", () => {
    expect(loopbackBase("http://127.0.0.1:11434/v1/")).toBe("http://127.0.0.1:11434/v1");
    expect(loopbackBase("http://localhost:1234/v1")).toBe("http://localhost:1234/v1");
    expect(loopbackBase("http://192.168.1.4:11434/v1")).toBeNull();
    expect(loopbackBase("https://example.com/v1")).toBeNull();
  });
});
