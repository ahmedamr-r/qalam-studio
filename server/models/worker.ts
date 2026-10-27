/**
 * The models process: the embedding and reranking models (llama.cpp, through node-llama-cpp), run
 * apart from the core so a crash in native code takes down only this process. The core starts it
 * on first use and talks to it over IPC (server/models/client.ts). A model downloads on first use
 * into the folder the core names. Types only, no other TypeScript: Node runs this file as it is in
 * development, and the desktop build bundles it to out/models.js.
 */
import type { LlamaEmbeddingContext, LlamaRankingContext } from "node-llama-cpp";

type Request = { id: number; op: "embed"; texts: string[] } | { id: number; op: "rank"; query: string; docs: string[] };

const DIR = process.env.QALAM_MODELS_DIR ?? "";
const EMBEDDER = process.env.QALAM_EMBEDDER ?? "";
const RERANKER = process.env.QALAM_RERANKER ?? "";
/** More than the models read (512 tokens): the end is left out. */
const MAX_CHARS = 1800;

const send = (m: unknown) => process.send?.(m);
const lib = () => import("node-llama-cpp");

let llama: ReturnType<typeof start> | null = null;
let embedder: Promise<LlamaEmbeddingContext> | null = null;
let ranker: Promise<LlamaRankingContext> | null = null;

function start() {
  return lib().then((m) => m.getLlama({ logLevel: m.LlamaLogLevel.error }));
}

async function load(uri: string, model: "embedder" | "reranker") {
  const m = await lib();
  let last = 0;
  const modelPath = await m.resolveModelFile(uri, {
    directory: DIR,
    cli: false,
    onProgress: ({ totalSize, downloadedSize }) => {
      // A few updates a second at most.
      if (Date.now() - last < 250 && downloadedSize < totalSize) return;
      last = Date.now();
      send({ op: "progress", model, done: downloadedSize, total: totalSize });
    },
  });
  return (await (llama ??= start())).loadModel({ modelPath });
}

process.on("message", async (req: Request) => {
  try {
    if (req.op === "embed") {
      const ctx = await (embedder ??= load(EMBEDDER, "embedder").then((m) => m.createEmbeddingContext()));
      const vecs: Float32Array[] = [];
      for (const t of req.texts) vecs.push(Float32Array.from((await ctx.getEmbeddingFor(t.slice(0, MAX_CHARS))).vector));
      send({ id: req.id, ok: true, vecs });
    } else {
      const ctx = await (ranker ??= load(RERANKER, "reranker").then((m) => m.createRankingContext()));
      send({ id: req.id, ok: true, scores: await ctx.rankAll(req.query.slice(0, MAX_CHARS), req.docs.map((d) => d.slice(0, MAX_CHARS))) });
    }
  } catch (e) {
    // A model that failed to load is tried again on the next request.
    if (req.op === "embed") embedder = null;
    else ranker = null;
    send({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// The core went away: so does this.
process.on("disconnect", () => process.exit(0));
send({ op: "up" });
