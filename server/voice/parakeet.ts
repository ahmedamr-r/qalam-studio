import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { VoiceLine } from "@/voice/model";
import { modelsDir } from "../models/client";

/*
 * Parakeet v2 (NVIDIA's English model, CoreML through FluidAudio): the files FluidAudio loads for it
 * from FluidInference's repository on Hugging Face, about 465 MB, downloaded only when someone asks,
 * into this Mac's models folder. Only Hugging Face's hosts serve them; a file cut short goes on
 * from where it stopped. The helper reads the folder (`listen --engine parakeet --models`).
 */

const REPO = "FluidInference/parakeet-tdt-0.6b-v2-coreml";
/** What FluidAudio's v2 loader reads (its ModelNames.ASR.requiredModels, and the vocabulary). */
const PARTS = ["Preprocessor.mlmodelc", "Encoder.mlmodelc", "Decoder.mlmodelc", "JointDecision.mlmodelc", "parakeet_vocab.json"];
const DONE = ".complete";

export const parakeetDir = () => path.join(modelsDir(), "parakeet-tdt-0.6b-v2");

export const parakeetInstalled = () => existsSync(path.join(parakeetDir(), DONE));

/** Hugging Face and the hosts it hands its large files to. */
const fromHuggingFace = (u: string) => {
  const host = new URL(u).hostname;
  return host === "huggingface.co" || host.endsWith(".huggingface.co") || host === "hf.co" || host.endsWith(".hf.co");
};

interface Part {
  path: string;
  size: number;
}

let listing: Promise<Part[]> | null = null;

/** The files to fetch, with their sizes, from the repository's listing. */
export function parakeetFiles(): Promise<Part[]> {
  listing ??= (async () => {
    const res = await fetch(`https://huggingface.co/api/models/${REPO}/tree/main?recursive=true`);
    if (!res.ok) throw new Error(`Hugging Face didn't list Parakeet's files (${res.status}).`);
    const all = (await res.json()) as { type: string; path: string; size?: number }[];
    const files = all.filter((f) => f.type === "file" && PARTS.some((p) => f.path === p || f.path.startsWith(`${p}/`))).map((f) => ({ path: f.path, size: f.size ?? 0 }));
    if (!PARTS.every((p) => files.some((f) => f.path === p || f.path.startsWith(`${p}/`)))) throw new Error("Parakeet's files aren't all on Hugging Face as expected.");
    return files;
  })().catch((e) => {
    listing = null;
    throw e;
  });
  return listing;
}

/** How much the download is, in bytes. */
export const parakeetSize = async () => (await parakeetFiles()).reduce((n, f) => n + f.size, 0);

/** Fetch each file not here yet (a part-fetched one goes on), reporting the share done; then mark the folder whole. */
export async function installParakeet(on: (l: VoiceLine) => void, signal?: AbortSignal): Promise<void> {
  const files = await parakeetFiles();
  const total = files.reduce((n, f) => n + f.size, 0) || 1;
  const dir = parakeetDir();
  await mkdir(dir, { recursive: true });
  let done = 0;
  let told = 0;
  const tell = () => {
    if (Date.now() - told < 250) return;
    told = Date.now();
    on({ t: "progress", done: Math.min(1, done / total) });
  };
  for (const f of files) {
    if (signal?.aborted) throw new Error("Stopped.");
    const to = path.join(dir, f.path);
    const have = await stat(to).then((s) => s.size, () => 0);
    if (have === f.size) {
      done += f.size;
      continue;
    }
    const part = `${to}.part`;
    const from = await stat(part).then((s) => s.size, () => 0);
    await mkdir(path.dirname(to), { recursive: true });
    const url = `https://huggingface.co/${REPO}/resolve/main/${f.path.split("/").map(encodeURIComponent).join("/")}`;
    const res = await fetch(url, { headers: from ? { range: `bytes=${from}-` } : {}, signal });
    if (!fromHuggingFace(res.url)) throw new Error("Parakeet's files came from somewhere other than Hugging Face, so Qalam stopped.");
    if (!res.ok || !res.body) throw new Error(`Hugging Face didn't send ${f.path} (${res.status}).`);
    const resumed = res.status === 206;
    done += resumed ? from : 0;
    const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>);
    body.on("data", (c: Buffer) => {
      done += c.length;
      tell();
    });
    await pipeline(body, createWriteStream(part, { flags: resumed ? "a" : "w" }), { signal });
    const got = (await stat(part)).size;
    if (got !== f.size) throw new Error(`${f.path} came ${got} bytes long, not ${f.size}. Try again.`);
    await rename(part, to);
  }
  await writeFile(path.join(dir, DONE), `${new Date().toISOString()}\n`);
  on({ t: "progress", done: 1 });
}

export const removeParakeet = () => rm(parakeetDir(), { recursive: true, force: true });
