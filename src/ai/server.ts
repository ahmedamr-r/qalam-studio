import Anthropic from "@anthropic-ai/sdk";
import { orOnModelError, streamViaCli } from "./cli";
import { runResearch, type ResearchRequest } from "./research";
import { researchBlock } from "./research-shared";
import { deltaBatcher } from "./deltas";
import { adapterFor, streamAdapter } from "./engines";
import "./engines/compat";
import { PRESETS } from "./engines/presets";
import { isCompat } from "./engine-kinds";
import { apiKey, backend, keyOf, modelOf, readModelFailed, tierModel, tierNow } from "./engine";
import { supportsFallback, type CallKind } from "./models";
import { fromApiUsage, reportUsage } from "./usage";

/**
 * The engine, read at every call (src/ai/engine.ts): "cli" runs the user's own signed-in `claude`
 * (their Claude subscription), "api" a Claude API key. Switching in Connections needs no restart.
 */
export { backend } from "./engine";

export function aiConfigured(): boolean {
  const b = backend();
  if (b === "cli") return true;
  // Another engine: its key, or none needed for a model on this computer.
  if (isCompat(b)) return !PRESETS[b].key || !!keyOf(b);
  if (b !== "api") return !!adapterFor(b);
  return !!getClient();
}

// Built once; it asks for the key before each request, so a new one is used from the next call.
let client: Anthropic | null = null;
export function getClient(): Anthropic | null {
  if (!apiKey()) return null;
  client ??= new Anthropic({ apiKey: async () => apiKey() ?? "" });
  return client;
}

// ---------------------------------------------------------------------------
// Tiny per-instance rate limit (the real spend cap lives in the Anthropic console).

const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = Number(process.env.RATE_LIMIT_PER_10_MIN ?? 20);

export function rateLimited(req: Request): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  return list.length > MAX_HITS;
}

export function jsonError(status: number, code: string, message: string) {
  return Response.json({ error: code, message }, { status });
}

// ---------------------------------------------------------------------------

type Content = Anthropic.Beta.Messages.BetaContentBlockParam[];

export interface CallOpts {
  /** One string, or blocks cached separately (stable prefix first, per-request block last). */
  system: string | string[];
  content: Content;
  schema: Record<string, unknown>;
  effort: "low" | "medium" | "high" | "xhigh";
  maxTokens?: number;
  /** What the call is for: it picks the model (src/ai/models.ts) and labels its usage. None: it decides. */
  kind?: CallKind;
  /** Per-call model override (an environment variable of the route's own). */
  model?: string;
  /** Look things up with these connectors first, and add the notes to the content. */
  research?: ResearchRequest;
  /** Stream what the model writes (`delta` lines: the JSON so far, summarized thinking) as well. */
  deltas?: boolean;
}

/** Models with adaptive thinking, whose thinking text is empty unless summaries are asked for. */
const ADAPTIVE_MODELS = /^claude-(opus-5|fable-5|sonnet-5|opus-4-[678])/;

/**
 * Structured-output call streamed to the browser as NDJSON:
 *   {"type":"progress","tokens":123}   (periodic)
 *   {"type":"result","data":{...}}     (final, schema-valid JSON)
 *   {"type":"error","error":"...","message":"..."}
 * With `deltas`, also {"type":"delta","kind":"json"|"thinking"|"text"|"reset","text":"…"}.
 * With `research`, first:
 *   {"type":"activity","label":"Searching the web: …"}   (each lookup)
 *   {"type":"research","research":{notes,sources,steps}}
 */
