import { COMPAT_KINDS, type CompatKind } from "../engine-kinds";
import { baseOf, keyOf } from "../engine";
import { toChatParts, needsVision } from "../content";
import { fromChatUsage, reportUsage } from "../usage";
import { checkAnswer, repairPrompt, strictSchema } from "../validate";
import { EngineError, registerAdapter, type EngineAdapter } from "./index";
import { PRESETS } from "./presets";

/*
 * The engines that speak OpenAI's chat API (OpenAI, Gemini and OpenRouter by key; Ollama and LM
 * Studio on this computer), as one adapter. One request with the call's schema as the answer's
 * format; a provider that won't take the schema gets it in the prompt instead (as the Claude API
 * path does). The answer is checked against the schema by code (src/ai/validate.ts), and what
 * doesn't hold gets one repair turn. Server-only: keys are here.
 */

type Message = { role: "system" | "user" | "assistant"; content: unknown };

interface ChatAnswer {
  text: string;
  model?: string;
  usage?: Parameters<typeof fromChatUsage>[0];
}

// The fetch to use: the platform's, replaced in tests.
const g = globalThis as { __qalamChatFetch?: typeof fetch };
export const setChatFetch = (f: typeof fetch | undefined) => void (g.__qalamChatFetch = f);
const fetcher = () => g.__qalamChatFetch ?? fetch;

/** Where an engine answers: the address picked for it, else its usual one. */
export const baseFor = (kind: CompatKind) => baseOf(kind) ?? PRESETS[kind].base;

/** The request's headers: the key, and what OpenRouter asks callers to say about themselves. */
function headers(kind: CompatKind, key: string | null): Record<string, string> {
  return { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...(kind === "openrouter" ? { "http-referer": "https://github.com/ahmedamr-r/qalam-studio", "x-title": "Qalam Studio" } : {}) };
}

/** What went wrong, as the codes the window knows. */
async function failed(kind: CompatKind, res: Response): Promise<EngineError> {
  const body = await res.text().catch(() => "");
  const said = (() => {
    try {
      const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
      return typeof j.error === "string" ? j.error : (j.error?.message ?? j.message ?? "");
    } catch {
      return body.slice(0, 300);
    }
  })();
  const label = PRESETS[kind].label;
  if (res.status === 401 || res.status === 403) return new EngineError("auth", `${label} didn't accept the key${said ? `: ${said}` : "."}`);
  if (res.status === 429) return new EngineError("rate_limited", `${label} says to slow down${said ? `: ${said}` : "."}`);
  if (res.status === 404) return new EngineError("no_model", `${label} doesn't have that model${said ? `: ${said}` : "."} Pick another in Connections.`);
  return new EngineError(`api_${res.status}`, said || `${label} answered ${res.status}.`);
}

/** Whether a 400 is about the answer's format (the provider won't take the schema). */
const schemaRefused = (status: number, text: string) => status === 400 && /response_format|json_schema|schema|structured/i.test(text);

