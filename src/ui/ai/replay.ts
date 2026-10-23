import type { AIDelta } from "@/ai/client";

/**
 * Plays a recorded answer back as if the model were writing it now: the JSON arrives in small
 * pieces over `ms`, so recorded samples build on the canvas the same way live answers do.
 */

const abortError = () => new DOMException("The replay was stopped.", "AbortError");

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/** Split into pieces of a few words, like a model's stream. */
export function chunks(text: string, size = 36): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; ) {
    const n = Math.max(8, Math.round(size * (0.6 + ((i * 7919) % 97) / 120)));
    out.push(text.slice(i, i + n));
    i += n;
  }
  return out;
}

export async function replayStream(
  result: unknown,
  opts: { onDelta: (d: AIDelta) => void; onProgress?: (tokens: number) => void; signal?: AbortSignal; ms?: number; thinking?: string[] },
): Promise<void> {
  const { onDelta, onProgress, signal, ms = 12000, thinking = [] } = opts;
  for (const line of thinking) {
    onDelta({ kind: "thinking", text: `${line}\n` });
    await sleep(700, signal);
  }
  const parts = chunks(JSON.stringify(result));
  const each = ms / Math.max(1, parts.length);
  let sent = 0;
  for (const p of parts) {
    onDelta({ kind: "json", text: p });
    sent += p.length;
    onProgress?.(Math.round(sent / 4));
    await sleep(each, signal);
  }
}