export function streamStructured(opts: CallOpts): Response {
  if (opts.research?.connectors.length) return streamWithResearch(opts, opts.research);
  const model = opts.model ?? modelOf(opts.kind);
  if (backend() === "cli") {
    // A read call Claude Code can't run on its model here runs once more on the decide model, and so do later ones.
    const decide = tierModel("decide");
    if (opts.model || tierNow(opts.kind) !== "read" || model === decide) return streamViaCli(opts, model);
    return orOnModelError(streamViaCli(opts, model), () => {
      console.warn(`[qalam] Claude Code can't use ${model} here; read calls run on ${decide} from now on`);
      readModelFailed(model);
      return streamViaCli(opts, decide);
    });
  }
  // Any engine that isn't Claude: its adapter (src/ai/engines).
  const adapter = adapterFor(backend());
  if (adapter) return streamAdapter(adapter, opts, model);
  const anthropic = getClient()!;
  const system = (Array.isArray(opts.system) ? opts.system : [opts.system]).map((text) => ({ type: "text" as const, text, cache_control: { type: "ephemeral" as const } }));
  const encoder = new TextEncoder();
  let closed = false;
  let live: { abort(): void } | undefined;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      // The browser may go away mid-stream (Stop): after that, nothing more is sent.
      const send = (o: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      };
      const deltas = opts.deltas ? deltaBatcher(send) : null;
      try {
        const useFallback = supportsFallback(model);
        const start = (constrained: boolean) =>
          anthropic.beta.messages.stream({
            model,
            max_tokens: opts.maxTokens ?? 32000,
            ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
            ...(deltas && ADAPTIVE_MODELS.test(model) ? { thinking: { type: "adaptive" as const, display: "summarized" as const } } : {}),
            system,
            output_config: constrained
              ? { effort: opts.effort, format: { type: "json_schema", schema: opts.schema } }
              : { effort: opts.effort },
            messages: [
              {
                role: "user",
                content: constrained
                  ? opts.content
                  : [...opts.content, { type: "text", text: `Respond with only a JSON object (no prose, no code fence) that validates against this JSON Schema:\n${JSON.stringify(opts.schema)}` }],
              },
            ],
          });
        let chars = 0;
        let last = 0;
        const tick = (n: number) => {
          chars += n;
          const now = Date.now();
          if (now - last > 400) {
            last = now;
            send({ type: "progress", tokens: Math.round(chars / 4) });
          }
        };
        const run = async (constrained: boolean) => {
          const stream = start(constrained);
          live = stream;
          stream.on("text", (d) => {
            tick(d.length);
            deltas?.push("json", d);
          });
          stream.on("thinking", (d) => {
            tick(d.length);
            deltas?.push("thinking", d);
          });
          return stream.finalMessage();
        };
        let msg;
        try {
          msg = await run(true);
        } catch (e) {
          // If the API rejects the (large) schema itself, fall back to prompt-level JSON once.
          if (e instanceof Anthropic.BadRequestError && /schema|output_config|format|grammar/i.test(e.message)) {
            send({ type: "progress", tokens: 0, note: "schema-fallback" });
            console.warn("[qalam] the API rejected the schema; retrying with prompt-level JSON");
            deltas?.reset();
            msg = await run(false);
          } else throw e;
        }
        deltas?.flush();
        if (msg.stop_reason === "refusal") {
          send({ type: "error", error: "refusal", message: "The model declined this request." });
        } else if (msg.stop_reason === "max_tokens") {
          send({ type: "error", error: "max_tokens", message: "The response was cut off. Try a simpler brief." });
        } else {
          const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
          const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
          const data = JSON.parse(json);
          reportUsage(fromApiUsage(msg.usage, msg.model, opts.kind));
          send({ type: "result", data, usage: msg.usage, model: msg.model });
        }
      } catch (e) {
        if (closed) return;
        deltas?.flush();
        let code = "api_error";
        let message = e instanceof Error ? e.message : String(e);
        if (e instanceof Anthropic.RateLimitError) code = "rate_limited";
        else if (e instanceof Anthropic.AuthenticationError) code = "auth";
        else if (e instanceof Anthropic.BadRequestError) code = "bad_request";
        else if (e instanceof Anthropic.APIError) code = `api_${e.status}`;
        else if (e instanceof SyntaxError) {
          code = "parse";
          message = "Model output was not valid JSON.";
        }
        send({ type: "error", error: code, message });
      } finally {
        if (!closed) controller.close();
        closed = true;
      }
    },
    cancel() {
      closed = true;
      live?.abort();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

/** The research step's engine and model, read at each call: RESEARCH_MODEL, else the read tier's (retried on the decide model where Claude Code can't use it). */
function researchDeps() {
  const model = process.env.RESEARCH_MODEL || modelOf("research");
  const decide = tierModel("decide");
  return { backend: backend(), client: getClient(), model, ...(!process.env.RESEARCH_MODEL && model !== decide ? { retry: decide } : {}) };
}

/** The research step on its own, for the core (what others aim for): its notes and sources, or why there are none. */
export const research = (req: ResearchRequest, emit: (label: string) => void, signal: AbortSignal) => runResearch(req, researchDeps(), emit, signal);

/** Run the research step (streaming what it looks up), then the structured call with its notes. */
function streamWithResearch(opts: CallOpts, research: ResearchRequest): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let inner: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      };
      try {
        const info = await runResearch(research, researchDeps(), (label) => send({ type: "activity", label }), abort.signal);
        if (info) send({ type: "research", research: info });
        const content: Content = info?.notes ? [...opts.content, { type: "text", text: researchBlock(info.notes) }] : opts.content;
        inner = streamStructured({ ...opts, content, research: undefined }).body!.getReader();
        for (;;) {
          const { value, done } = await inner.read();
          if (done || abort.signal.aborted) break;
          controller.enqueue(value);
        }
      } catch (e) {
        send({ type: "error", error: "api_error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        if (!abort.signal.aborted) controller.close();
      }
    },
    cancel() {
      abort.abort();
      void inner?.cancel();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

/**
 * Research on its own (no structured call after it), streamed like the others:
 *   {"type":"activity","label":"…"} per lookup, then {"type":"result","data":ResearchInfo}.
 * A lookup that finds nothing still ends in a result, with `error` or empty notes.
 */
/**
 * A structured-output call read here to its end: the core's own calls (a review of the
 * organization), where no window reads the stream. Throws the stream's error.
 */
export async function structured<T>(opts: CallOpts): Promise<{ data: T; model?: string }> {
  return readStructured<T>(streamStructured(opts));
}

/** A structured call's NDJSON read to its result (or its error, thrown). */
export async function readStructured<T>(res: Response): Promise<{ data: T; model?: string }> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as { type: string; data?: unknown; model?: string; error?: string; message?: string };
      if (msg.type === "result") return { data: msg.data as T, model: msg.model };
      if (msg.type === "error") throw new Error(msg.message ?? msg.error ?? "Qalam AI couldn't answer.");
    }
  }
  throw new Error("The response ended early.");
}

export function streamResearch(research: ResearchRequest): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      };
      try {
        const info = await runResearch(research, researchDeps(), (label) => send({ type: "activity", label }), abort.signal);
        const none = research.purpose === "import" ? "None of those tools is connected here." : "Web search isn't available here, so no libraries were looked up.";
        send({ type: "result", data: info ?? { notes: "", sources: [], steps: [], error: none }, model: info?.model });
      } catch (e) {
        send({ type: "error", error: "api_error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        if (!abort.signal.aborted) controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
