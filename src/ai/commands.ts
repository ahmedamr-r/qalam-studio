import { execFile, spawn, type ChildProcessWithoutNullStreams, type ExecFileOptions, type SpawnOptions } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/*
 * How to start a CLI Qalam runs (Claude Code, Codex) on this platform. On a Mac or Linux, the
 * binary itself. On Windows an npm install leaves a .cmd shim, which Node won't start without a
 * shell, and a shell would read the call's arguments as commands: the shim's own script runs with
 * Node instead, so nothing goes through cmd.exe. Windows also caps a command line at 32,767
 * characters, so a long system prompt goes in a file there. Server-only.
 */

export interface Command {
  command: string;
  /** Before the CLI's own arguments (the shim's script). */
  args: string[];
  env: Record<string, string>;
}

/** The script an npm .cmd shim runs (`"%dp0%\node_modules\…\cli.js"`), as a path beside the shim. */
export function shimScript(cmd: string, dir: string): string | null {
  const m = /"%~?dp0%?\\([^"]+?\.[cm]?js)"/i.exec(cmd);
  return m ? path.win32.join(dir, m[1]) : null;
}

interface Where {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  read?: (p: string) => string;
  exists?: (p: string) => boolean;
  /** The desktop app's own binary, which runs as Node (ELECTRON_RUN_AS_NODE). */
  electron?: string | null;
}

export function commandFor(bin: string, o: Where = {}): Command {
  const platform = o.platform ?? process.platform;
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(bin)) return { command: bin, args: [], env: {} };
  const exists = o.exists ?? existsSync;
  const dir = path.win32.dirname(bin);
  let script: string | null = null;
  try {
    script = shimScript((o.read ?? ((p) => readFileSync(p, "utf8")))(bin), dir);
  } catch {
    // Unreadable: left as it is, and the start fails with what Windows says.
  }
  if (!script) return { command: bin, args: [], env: {} };
  const dirs = [dir, ...((o.env ?? process.env).PATH ?? "").split(";").filter(Boolean)];
  const node = dirs.map((d) => path.win32.join(d, "node.exe")).find(exists);
  if (node) return { command: node, args: [script], env: {} };
  const electron = o.electron === undefined ? (process.versions.electron ? process.execPath : null) : o.electron;
  if (electron) return { command: electron, args: [script], env: { ELECTRON_RUN_AS_NODE: "1" } };
  return { command: "node.exe", args: [script], env: {} };
}

/** spawn() for a CLI, started the way this platform needs (`commandFor`). */
export function spawnCli(bin: string, args: string[], o: SpawnOptions): ChildProcessWithoutNullStreams {
  const run = commandFor(bin);
  // The binary path is dynamic; keep bundlers from tracing the whole project for it.
  return spawn(/*turbopackIgnore: true*/ run.command, [...run.args, ...args], { ...o, env: { ...(o.env ?? process.env), ...run.env } }) as ChildProcessWithoutNullStreams;
}

/** execFile() for a CLI, the same way. */
export function execCli(bin: string, args: string[], o: ExecFileOptions, done: (err: Error | null, stdout: string, stderr: string) => void) {
  const run = commandFor(bin);
  return execFile(run.command, [...run.args, ...args], { ...o, env: { ...(o.env ?? process.env), ...run.env } }, (err, stdout, stderr) => done(err, String(stdout ?? ""), String(stderr ?? "")));
}

/** A system prompt for Claude Code: as an argument, or (Windows) in a file only this user can open, removed by `done`. */
export function promptArgs(text: string, platform: NodeJS.Platform = process.platform): { args: string[]; done: () => void } {
  if (platform !== "win32") return { args: ["--system-prompt", text], done: () => {} };
  const dir = mkdtempSync(path.join(tmpdir(), "qalam-prompt-"));
  const file = path.join(dir, "system.md");
  writeFileSync(file, text, { mode: 0o600 });
  return { args: ["--system-prompt-file", file], done: () => rmSync(dir, { recursive: true, force: true }) };
}
