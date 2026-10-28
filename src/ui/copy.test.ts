import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * UI copy names Qalam's own AI "Qalam AI", never "Claude". "Claude" appears only to name the engine
 * or the account behind it (Claude Code, a Claude API key, the Claude plan, the Claude Console).
 * Comments aside; the server's messages that reach the window are checked too.
 */

const ALLOWED = /\bClaude\b(?=\s+(Code|API|plan|Console|account))/g;
const ANY = /\bClaude\b/g;

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });

/** The code without its comments (block, JSDoc and line comments). */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const offending = (file: string) =>
  code(readFileSync(file, "utf8"))
    .split("\n")
    .filter((l) => (l.match(ANY)?.length ?? 0) > (l.match(ALLOWED)?.length ?? 0))
    .map((l) => `${path.relative(process.cwd(), file)}: ${l.trim().slice(0, 120)}`);

describe("UI copy", () => {
  it("calls Qalam's AI Qalam AI, and says Claude only for the engine or the account", () => {
    const root = path.join(process.cwd(), "src", "ui");
    const messages = ["src/ai/cli.ts", "src/ai/research.ts", "server/ask.ts"].map((f) => path.join(process.cwd(), f));
    expect([...files(root), ...messages].flatMap(offending)).toEqual([]);
  });
});
