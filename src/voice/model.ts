/*
 * Talking instead of typing (pure; the window and the core share it). This Mac's voice helper
 * (native/voice, run by server/voice) listens and writes what it hears, on the Mac: Apple's
 * on-device engine where macOS has it (26 and later), on by default there. Where it doesn't, Qalam
 * offers Parakeet and never downloads it unasked; or they use their own dictation app, and Qalam's
 * mic stays out of the way. English only for now.
 */

/** What they chose on this Mac: an engine, their own dictation app, or no voice. */
export type VoiceChoice = "apple" | "parakeet" | "own" | "off";
export type VoiceEngine = "apple" | "parakeet";
export type MicState = "granted" | "denied" | "undetermined";

/** What this Mac has, as the helper found it. */
export interface VoiceFacts {
  /** The helper is here (a Mac with the app, or a checkout that built it). */
  here: boolean;
  apple: { available: boolean; ready: boolean };
  parakeet: { installed: boolean };
  mic: MicState;
}

export interface VoiceView extends VoiceFacts {
  chosen: VoiceChoice | null;
  /** What the mic uses now; null: no mic in the boxes. */
  use: VoiceEngine | null;
}

export const NO_VOICE: VoiceFacts = { here: false, apple: { available: false, ready: false }, parakeet: { installed: false }, mic: "undetermined" };

/** The mic's engine: what they chose if it works here, else Apple's engine where the Mac has it, else Parakeet once installed. Their own app, or off: none. */
export function voiceUse(chosen: VoiceChoice | null, f: VoiceFacts): VoiceEngine | null {
  if (!f.here || chosen === "own" || chosen === "off") return null;
  if (chosen === "parakeet" && f.parakeet.installed) return "parakeet";
  if (f.apple.available) return "apple";
  return f.parakeet.installed ? "parakeet" : null;
}

/** What the voice step offers: Apple's engine, Parakeet to install, or nothing here. */
export const voiceOffer = (f: VoiceFacts): "apple" | "parakeet" | "none" => (!f.here ? "none" : f.apple.available ? "apple" : "parakeet");

/** A line from the helper. */
export type VoiceLine =
  | { t: "ready" }
  | { t: "level"; v: number }
  | { t: "partial"; text: string }
  | { t: "final"; text: string }
  | { t: "cancelled" }
  | { t: "progress"; done: number }
  | { t: "done" }
  | { t: "error"; code: string; message: string }
  | { t: "check"; apple: { available: boolean; ready: boolean }; mic: MicState };

const MICS: readonly MicState[] = ["granted", "denied", "undetermined"];

/** One line of the helper's output, or null when it isn't one it knows. */
export function parseVoiceLine(line: string): VoiceLine | null {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  switch (o.t) {
    case "ready":
    case "cancelled":
    case "done":
      return { t: o.t };
    case "level":
      return { t: "level", v: num(o.v) };
    case "progress":
      return { t: "progress", done: num(o.done) };
    case "partial":
    case "final":
      return { t: o.t, text: str(o.text) };
    case "error":
      return { t: "error", code: str(o.code) || "error", message: str(o.message) || "The voice helper stopped." };
    case "check": {
      const a = (o.apple ?? {}) as Record<string, unknown>;
      return { t: "check", apple: { available: a.available === true, ready: a.ready === true }, mic: MICS.includes(o.mic as MicState) ? (o.mic as MicState) : "undetermined" };
    }
    default:
      return null;
  }
}
