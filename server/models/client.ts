import { fork, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The core's way to the models process (server/models/worker.ts): started on first use, restarted
 * if it dies, shared by every organization. When the models can't run (not installed, no download)
 * search goes on without them, on words and links (server/index/search.ts).
 */

export const EMBEDDER = {
  id: "bge-small-en-v1.5",
  uri: "hf:CompendiumLabs/bge-small-en-v1.5-gguf/bge-small-en-v1.5-q8_0.gguf",
  /** BGE reads a short query best with this before it (passages go as they are). */
  query: "Represent this sentence for searching relevant passages: ",
  /** Below this, BGE v1.5's matches mostly share only a topic; measured on the eval set (eval/retrieval), it also saves tokens. */
  minSimilarity: 0.6,
} as const;

export const RERANKER = {
  id: "jina-reranker-v1-tiny-en",
  uri: "hf:gpustack/jina-reranker-v1-tiny-en-GGUF/jina-reranker-v1-tiny-en-Q8_0.gguf",
} as const;

export interface ModelsState {
  status: "idle" | "loading" | "ready" | "failed";
  /** Why it failed. */
  error?: string;
  /** A model downloading. */
  download?: { model: string; done: number; total: number };
}

export interface Models {
  /** The embedding model's id: vectors are kept per model. */
  readonly embedder: string;
  /** Below this cosine a piece isn't near enough in meaning to count (it depends on the model). */
  readonly minSimilarity: number;
  /** Unit-length vectors, one per text. */
  embed(texts: string[], as: "query" | "doc"): Promise<Float32Array[]>;
  /** How well each document answers the query (0…1). */
  rank(query: string, docs: string[]): Promise<number[]>;
  state(): ModelsState;
}

/** Where models are kept: QALAM_MODELS, else this computer's cache folder for Qalam. */
export function modelsDir(): string {
  if (process.env.QALAM_MODELS) return process.env.QALAM_MODELS;
  const home = os.homedir();
  if (process.platform === "darwin") return path.join(home, "Library", "Caches", "Qalam", "models");
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "Qalam", "models");
  return path.join(process.env.XDG_CACHE_HOME ?? path.join(home, ".cache"), "qalam", "models");
}

/** The worker: bundled beside the app's core, or the source file in development. */
function workerPath(): string {
  if (process.env.QALAM_APP_DIR) return path.join(process.env.QALAM_APP_DIR, "out", "models.js");
  return fileURLToPath(new URL("./worker.ts", import.meta.url));
}

export function unit(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

const TIMEOUT = 120_000;
/** After this many failures in a row, the models rest a while before being tried again. */
const MAX_FAILURES = 3;
const REST = 10 * 60_000;

class ProcessModels implements Models {
  readonly embedder = EMBEDDER.id;
  readonly minSimilarity = EMBEDDER.minSimilarity;
  private child: ChildProcess | null = null;
  private seq = 0;
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private current: ModelsState = { status: "idle" };
  private failures = 0;
  private restUntil = 0;

  state() {
    return this.current;
  }

  private spawn(): ChildProcess {
    if (this.child) return this.child;
    const child = fork(workerPath(), [], {
      // In the desktop app the core runs inside Electron, whose binary runs as plain Node with this set.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", QALAM_MODELS_DIR: modelsDir(), QALAM_EMBEDDER: EMBEDDER.uri, QALAM_RERANKER: RERANKER.uri },
      serialization: "advanced",
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    child.on("message", (m: { op?: string; id?: number; ok?: boolean; error?: string; model?: string; done?: number; total?: number }) => {
      if (m.op === "progress") this.current = { status: "loading", download: { model: m.model!, done: m.done!, total: m.total! } };
      if (m.id === undefined) return;
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      clearTimeout(w.timer);
      if (m.ok) {
        this.current = { status: "ready" };
        this.failures = 0;
        w.resolve(m);
      } else {
        this.failed(m.error ?? "The models failed");
        w.reject(new Error(this.current.error));
      }
    });
    child.once("exit", (code) => {
      this.child = null;
      if (this.waiting.size || code) this.failed(`The models process stopped${code ? ` (exit ${code})` : ""}`);
      for (const [, w] of this.waiting) (clearTimeout(w.timer), w.reject(new Error("The models process stopped")));
      this.waiting.clear();
    });
    // The core going away takes this with it.
    process.once("exit", () => child.kill());
    this.child = child;
    return child;
  }

  private failed(error: string) {
    this.current = { status: "failed", error };
    if (++this.failures >= MAX_FAILURES) this.restUntil = Date.now() + REST;
  }

  private call<T>(msg: Record<string, unknown>): Promise<T> {
    if (Date.now() < this.restUntil) return Promise.reject(new Error(this.current.error ?? "The models can't run here"));
    if (this.current.status !== "ready") this.current = { ...this.current, status: "loading" };
    const child = this.spawn();
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        this.failed("The models took too long");
        reject(new Error(this.current.error));
      }, TIMEOUT);
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      child.send({ id, ...msg });
    });
  }

  async embed(texts: string[], as: "query" | "doc"): Promise<Float32Array[]> {
    if (!texts.length) return [];
    const { vecs } = await this.call<{ vecs: Float32Array[] }>({ op: "embed", texts: as === "query" ? texts.map((t) => EMBEDDER.query + t) : texts });
    return vecs.map(unit);
  }

  async rank(query: string, docs: string[]): Promise<number[]> {
    if (!docs.length) return [];
    return (await this.call<{ scores: number[] }>({ op: "rank", query, docs })).scores;
  }
}

const g = globalThis as { __qalamModels?: Models };

/** The models (one process for the whole app; kept across dev-server reloads). */
export function models(): Models {
  return (g.__qalamModels ??= new ProcessModels());
}
