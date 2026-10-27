import Anthropic from "@anthropic-ai/sdk";
import { streamViaCli } from "./cli";
import { runResearch, type ResearchRequest } from "./research";
import { researchBlock } from "./research-shared";
import { deltaBatcher } from "./deltas";

/** Default is Claude Opus 5.5 for every step; override with CLAUDE_MODEL. */
export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

/**
 * "cli" routes calls through the signed-in `claude` CLI (your Claude subscription) for local
 * development. Never on Vercel: a public deployment must use its own API key.
 */
export const BACKEND: "api" | "cli" = process.env.AI_BACKEND === "cli" && !process.env.VERCEL ? "cli" : "api";

export function aiConfigured(): boolean {
  return BACKEND === "cli" || !!getClient();
}

let client: Anthropic | null = null;
export function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic();
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
  /** Per-call model override (e.g. Opus for extraction). */
  model?: string;
  /** Look things up with these connectors first, and add the notes to the content. */
  research?: ResearchRequest;
  /** Stream what the model writes (`delta` lines: the JSON so far, summarized thinking) as well. */
  deltas?: boolean;
}

/** Server-side fallback on refusals is only offered for these models. */
const FALLBACK_MODELS = /^claude-(opus-5|fable-5)/;
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
  const model = opts.model ?? MODEL;
  if (BACKEND === "cli") return streamViaCli(opts, model);
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
        const useFallback = FALLBACK_MODELS.test(model);
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
          send({ type: "result", data: JSON.parse(json), usage: msg.usage, model: msg.model });
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

/** The research step's model: the default model unless overridden. */
const RESEARCH_MODEL = process.env.RESEARCH_MODEL || MODEL;

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
        const info = await runResearch(research, { backend: BACKEND, client: getClient(), model: RESEARCH_MODEL }, (label) => send({ type: "activity", label }), abort.signal);
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
export function streamResearch(research: ResearchRequest): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      };
      try {
        const info = await runResearch(research, { backend: BACKEND, client: getClient(), model: RESEARCH_MODEL }, (label) => send({ type: "activity", label }), abort.signal);
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
