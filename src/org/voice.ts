import { create } from "zustand";
import { parseVoiceLine, type VoiceChoice, type VoiceEngine, type VoiceLine, type VoiceView } from "@/voice/model";

/*
 * Talking instead of typing, in the window: what this Mac has and what they chose (server/voice),
 * fetching Apple's English pack, and a listen as a stream of the helper's lines.
 */

export const useVoice = create<{ view: VoiceView | null; loading: boolean }>(() => ({ view: null, loading: false }));

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Qalam couldn't answer (${res.status})`);
  return (await res.json()) as T;
}

let asked: Promise<VoiceView | null> | null = null;

/** What this Mac has for voice; asked once per window unless `fresh`. */
export function loadVoice(fresh = false): Promise<VoiceView | null> {
  if (asked && !fresh) return asked;
  useVoice.setState({ loading: true });
  asked = fetch(`/api/voice${fresh ? "?fresh=1" : ""}`)
    .then((r) => json<VoiceView>(r))
    .then(
      (view) => {
        useVoice.setState({ view, loading: false });
        return view;
      },
      () => {
        useVoice.setState({ loading: false });
        return null;
      },
    );
  return asked;
}

export async function chooseVoice(use: VoiceChoice): Promise<VoiceView> {
  const view = await fetch("/api/voice", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ use }) }).then((r) => json<VoiceView>(r));
  useVoice.setState({ view });
  asked = Promise.resolve(view);
  return view;
}

/** Each line of a stream the helper writes, until it ends. */
async function readLines(res: Response, on: (l: VoiceLine) => void): Promise<void> {
  if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Qalam couldn't answer (${res.status})`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let rest = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += value;
    let i: number;
    while ((i = rest.indexOf("\n")) >= 0) {
      const l = parseVoiceLine(rest.slice(0, i));
      rest = rest.slice(i + 1);
      if (l) on(l);
    }
  }
}

/** Listen until `stopVoice()` (the words come as `final`) or until `signal` lets go (they're dropped). */
export async function listenVoice(signal: AbortSignal, on: (l: VoiceLine) => void): Promise<void> {
  const res = await fetch("/api/voice/listen", { method: "POST", signal });
  await readLines(res, on).catch((e) => {
    if (!signal.aborted) throw e;
  });
}

export const stopVoice = () => fetch("/api/voice/stop", { method: "POST" }).then(() => {});

/** An engine fetched: Apple's English pack (by macOS), or Parakeet (only when they ask). Progress as it comes; `signal` stops it. */
export async function installVoice(engine: VoiceEngine, on: (l: VoiceLine) => void, signal?: AbortSignal): Promise<void> {
  let failed: string | null = null;
  const res = await fetch("/api/voice/install", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engine }), signal });
  await readLines(res, (l) => (l.t === "error" ? (failed = l.message) : on(l)));
  await loadVoice(true);
  if (failed) throw new Error(failed);
}
