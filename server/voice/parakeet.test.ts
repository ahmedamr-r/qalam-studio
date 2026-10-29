import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installParakeet, parakeetDir, parakeetFiles, parakeetInstalled } from "./parakeet";

// A stand-in for Hugging Face: the repository's listing (other variants beside v2's files), and each file.
const FILES: Record<string, string> = {
  "Preprocessor.mlmodelc/model.mil": "pre",
  "Encoder.mlmodelc/weights/weight.bin": "encoder-weights",
  "Decoder.mlmodelc/model.mil": "dec",
  "JointDecision.mlmodelc/model.mil": "joint",
  "parakeet_vocab.json": "{}",
};
const OTHER = { "ParakeetEncoder.mlmodelc/weights/weight.bin": "big variant" };

let dir: string;
let served: string[];
let host = "huggingface.co";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-parakeet-"));
  process.env.QALAM_MODELS = dir;
  served = [];
  host = "huggingface.co";
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.includes("/api/models/")) return Response.json(Object.entries({ ...FILES, ...OTHER }).map(([p, body]) => ({ type: "file", path: p, size: body.length })));
    const file = decodeURIComponent(url.split("/resolve/main/")[1]);
    served.push(file);
    const body = FILES[file];
    const range = (init?.headers as Record<string, string> | undefined)?.range;
    const from = range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
    const res = new Response(body.slice(from), { status: from ? 206 : 200 });
    Object.defineProperty(res, "url", { value: `https://${host}/x` });
    return res;
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.QALAM_MODELS;
  await rm(dir, { recursive: true, force: true });
});

describe("Parakeet's download", () => {
  it("fetches only what FluidAudio loads for v2, then marks the folder whole", async () => {
    expect((await parakeetFiles()).map((f) => f.path).sort()).toEqual(Object.keys(FILES).sort());
    expect(parakeetInstalled()).toBe(false);
    const said: number[] = [];
    await installParakeet((l) => l.t === "progress" && said.push(l.done));
    expect(served.sort()).toEqual(Object.keys(FILES).sort());
    expect(await readFile(path.join(parakeetDir(), "Encoder.mlmodelc/weights/weight.bin"), "utf8")).toBe("encoder-weights");
    expect(said.at(-1)).toBe(1);
    expect(parakeetInstalled()).toBe(true);
  });

  it("goes on from where a file stopped, and skips what's whole", async () => {
    await mkdir(path.join(parakeetDir(), "Encoder.mlmodelc/weights"), { recursive: true });
    await writeFile(path.join(parakeetDir(), "Encoder.mlmodelc/weights/weight.bin.part"), "encoder-");
    await mkdir(path.join(parakeetDir(), "Decoder.mlmodelc"), { recursive: true });
    await writeFile(path.join(parakeetDir(), "Decoder.mlmodelc/model.mil"), "dec");
    await installParakeet(() => {});
    expect(served).not.toContain("Decoder.mlmodelc/model.mil");
    expect(await readFile(path.join(parakeetDir(), "Encoder.mlmodelc/weights/weight.bin"), "utf8")).toBe("encoder-weights");
  });

  it("stops when a file comes from anywhere but Hugging Face", async () => {
    host = "files.example.com";
    await expect(installParakeet(() => {})).rejects.toThrow(/somewhere other than Hugging Face/);
    expect(parakeetInstalled()).toBe(false);
  });
});
