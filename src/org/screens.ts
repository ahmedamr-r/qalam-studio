import type { KeptShots, ShownShot } from "@/screens/types";
import { TAB, orgPath } from "./client";

/*
 * Screens in the conversation, from the window (server/org/screens.ts): the screenshots an answer gave,
 * kept as the product's screens and read, saying how it goes.
 */

/** An NDJSON answer: each step heard until the result comes (or the error, thrown in words). */
async function streamed<T>(res: Response, onStep?: (label: string) => void): Promise<T> {
  if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Qalam couldn't keep them (${res.status}).`);
  const reader = res.body.getReader();
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
      const m = JSON.parse(line) as { type: string; label?: string; data?: T; message?: string };
      if (m.type === "result" && m.data) return m.data;
      if (m.type === "error") throw new Error(m.message ?? "It stopped.");
      if (m.type === "activity" && m.label) onStep?.(m.label);
    }
  }
  throw new Error("It stopped before saying how it went.");
}

/** Keep the screenshots an answer gave as the product's screens (`product` null: the organization's own), one flow named for what was asked. */
export async function keepScreens(o: { shots: readonly ShownShot[]; product: string | null; about: string }, signal?: AbortSignal, onStep?: (label: string) => void): Promise<KeptShots> {
  const res = await fetch(await orgPath("/screens/keep"), { method: "POST", headers: { "content-type": "application/json", "x-qalam-tab": TAB }, body: JSON.stringify(o), signal });
  return streamed<KeptShots>(res, onStep);
}
