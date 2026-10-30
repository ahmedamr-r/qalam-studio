import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { nanoid } from "nanoid";
import { readerCall, readerContent, READER_SYSTEM, readerSchema } from "@/ai/code";
import { childEnv } from "@/ai/cli";
import { backend, bin, modelOf, readModelFailed, tierModel } from "@/ai/engine";
import { structured } from "@/ai/server";
import { fromCliResult, reportUsage } from "@/ai/usage";
import { MAP_LIMITS, verifyAnswer, verifyFlows, type CodeRepo, type ProductMap } from "@/code/map";
import { scanCode, type CodeFile, type CodeScan } from "@/code/scan";
import { metricLine } from "@/goals/goals-md";
import { foldJobs } from "@/goals/jobs";
import { goalById } from "@/goals/tree";
import type { Goal } from "@/goals/types";
import { NotFoundError, type OrgStore } from "../org/store";
import { copyWithGh, copyWithToken, ghLogin, readCodeFiles, REPO, repoKey } from "./copy";
import { githubAppReady, githubSignedIn, githubToken } from "./github";
import { promptArgs, spawnCli } from "@/ai/commands";

/**
 * A product's code, read-only, in the core: a GitHub repository copied into .qalam/code (this
 * Mac's GitHub CLI, or Qalam's own sign-in) or a folder read where it is. The scanner lists its
 * screens and events (src/code/scan.ts); Qalam AI writes its main flows (Claude Code with Read,
 * Grep and Glob only, from an empty folder with the copy beside it, so nothing in the repository
 * is taken as instructions; or one call over excerpts, with a key); code keeps each step only where
 * the copy has it (src/code/map.ts). What it does today goes in hub/maps/<key>.md for the team.
 */

const TIME_LIMIT_MS = 6 * 60_000;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

let login: { at: number; value: Promise<string | null> } | null = null;
/** Who this Mac's GitHub CLI is, asked at most every five minutes. */
const ghNow = () => {
  if (!login || Date.now() - login.at > 5 * 60_000) login = { at: Date.now(), value: ghLogin() };
  return login.value;
};

export async function codeView(store: OrgStore) {
  return { gh: await ghNow(), app: githubAppReady(), signedIn: await githubSignedIn(), repos: store.codeRepos, maps: await store.listMaps() };
}

/** Claude Code answered that it can't use the model it was given. */
class ModelUnavailable extends Error {}

/**
 * Claude Code reads the copy on the read tier's model; where it can't use that model here, once
 * more on the decide model (and so do later read calls).
 */
async function viaAgent(root: string, content: string, goals: string[], emit: (label: string) => void, signal: AbortSignal): Promise<{ raw: unknown; model?: string }> {
  const model = modelOf("reader");
  const decide = tierModel("decide");
  try {
    return await readWithAgent(root, content, goals, model, emit, signal);
  } catch (e) {
    if (!(e instanceof ModelUnavailable) || model === decide) throw e;
    readModelFailed(model);
    return readWithAgent(root, content, goals, decide, emit, signal);
  }
}

/** Claude Code reads the copy, read-only: no shell, no web, no edits, from an empty folder of its own. */
function readWithAgent(root: string, content: string, goals: string[], asked: string, emit: (label: string) => void, signal: AbortSignal): Promise<{ raw: unknown; model?: string }> {
  return (async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "qalam-read-"));
    try {
      return await new Promise<{ raw: unknown; model?: string }>((resolve, reject) => {
        const prompt = promptArgs(READER_SYSTEM);
        const args = [
          "-p",
          "--input-format", "stream-json",
          "--output-format", "stream-json",
          "--verbose",
          "--json-schema", JSON.stringify(readerSchema(goals)),
          ...prompt.args,
          "--model", asked,
          "--effort", "medium",
          "--tools", "Read,Grep,Glob",
          "--allowedTools", "Read", "Grep", "Glob",
          "--add-dir", root,
          "--restricted",
          "--permission-mode", "dontAsk",
          "--permission-prompts", "none",
          "--setting-sources", "",
          "--strict-mcp-config",
          "--disable-slash-commands",
          "--no-session-persistence",
        ];
        const proc = spawnCli(bin(), args, { cwd, env: childEnv(16000) });
        proc.on("close", prompt.done);
        const limit = AbortSignal.timeout(TIME_LIMIT_MS);
        const both = AbortSignal.any([signal, limit]);
        const kill = () => proc.kill();
        both.addEventListener("abort", kill, { once: true });
        proc.on("error", (e) => reject(new Error(`Couldn't start Claude Code (${e.message}).`)));
        proc.stdin.on("error", () => {});
        proc.stdin.end(`${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`);
        let stderr = "";
        proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
        let model: string | undefined;
        let apiError: string | undefined;
        let result: { subtype: string; is_error?: boolean; result?: string; structured_output?: unknown; errors?: string[] } | undefined;
        const rel = (f: unknown) => (typeof f === "string" ? path.relative(root, path.resolve(root, f)) || "the code" : "a file");
        createInterface({ input: proc.stdout }).on("line", (line) => {
          let ev;
          try {
            ev = JSON.parse(line);
          } catch {
            return;
          }
          if (ev.type === "system" && ev.subtype === "init") model = ev.model ?? model;
          else if (ev.type === "assistant") {
            if (ev.error) apiError = ev.error;
            for (const b of ev.message?.content ?? []) {
              if (b.type !== "tool_use") continue;
              if (b.name === "Read") emit(`Reading ${clip(rel(b.input?.file_path), 70)}`);
              else if (b.name === "Grep") emit(`Looking for “${clip(String(b.input?.pattern ?? ""), 50)}” in the code`);
              else if (b.name === "Glob") emit(`Listing ${clip(String(b.input?.pattern ?? "files"), 60)}`);
            }
          } else if (ev.type === "result") result = ev;
        });
        proc.on("close", (code) => {
          both.removeEventListener("abort", kill);
          reportUsage(fromCliResult(result as Parameters<typeof fromCliResult>[0], model ?? asked, "reader"));
          if (signal.aborted) return reject(new DOMException("Stopped.", "AbortError"));
          if (limit.aborted) return reject(new Error("Reading the code took too long."));
          if (!result) return reject(new Error(stderr.trim() || `Claude Code exited with code ${code}.`));
          if (apiError === "model_not_found") return reject(new ModelUnavailable(`Claude Code can't use ${asked} here.`));
          if (result.is_error || result.subtype !== "success") return reject(new Error(result.result || result.errors?.join("; ") || result.subtype));
          let raw = result.structured_output;
          if (raw == null) {
            const text = result.result ?? "";
            try {
              raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
            } catch {
              return reject(new Error("Qalam AI's reading of the code wasn't in the shape asked for."));
            }
          }
          resolve({ raw, model });
        });
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  })();
}

