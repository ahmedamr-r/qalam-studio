import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { BENCH_TURNS } from "./bench";
import type { Player } from "./player";
import { baselineOpener, baselineSystem } from "./prompts";
import type { Persona } from "./types";

/**
 * The plain agent: Claude Code on the same model as the side it's compared with, with web and file
 * tools, in one conversation that holds its context between turns. The same player answers it, in
 * prose. It asks for as long as it needs, as Qalam does, under the bench's same guard on turns; `rounds`
 * holds it to the 3 rounds of 3 questions it was frozen with. A budget in dollars holds it to what the
 * other side spent.
 */

export interface BaselineRun {
  turns: { role: "agent" | "person"; text: string }[];
  questions: string[][];
  final: string;
  model: string;
  cost: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  ms: number;
  tools: { name: string; input: string }[];
  ended: "final" | "budget" | "rounds" | "error";
  error?: string;
  /** It wanted to ask more past its rounds, or past the bench's guard, and was told to answer. */
  hitCap?: true;
}

/** The numbered questions in an agent's turn, when that's what the turn is: at most `max` of them, as it was frozen with 3. */
export function questionsIn(text: string, max = Infinity): string[] | null {
  const at = text.lastIndexOf("QUESTIONS:");
  if (at < 0) return null;
  const qs = text.slice(at + "QUESTIONS:".length).split("\n").flatMap((l) => {
    const m = /^\s*\d+[.)]\s*(.+)$/.exec(l);
    return m ? [m[1].trim()] : [];
  });
  return qs.length ? qs.slice(0, max) : null;
}

export async function runBaseline(p: Persona, player: Player, o: { budgetUsd: number; model?: string; effort?: string; folder?: string; files?: string[]; firstRoundOnly?: boolean; signal: AbortSignal; bin?: string; rounds?: number }): Promise<BaselineRun & { firstRoundOnly?: boolean }> {
  const began = Date.now();
  const work = await mkdtemp(path.join(tmpdir(), "qalam-baseline-"));
  const sys = path.join(work, "system.txt");
  await writeFile(sys, baselineSystem(o.rounds));
  const most = o.rounds ?? BENCH_TURNS;
  const perRound = o.rounds ? 3 : Infinity;
  const model = o.model ?? "claude-opus-5-5";
  const tools = ["WebSearch", "WebFetch", ...(o.folder ? ["Read", "Grep", "Glob"] : [])];
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--system-prompt-file", sys,
    "--model", model,
    "--effort", o.effort ?? "high",
    "--tools", tools.join(","),
    "--allowedTools", ...tools,
    "--permission-prompts", "none",
    "--setting-sources", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--max-budget-usd", o.budgetUsd.toFixed(2),
    ...(o.folder ? ["--add-dir", o.folder] : []),
  ];
  const proc: ChildProcessWithoutNullStreams = spawn(o.bin ?? "claude", args, { cwd: work, stdio: ["pipe", "pipe", "pipe"] });
  const run: BaselineRun = { turns: [], questions: [], final: "", model, cost: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, ms: 0, tools: [], ended: "error" };
  const kill = () => proc.kill();
  o.signal.addEventListener("abort", kill, { once: true });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-1500)));
  proc.stdin.on("error", () => {});
  const say = (text: string) => {
    run.turns.push({ role: "person", text });
    proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n");
  };

  const done = new Promise<void>((resolve) => {
    let rounds = 0;
    let working = false;
    const finish = (ended: BaselineRun["ended"], error?: string) => {
      run.ended = ended;
      if (error) run.error = error;
      proc.stdin.end();
      resolve();
    };
    createInterface({ input: proc.stdout }).on("line", (line) => {
      let ev: any;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.type === "assistant") {
        for (const b of ev.message?.content ?? []) if (b.type === "tool_use") run.tools.push({ name: b.name, input: JSON.stringify(b.input).slice(0, 300) });
      }
      if (ev.type !== "result" || working) return;
      // Each result reports the whole session so far.
      run.cost = ev.total_cost_usd ?? run.cost;
      const u = ev.usage ?? {};
      run.tokens = { input: run.tokens.input + (u.input_tokens ?? 0), output: run.tokens.output + (u.output_tokens ?? 0), cacheRead: run.tokens.cacheRead + (u.cache_read_input_tokens ?? 0), cacheWrite: run.tokens.cacheWrite + (u.cache_creation_input_tokens ?? 0) };
      if (ev.subtype && ev.subtype !== "success") {
        if (/budget/i.test(String(ev.subtype))) {
          const last = run.turns.filter((t) => t.role === "agent").at(-1)?.text ?? "";
          run.final = last;
          return finish("budget");
        }
        return finish("error", String(ev.subtype));
      }
      const text = String(ev.result ?? "");
      run.turns.push({ role: "agent", text });
      const asked = questionsIn(text, perRound);
      if (asked && o.firstRoundOnly) {
        run.questions.push(asked);
        return finish("rounds");
      }
      if (asked && rounds < most) {
        rounds++;
        run.questions.push(asked);
        working = true;
        void (async () => {
          const lines: string[] = [];
          for (const [i, q] of asked.entries()) lines.push(`${i + 1}. ${await player.answer(q, { flow: "baseline", round: rounds - 1 }, o.signal)}`);
          working = false;
          say(lines.join("\n"));
        })().catch((e: unknown) => finish("error", e instanceof Error ? e.message : String(e)));
        return;
      }
      if (asked) {
        // It wanted more after the last round (or the bench's guard): it answers with what it has.
        working = false;
        rounds++;
        run.hitCap = true;
        say("That's all the questions I've got time for. Give me your final answer now, with what you have.");
        return;
      }
      run.final = text;
      finish("final");
    });
    proc.on("error", (e) => finish("error", e.message));
    proc.on("close", () => {
      if (run.ended === "error" && !run.error) run.error = stderr.slice(-400) || "It stopped without an answer.";
      resolve();
    });
  });

  say(baselineOpener({ org: p.org.name, ...(p.org.about ? { about: p.org.about } : {}), ...(p.org.audience ? { audience: p.org.audience } : {}), said: p.opener, ...(o.files?.length && o.folder ? { files: o.files, folder: o.folder } : {}) }));
  await done;
  o.signal.removeEventListener("abort", kill);
  proc.kill();
  run.ms = Date.now() - began;
  await rm(work, { recursive: true, force: true }).catch(() => {});
  return { ...run, ...(o.firstRoundOnly ? { firstRoundOnly: true } : {}) };
}
