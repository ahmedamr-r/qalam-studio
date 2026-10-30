import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { codexEnv } from "@/ai/engines/codex";

/*
 * The person's own Codex on this computer: where it is (on the PATH, a usual install folder, or
 * inside the ChatGPT app) and whether it's signed in, as `codex login status` says. Its credentials
 * are never read.
 */

/** The `codex` to run, or null. QALAM_CODEX_BIN names another (tests). */
export function findCodex(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync, home = homedir()): string | null {
  if (env.QALAM_CODEX_BIN) return env.QALAM_CODEX_BIN;
  const dirs = [...(env.PATH ?? "").split(path.delimiter).filter(Boolean), path.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".npm-global", "bin"), path.join(home, ".bun", "bin")];
  for (const dir of dirs) if (exists(path.join(dir, "codex"))) return path.join(dir, "codex");
  for (const app of ["/Applications/Codex.app", "/Applications/ChatGPT.app", path.join(home, "Applications", "ChatGPT.app")]) {
    const bin = path.join(app, "Contents", "Resources", "codex");
    if (exists(bin)) return bin;
  }
  return null;
}

export interface CodexState {
  found: boolean;
  /** Signed in (null: couldn't tell). */
  signedIn: boolean | null;
  /** With ChatGPT (the plan pays) or an API key. */
  method?: "chatgpt" | "api-key";
}

/** `codex login status`'s words, read. */
export function codexLogin(out: string): Omit<CodexState, "found"> {
  if (/not logged in/i.test(out)) return { signedIn: false };
  if (/logged in using chatgpt/i.test(out)) return { signedIn: true, method: "chatgpt" };
  if (/logged in using an api key/i.test(out)) return { signedIn: true, method: "api-key" };
  if (/logged in/i.test(out)) return { signedIn: true };
  return { signedIn: null };
}

// A signed-in answer is kept a minute; anything else is asked again.
let cached: { at: number; bin: string; state: CodexState } | null = null;

export async function codexState(bin: string | null = findCodex()): Promise<CodexState> {
  if (!bin) return { found: false, signedIn: false };
  if (cached && cached.bin === bin && Date.now() - cached.at < 60_000) return cached.state;
  const state = await new Promise<CodexState>((resolve) =>
    execFile(bin, ["login", "status"], { env: codexEnv(), timeout: 8000 }, (e, out, err) => {
      if (e && (e as NodeJS.ErrnoException).code === "ENOENT") return resolve({ found: false, signedIn: false });
      resolve({ found: true, ...codexLogin(`${out ?? ""}\n${err ?? ""}`) });
    }),
  );
  cached = state.signedIn ? { at: Date.now(), bin, state } : null;
  return state;
}