/** With a key: one call over what the scanner found and excerpts of those files. */
async function viaExcerpts(files: CodeFile[], scan: CodeScan, content: string, goals: string[]) {
  const wanted = [...new Set([...scan.screens.map((s) => s.file), ...scan.events.map((e) => e.file)])];
  const excerpts: { file: string; text: string }[] = [];
  let size = 0;
  for (const p of wanted) {
    const f = files.find((x) => x.path === p);
    if (!f || size > 80_000) continue;
    const text = f.text.split("\n").slice(0, 120).join("\n");
    size += text.length;
    excerpts.push({ file: p, text });
  }
  const { data, model } = await structured<unknown>(readerCall({ content, excerpts, goals }));
  return { raw: data, model };
}

/** The copy to read: GitHub's (made fresh, or the one here) or the folder itself. */
async function rootOf(store: OrgStore, repo: CodeRepo, o: { fresh: boolean; emit: (label: string) => void; signal: AbortSignal }): Promise<{ root: string; commit?: string }> {
  if (repo.kind === "folder") return { root: repo.path! };
  const root = store.codeDir(repo.key);
  const here = await stat(root).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (here && !o.fresh) return { root, commit: repo.commit };
  o.emit(`Copying ${repo.repo} from GitHub`);
  const token = await githubToken();
  const got = token ? await copyWithToken(repo.repo!, token, root, o.signal) : await copyWithGh(repo.repo!, root, o.signal);
  return { root, commit: got.commit ?? repo.commit };
}

/** The goals as the reader names them (g1…), with their numbers. */
function goalRefs(goals: Goal[]) {
  const refs = new Map(goals.map((g, i) => [`g${i + 1}`, g]));
  return { refs, list: [...refs].map(([ref, g]) => ({ ref, title: g.title, number: g.metric ? [g.metric.name, metricLine(g.metric)].filter(Boolean).join(": ") : "no number yet" })) };
}

