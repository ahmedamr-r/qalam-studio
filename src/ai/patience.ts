/*
 * A long job shouldn't end over a limit that passes in a minute. An engine can say to slow down after a
 * burst of calls (ChatGPT's Free plan did, a minute into a scan), so it's asked again after a wait. A
 * plan's usage limit doesn't pass in minutes, so that's said at once.
 */

export const WAITS = [30_000, 60_000, 120_000] as const;

/** Whether this error is an engine saying to slow down for now. */
export function briefLimit(e: unknown): boolean {
  const { code, message } = (e ?? {}) as { code?: unknown; message?: unknown };
  return code === "rate_limited" && !/usage limit|limit reached|hit your limit|resets?\b/i.test(String(message ?? ""));
}

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });

/** The call, asked again after each wait while it's told to slow down. Stopped, or told anything else, it ends there. */
export async function patiently<T>(call: () => Promise<T>, o: { signal?: AbortSignal; waits?: readonly number[]; onWait?: (ms: number) => void; sleep?: typeof pause } = {}): Promise<T> {
  const waits = o.waits ?? WAITS;
  for (let tried = 0; ; tried++) {
    try {
      return await call();
    } catch (e) {
      if (tried >= waits.length || o.signal?.aborted || !briefLimit(e)) throw e;
      o.onWait?.(waits[tried]);
      await (o.sleep ?? pause)(waits[tried], o.signal);
      if (o.signal?.aborted) throw e;
    }
  }
}
