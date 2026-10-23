/**
 * What the model is writing, streamed to the browser while it writes (NDJSON `delta` lines):
 * `json` is the structured answer so far, `thinking` its summarized reasoning, `text` prose it
 * writes before answering, and `reset` means the answer starts over (a retry).
 */
export type DeltaKind = "json" | "thinking" | "text";
export type DeltaMessage = { type: "delta"; kind: DeltaKind; text: string } | { type: "delta"; kind: "reset" };

/**
 * Batches deltas so the stream carries a few lines a second rather than one per token. Text of
 * each kind is joined in order; a reset drops anything not yet sent, then goes out at once.
 */
export function deltaBatcher(send: (m: DeltaMessage) => void, everyMs = 120) {
  const pending = new Map<DeltaKind, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    for (const [kind, text] of pending) if (text) send({ type: "delta", kind, text });
    pending.clear();
  };

  return {
    push(kind: DeltaKind, text: string) {
      if (!text) return;
      pending.set(kind, (pending.get(kind) ?? "") + text);
      timer ??= setTimeout(flush, everyMs);
    },
    reset() {
      clearTimeout(timer);
      timer = undefined;
      pending.clear();
      send({ type: "delta", kind: "reset" });
    },
    flush,
  };
}
