import type { EngineKind } from "../engine-kinds";
import type { CallOpts } from "../server";

/*
 * The seam where engines other than Claude plug in. Claude Code and a Claude API key are run by
 * src/ai/server.ts and src/ai/cli.ts as they always were; any other engine is an adapter, which
 * runs one structured call and says what happened in the same NDJSON lines (progress, result with
 * its model, or error), so every route and the core's structured() read it the same way.
 * Server-only.
 */

export interface EngineRun {
  opts: CallOpts;
  /** The model this call runs on (the engine's pick for its tier). */
  model: string;
  /** One NDJSON line to the reader. */
  send: (line: unknown) => void;
  signal: AbortSignal;
}

/** Runs one call and sends its result (or error); what it throws is sent as an error. */
export type EngineAdapter = (r: EngineRun) => Promise<void>;

const adapters = new Map<EngineKind, EngineAdapter>();

export function registerAdapter(kind: EngineKind, adapter: EngineAdapter) {
  adapters.set(kind, adapter);
}

/** The adapter for an engine; null: Claude's own paths run it. */
export const adapterFor = (kind: EngineKind): EngineAdapter | null => adapters.get(kind) ?? null;

/** An adapter's run as an NDJSON response, like the Claude paths. */
export function streamAdapter(adapter: EngineAdapter, opts: CallOpts, model: string): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      };
      try {
        await adapter({ opts, model, send, signal: abort.signal });
      } catch (e) {
        const code = (e as { code?: string }).code ?? "api_error";
        send({ type: "error", error: code, message: e instanceof Error ? e.message : String(e) });
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

/** An error an adapter throws with a code the window knows ("auth", "rate_limited", "parse", "no_vision", "no_model"…). */
export class EngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