/** Read a repository: copy it, scan it, have Qalam AI write its flows, keep the steps that hold, write the map. */
export async function readRepo(store: OrgStore, key: string, emit: (label: string) => void, signal: AbortSignal): Promise<{ flows: number; steps: number; events: number; screens: number }> {
  const repo = store.codeRepos.find((r) => r.key === key);
  if (!repo) throw new NotFoundError("No such repository");
  const { root, commit } = await rootOf(store, repo, { fresh: true, emit, signal });
  emit("Finding its screens and the events it sends");
  const files = await readCodeFiles(root);
  if (!files.length) throw new Error("There's no code there Qalam can read.");
  const scan = scanCode(files);
  const tree = await store.getGoals();
  const { refs, list } = goalRefs(tree.goals.filter((g) => g.status === "active" && (!repo.product || !g.product || g.product === repo.product)));
  const product = (await store.listProducts()).find((p) => p.id === repo.product)?.name ?? store.info.name;
  const content = readerContent({ product, root, scan, goals: list });
  emit("Qalam AI is reading the code");
  const { raw, model } = backend() === "cli" ? await viaAgent(root, content, [...refs.keys()], emit, signal) : await viaExcerpts(files, scan, content, [...refs.keys()]);
  const dropped: { why: string; item: unknown }[] = [];
  // The map as it was: a step that's still there keeps its key, and what's pinned to it.
  const before = (await store.listMaps()).find((m) => m.key === key)?.flows;
  const flows = verifyFlows(raw, { root, files: new Map(files.map((f) => [f.path, f.text])), events: new Set(scan.events.map((e) => e.name)), goals: new Set(refs.keys()), before }, (why, item) => dropped.push({ why, item })).map((f) => (f.goal ? { ...f, goal: refs.get(f.goal)!.id } : f));
  const now = Date.now();
  const map: ProductMap = { key, repo: repo.repo ?? path.basename(root), ...(commit ? { commit } : {}), product: repo.product, readAt: now, flows, events: scan.events.map((e) => e.name) };
  await store.putMap(map);
  await store.setCodeRepos(store.codeRepos.map((r) => (r.key === key ? { ...r, ...(commit ? { commit } : {}), readAt: now } : r)));
  await store
    .putTrace({ id: nanoid(10), projectId: "goals", kind: "code", at: now, ...(model ? { model } : {}), repo: map.repo, files: files.length, events: scan.events.length, screens: scan.screens.length, answer: raw, kept: flows.length, dropped } as { id: string; projectId: string })
    .catch(() => {});
  return { flows: flows.length, steps: flows.reduce((n, f) => n + f.steps.length, 0), events: scan.events.length, screens: scan.screens.length };
}

export type NewRepo = { kind: "github"; repo: string; product: string | null } | { kind: "folder"; path: string; product: string | null };

/** Link a repository or a folder to a product, on this computer. */
export async function addRepo(store: OrgStore, input: NewRepo): Promise<CodeRepo> {
  let rec: CodeRepo;
  if (input.kind === "github") {
    const repo = input.repo.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "");
    if (!REPO.test(repo)) throw new Error("Name the repository as owner/name.");
    rec = { key: repoKey(repo), kind: "github", repo, product: input.product };
  } else {
    const dir = path.resolve(input.path.trim());
    if (!path.isAbsolute(input.path.trim()) || !(await stat(dir).then((s) => s.isDirectory(), () => false))) throw new Error("That isn't a folder on this Mac.");
    const base = path.basename(dir).replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[.-]+/, "") || "folder";
    rec = { key: `folder__${base}`.slice(0, 140), kind: "folder", path: dir, product: input.product };
  }
  await store.setCodeRepos([...store.codeRepos.filter((r) => r.key !== rec.key), rec]);
  return rec;
}

/** Stop reading a repository here: its copy goes; the map stays the team's. */
export async function removeRepo(store: OrgStore, key: string): Promise<void> {
  if (!store.codeRepos.some((r) => r.key === key)) throw new NotFoundError("No such repository");
  await store.setCodeRepos(store.codeRepos.filter((r) => r.key !== key));
  await rm(store.codeDir(key), { recursive: true, force: true });
}

/** A read-code job: its question answered from the product's code, kept only where the code says it. */
export async function answerFromCode(store: OrgStore, jobId: string, emit: (label: string) => void, signal: AbortSignal): Promise<{ text: string | null }> {
  const job = foldJobs(await store.listJobLog()).find((j) => j.id === jobId);
  if (!job || job.kind !== "read-code" || !job.questions?.[0]) throw new NotFoundError("No such job");
  const tree = await store.getGoals();
  const goal = goalById(tree, job.goal);
  const repo = store.codeRepos.find((r) => !goal?.product || !r.product || r.product === goal.product) ?? store.codeRepos[0];
  if (!repo) throw new Error("Connect the product's code first, in Connections.");
  const { root } = await rootOf(store, repo, { fresh: false, emit, signal });
  const files = await readCodeFiles(root);
  const scan = scanCode(files);
  const { refs, list } = goalRefs(goal ? [goal] : []);
  const content = readerContent({ product: (await store.listProducts()).find((p) => p.id === repo.product)?.name ?? store.info.name, root, scan, goals: list, question: job.questions[0] });
  emit("Qalam AI is reading the code");
  const { raw } = backend() === "cli" ? await viaAgent(root, content, [...refs.keys()], emit, signal) : await viaExcerpts(files, scan, content, [...refs.keys()]);
  const answer = verifyAnswer(raw, { root, files: new Map(files.map((f) => [f.path, f.text])) });
  // The whole answer, with the files it rests on: a finding cut short is no finding.
  const outcome = answer ? clip(`${answer.text} (${[...new Set(answer.cites.map((c) => c.file))].join(", ")})`, MAP_LIMITS.answer + 200) : "Qalam AI couldn't point to the code that answers it.";
  await store.addJobs([{ id: jobId, ...(answer ? { status: "done" as const } : {}), outcome, at: Date.now() }]);
  return { text: answer?.text ?? null };
}
