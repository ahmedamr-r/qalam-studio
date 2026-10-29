import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NO_VOICE, parseVoiceLine, voiceUse, type VoiceChoice, type VoiceEngine, type VoiceFacts, type VoiceLine, type VoiceView } from "@/voice/model";
import { readSettings, writeSettings } from "../settings";
import { installParakeet, parakeetDir, parakeetInstalled, removeParakeet } from "./parakeet";

/*
 * This Mac's voice helper (native/voice), run by the core: what the Mac has (check), Apple's English
 * pack fetched (install), and listening, one at a time for the one microphone. The helper writes
 * JSON lines; they go to the window as they come. Audio never leaves the Mac.
 */

/**
 * The helper: QALAM_VOICE_BIN; the packaged app's Resources; out/ beside the core (`npx`, `pnpm
 * desktop`); or a checkout that built it (`pnpm build:voice`). None off a Mac.
 */
export function voiceBin(): string | null {
  if (process.env.QALAM_VOICE_BIN) return process.env.QALAM_VOICE_BIN;
  if (process.platform !== "darwin") return null;
  const built = path.join("native", "voice", ".build", "release", "qalam-voice");
  const app = process.env.QALAM_APP_DIR;
  const places = [
    ...(app ? [path.join(path.dirname(app), "qalam-voice"), path.join(app, "out", "qalam-voice"), path.join(app, built)] : []),
    fileURLToPath(new URL(`../../${built}`, import.meta.url)),
  ];
  return places.find((p) => existsSync(p)) ?? null;
}

function run(args: string[]): ChildProcessWithoutNullStreams | null {
  const bin = voiceBin();
  if (!bin) return null;
  return spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], env: process.env });
}

/** Each line the helper writes, as it writes it; resolves when it exits. */
function lines(child: ChildProcessWithoutNullStreams, on: (l: VoiceLine) => void): Promise<number | null> {
  let rest = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    rest += chunk;
    let i: number;
    while ((i = rest.indexOf("\n")) >= 0) {
      const l = parseVoiceLine(rest.slice(0, i));
      rest = rest.slice(i + 1);
      if (l) on(l);
    }
  });
  child.stderr.resume();
  return new Promise((done) => {
    child.on("error", () => done(null));
    child.on("close", (code) => done(code));
  });
}

// ---------------------------------------------------------------------------
// What this Mac has

let facts: { at: number; v: VoiceFacts } | null = null;

export async function voiceFacts(fresh = false): Promise<VoiceFacts> {
  if (!fresh && facts && Date.now() - facts.at < 30_000) return facts.v;
  const child = run(["check"]);
  if (!child) return NO_VOICE;
  let seen: Extract<VoiceLine, { t: "check" }> | null = null;
  const timer = setTimeout(() => child.kill(), 15_000);
  await lines(child, (l) => {
    if (l.t === "check") seen = l;
  });
  clearTimeout(timer);
  const check = seen as Extract<VoiceLine, { t: "check" }> | null;
  const v: VoiceFacts = check ? { here: true, apple: check.apple, parakeet: { installed: parakeetInstalled() }, mic: check.mic } : NO_VOICE;
  facts = { at: Date.now(), v };
  return v;
}

export async function voiceView(fresh = false): Promise<VoiceView> {
  const [f, s] = await Promise.all([voiceFacts(fresh), readSettings()]);
  const chosen = s.voice?.use ?? null;
  return { ...f, chosen, use: voiceUse(chosen, f) };
}

export async function chooseVoice(use: VoiceChoice): Promise<VoiceView> {
  await writeSettings({ voice: { use } });
  return voiceView();
}

/** Apple's English pack, fetched by macOS (it comes on first listen too), or Parakeet's model, downloaded here: only ever when asked. */
export async function installVoice(engine: VoiceEngine, on: (l: VoiceLine) => void, signal?: AbortSignal): Promise<void> {
  if (engine === "parakeet") {
    await installParakeet(on, signal);
    facts = null;
    return;
  }
  const child = run(["install", "--engine", "apple"]);
  if (!child) throw new Error("The voice helper isn't on this Mac.");
  let failed: string | null = null;
  await lines(child, (l) => {
    if (l.t === "error") failed = l.message;
    else on(l);
  });
  facts = null;
  if (failed) throw new Error(failed);
}

// ---------------------------------------------------------------------------
// Listening: one at a time

let listening: ChildProcessWithoutNullStreams | null = null;

/**
 * Listen until Stop (keeps the words) or until the window lets go (drops them). Each line goes to
 * `on` as the helper writes it. A new listen cancels the one before.
 */
export async function listen(engine: VoiceEngine, signal: AbortSignal, on: (l: VoiceLine) => void): Promise<void> {
  listening?.stdin.write("cancel\n");
  const child = run(["listen", "--engine", engine, ...(engine === "parakeet" ? ["--models", parakeetDir()] : [])]);
  if (!child) {
    on({ t: "error", code: "no-helper", message: "The voice helper isn't on this Mac." });
    return;
  }
  listening = child;
  const drop = () => {
    if (child.exitCode !== null) return;
    child.stdin.write("cancel\n");
    setTimeout(() => child.exitCode === null && child.kill(), 2000);
  };
  signal.addEventListener("abort", drop, { once: true });
  await lines(child, (l) => {
    if (l.t === "error" && l.code === "mic-denied") facts = null;
    on(l);
  });
  signal.removeEventListener("abort", drop);
  if (listening === child) listening = null;
}

/** Finish the listen going on: the last words are kept. */
export function stopListening(): boolean {
  if (!listening || listening.exitCode !== null) return false;
  listening.stdin.write("stop\n");
  return true;
}

/** Parakeet's model taken off this Mac; the mic goes back to no engine until they choose. */
export async function forgetParakeet(): Promise<VoiceView> {
  await removeParakeet();
  facts = null;
  if ((await readSettings()).voice?.use === "parakeet") await writeSettings({ voice: undefined });
  return voiceView();
}
