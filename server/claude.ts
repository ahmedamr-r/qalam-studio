import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Finding the user's own Claude Code. An app opened from the Dock or Finder doesn't get the
 * shell's PATH, so besides PATH this looks where the installers put `claude`.
 */
export function findClaude(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync, home = homedir()): string | null {
  if (env.CLAUDE_CLI_PATH) return env.CLAUDE_CLI_PATH;
  const dirs = [
    ...(env.PATH ?? "").split(path.delimiter).filter(Boolean),
    path.join(home, ".local", "bin"),
    path.join(home, ".claude", "local"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".bun", "bin"),
  ];
  for (const dir of dirs) {
    const bin = path.join(dir, "claude");
    if (exists(bin)) return bin;
  }
  return null;
}

export interface ClaudeState {
  /** The `claude` command was found. */
  found: boolean;
  /** Signed in (null: couldn't tell). */
  signedIn: boolean | null;
}

let cached: { at: number; state: ClaudeState } | null = null;
const FRESH_MS = 30_000;

/**
 * Whether Claude Code is installed and signed in (asks `claude auth status`). A signed-in answer
 * is kept for 30 s; anything else is asked again, so "Check again" sees a fresh sign-in at once.
 */
export async function claudeState(bin: string | null = findClaude()): Promise<ClaudeState> {
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.state;
  const state = bin ? await authStatus(bin) : { found: false, signedIn: false };
  cached = state.signedIn ? { at: Date.now(), state } : null;
  return state;
}

function authStatus(bin: string): Promise<ClaudeState> {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const done = (s: ClaudeState) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(s);
    };
    const child = spawn(bin, ["auth", "status"], { stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      child.kill();
      done({ found: true, signedIn: null });
    }, 8000);
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.on("error", () => done({ found: false, signedIn: false }));
    child.on("close", () => done({ found: true, signedIn: signedInFrom(out) }));
  });
}

/** `claude auth status` prints JSON with `loggedIn`. Anything else: unknown. */
export function signedInFrom(out: string): boolean | null {
  try {
    const j = JSON.parse(out.slice(out.indexOf("{")));
    return typeof j.loggedIn === "boolean" ? j.loggedIn : null;
  } catch {
    return null;
  }
}
