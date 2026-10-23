import type { ConnectorInfo, ResearchInfo } from "./research-shared";

export class AIError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface AIStatus {
  ai: boolean;
  model: string;
  backend?: "api" | "cli";
  /** Running on Vercel, where request bodies are capped at ~4.5 MB. */
  hosted?: boolean;
  /** What the AI can look things up with (the composer's connectors menu). */
  connectors?: ConnectorInfo[];
}

/** What the model is writing, as it writes (routes that opt in with `deltas`). */
export type AIDelta = { kind: "json" | "thinking" | "text"; text: string } | { kind: "reset" };

/** Research-step events: each lookup as it starts, then the notes. */
export type AIEvent = { type: "activity"; label: string } | { type: "research"; research: ResearchInfo };

let statusPromise: Promise<AIStatus> | null = null;
export function aiStatus() {
  statusPromise ??= fetch("/api/status")
    .then((r) => r.json())
    .catch(() => ({ ai: false, model: "" }));
  return statusPromise;
}

/** POST to an AI route and read its NDJSON progress stream. */
export async function callAI<T>(
  path: string,
  body: unknown,
  onProgress?: (tokens: number) => void,
  signal?: AbortSignal,
  onEvent?: (e: AIEvent) => void,
  onDelta?: (d: AIDelta) => void,
): Promise<{ data: T; model?: string; research?: ResearchInfo }> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) {
    const j = await res.json().catch(() => ({ error: "http", message: res.statusText }));
    throw new AIError(j.error ?? "http", j.message ?? `HTTP ${res.status}`);
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let research: ResearchInfo | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.type === "progress") onProgress?.(msg.tokens);
      else if (msg.type === "delta") onDelta?.(msg.kind === "reset" ? { kind: "reset" } : { kind: msg.kind, text: msg.text ?? "" });
      else if (msg.type === "activity") onEvent?.(msg);
      else if (msg.type === "research") onEvent?.({ type: "research", research: (research = msg.research) });
      else if (msg.type === "result") return { data: msg.data as T, model: msg.model, research };
      else if (msg.type === "error") throw new AIError(msg.error, msg.message);
    }
  }
  throw new AIError("stream", "The response ended early.");
}