/** One chat request; `schema` asks for the answer in it (a provider that refuses gets it in the prompt). */
async function chat(kind: CompatKind, o: { model: string; messages: Message[]; schema: Record<string, unknown> | null; maxTokens: number; signal: AbortSignal }): Promise<ChatAnswer> {
  const preset = PRESETS[kind];
  const key = preset.key ? keyOf(kind) : null;
  if (preset.key && !key) throw new EngineError("auth", `There's no ${preset.label} key here. Paste one in Connections.`);
  const send = async (messages: Message[], schema: Record<string, unknown> | null) =>
    fetcher()(`${baseFor(kind)}/chat/completions`, {
      method: "POST",
      headers: headers(kind, key),
      signal: AbortSignal.any([o.signal, AbortSignal.timeout(10 * 60_000)]),
      body: JSON.stringify({
        model: o.model,
        messages,
        ...(preset.completionTokens ? { max_completion_tokens: o.maxTokens } : { max_tokens: o.maxTokens }),
        ...(schema ? { response_format: { type: "json_schema", json_schema: { name: "answer", schema: preset.strict ? strictSchema(schema) : schema, strict: preset.strict } } } : {}),
        ...preset.extra,
      }),
    }).catch((e: unknown) => {
      if (o.signal.aborted) throw e;
      throw new EngineError("offline", preset.key ? `Couldn't reach ${preset.label} from this computer.` : `${preset.label} isn't answering at ${baseFor(kind)}. Is it running?`);
    });
  let res = await send(o.messages, o.schema);
  if (!res.ok && o.schema && schemaRefused(res.status, await res.clone().text())) {
    // The provider won't take the schema as a format: it goes in the prompt, as words.
    const last = o.messages[o.messages.length - 1];
    const asked = { ...last, content: [...(Array.isArray(last.content) ? last.content : [{ type: "text", text: String(last.content) }]), { type: "text", text: `Respond with only a JSON object (no prose, no code fence) that validates against this JSON Schema:\n${JSON.stringify(o.schema)}` }] };
    res = await send([...o.messages.slice(0, -1), asked], null);
  }
  if (!res.ok) throw await failed(kind, res);
  const j = (await res.json()) as { model?: string; choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[]; usage?: ChatAnswer["usage"] };
  const choice = j.choices?.[0];
  if (choice?.message?.refusal) throw new EngineError("refusal", "The model declined this request.");
  if (choice?.finish_reason === "length") throw new EngineError("max_tokens", "The response was cut off. Try a simpler brief.");
  return { text: choice?.message?.content ?? "", model: j.model, usage: j.usage };
}

/** The adapter for one of these engines. */
export function compatAdapter(kind: CompatKind): EngineAdapter {
  return async ({ opts, model, send, signal }) => {
    const label = PRESETS[kind].label;
    if (!model) throw new EngineError("no_model", `Pick a model for ${label} in Connections.`);
    const system = (Array.isArray(opts.system) ? opts.system : [opts.system]).join("\n\n");
    const messages: Message[] = [
      { role: "system", content: system },
      { role: "user", content: toChatParts(opts.content) },
    ];
    send({ type: "progress", tokens: 0 });
    const ask = async (m: Message[]) => {
      try {
        return await chat(kind, { model, messages: m, schema: opts.schema, maxTokens: opts.maxTokens ?? 16000, signal });
      } catch (e) {
        // A model that can't see pictures can't answer a call that sends them.
        if (e instanceof EngineError && needsVision(opts.content) && /image|vision|multimodal/i.test(e.message)) throw new EngineError("no_vision", `${model} can't read pictures. Pick a model that can, in Connections.`);
        throw e;
      }
    };
    let answer = await ask(messages);
    reportUsage(fromChatUsage(answer.usage, kind, answer.model ?? model, opts.kind));
    let checked = checkAnswer(answer.text, opts.schema);
    if (!checked.ok) {
      // One repair turn: what didn't hold, and the answer again.
      send({ type: "progress", tokens: 0, note: "repair" });
      answer = await ask([...messages, { role: "assistant", content: answer.text }, { role: "user", content: repairPrompt(checked.problems) }]);
      reportUsage(fromChatUsage(answer.usage, kind, answer.model ?? model, opts.kind));
      checked = checkAnswer(answer.text, opts.schema);
    }
    if (!checked.ok) throw new EngineError("parse", `${label}'s answer didn't match what Qalam asked for: ${checked.problems.join("; ")}`);
    send({ type: "result", data: checked.data, model: answer.model ?? model });
  };
}

/** The models an engine offers (its own list), for Connections to pick from. */
export async function listModels(kind: CompatKind, key?: string | null): Promise<string[]> {
  const preset = PRESETS[kind];
  const k = key ?? (preset.key ? keyOf(kind) : null);
  const res = await fetcher()(`${baseFor(kind)}/models`, { headers: headers(kind, k), signal: AbortSignal.timeout(preset.key ? 20_000 : 3_000) }).catch(() => {
    throw new EngineError("offline", preset.key ? `Couldn't reach ${preset.label} from this computer.` : `${preset.label} isn't answering at ${baseFor(kind)}. Is it running?`);
  });
  if (!res.ok) throw await failed(kind, res);
  const j = (await res.json()) as { data?: { id?: string }[] };
  return [...new Set((j.data ?? []).map((m) => (m.id ?? "").replace(/^models\//, "")).filter(Boolean))].sort();
}

for (const kind of COMPAT_KINDS) registerAdapter(kind, compatAdapter(kind));
