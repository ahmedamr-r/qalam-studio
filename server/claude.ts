import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { childEnv } from "@/ai/cli";
import type { ClaudeAccount } from "@/org/engine";
import { spawnCli } from "@/ai/commands";

/**
 * Finding the user's own Claude Code. An app opened from the Dock or Finder doesn't get the
 * shell's PATH, so besides PATH this looks where the installers put `claude`.
 */
export function findClaude(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync, home = homedir(), platform: NodeJS.Platform = process.platform): string | null {
  if (env.CLAUDE_CLI_PATH) return env.CLAUDE_CLI_PATH;
  if (platform === "win32") return findOnWindows("claude", env, exists, home);
  const p = path.posix;
  const dirs = [
    ...(env.PATH ?? "").split(":").filter(Boolean),
    p.join(home, ".local", "bin"),
    p.join(home, ".claude", "local"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    p.join(home, ".npm-global", "bin"),
    p.join(home, ".bun", "bin"),
  ];
  for (const dir of dirs) {
    const bin = p.join(dir, "claude");
    if (exists(bin)) return bin;
  }
  return null;
}

/**
 * A CLI on Windows: its native installer's `<name>.exe` in ~\.local\bin, or npm's `<name>.cmd` in
 * %APPDATA%\npm, or either on the PATH (a shim is started through its script, src/ai/commands.ts).
 */
export function findOnWindows(name: string, env: NodeJS.ProcessEnv, exists: (p: string) => boolean, home: string): string | null {
  const w = path.win32;
  const dirs = [...(env.PATH ?? env.Path ?? "").split(";").filter(Boolean), w.join(home, ".local", "bin"), w.join(env.APPDATA ?? w.join(home, "AppData", "Roaming"), "npm")];
  for (const dir of dirs) for (const ext of [".exe", ".cmd"]) if (exists(w.join(dir, name + ext))) return w.join(dir, name + ext);
  return null;
}

/**
 * The PATH a terminal would have. An app opened from the Dock or Finder gets only the system's, so
 * an npm-installed Claude Code (a Node script) wouldn't find node, and `claude` itself may be where
 * findClaude doesn't look (a version manager's folder). Asked of the user's login shell, within
 * `ms`; null when it doesn't say.
 */
export function loginShellPath(shell = process.env.SHELL || "/bin/zsh", ms = 3000): Promise<string | null> {
  const mark = "__QALAM_PATH__";
  return new Promise((resolve) => {
    execFile(shell, ["-ilc", `printf '${mark}%s${mark}' "$PATH"`], { timeout: ms, env: { ...process.env, DISABLE_AUTO_UPDATE: "true" } }, (_err, out) => {
      resolve(new RegExp(`${mark}(.+?)${mark}`).exec(String(out ?? ""))?.[1] ?? null);
    });
  });
}

/** PATHs as one, each folder once, the first's first. */
export const joinPaths = (...paths: (string | null | undefined)[]) => [...new Set(paths.flatMap((p) => (p ?? "").split(path.delimiter)).filter(Boolean))].join(path.delimiter);

export interface ClaudeState {
  /** The `claude` command was found. */
  found: boolean;
  /** Signed in (null: couldn't tell). */
  signedIn: boolean | null;
  /** Who pays for Qalam AI's calls, as Claude Code says (signed in only). */
  account?: ClaudeAccount;
}

/** The account in `claude auth status`'s JSON (only the fields that say who pays). */
export function accountFrom(out: string): ClaudeAccount | undefined {
  try {
    const j = JSON.parse(out.slice(out.indexOf("{"))) as Record<string, unknown>;
    const str = (k: string) => (typeof j[k] === "string" && j[k] ? (j[k] as string) : undefined);
    const a: ClaudeAccount = { email: str("email"), org: str("orgName"), plan: str("subscriptionType"), method: str("authMethod"), apiKeySource: str("apiKeySource") };
    for (const k of Object.keys(a) as (keyof ClaudeAccount)[]) if (a[k] === undefined) delete a[k];
    return Object.keys(a).length ? a : undefined;
  } catch {
    return undefined;
  }
}

let cached: { at: number; bin: string; state: ClaudeState } | null = null;
const FRESH_MS = 30_000;

/**
 * Whether Claude Code is installed and signed in (asks `claude auth status`). A signed-in answer
 * is kept for 30 s, for that `claude`; anything else is asked again, so "Check again" sees a fresh
 * sign-in at once.
 */
export async function claudeState(bin: string | null = findClaude()): Promise<ClaudeState> {
  if (cached && cached.bin === bin && Date.now() - cached.at < FRESH_MS) return cached.state;
  const state = bin ? await authStatus(bin) : { found: false, signedIn: false };
  cached = state.signedIn && bin ? { at: Date.now(), bin, state } : null;
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
    // With the environment Qalam AI's own calls get (src/ai/cli.ts), so it says who pays for those.
    const child = spawnCli(bin, ["auth", "status"], { stdio: ["ignore", "pipe", "ignore"], env: childEnv(16000) });
    const timer = setTimeout(() => {
      child.kill();
      done({ found: true, signedIn: null });
    }, 8000);
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.on("error", () => done({ found: false, signedIn: false }));
    child.on("close", () => {
      const signedIn = signedInFrom(out);
      done({ found: true, signedIn, ...(signedIn ? { account: accountFrom(out) } : {}) });
    });
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
