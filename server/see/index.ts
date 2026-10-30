import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ShotLine, ShotRead } from "@/seen/shot";
import { assetType } from "../org/codecs";
import { atomicWrite, readJson, renameOver } from "../org/fsx";

/*
 * This Mac's screenshot reader (native/see), run by the core: the words on each screenshot, read
 * with macOS's text recognition, and a difference hash of it, kept per picture in the
 * organization's `.qalam/seen/text/<hash>.json` (a picture is named by its content, so what was
 * read stays true). And the smaller copies Qalam AI is sent, made with sips, kept in
 * `.qalam/seen/prep/`. Without the reader, screens are still read; their words just can't be checked.
 */

/**
 * The reader: QALAM_SEE_BIN; the packaged app's Resources; out/ beside the core (`npx`, `pnpm
 * desktop`); or a checkout that built it (`pnpm build:see`). None off a Mac.
 */
export function seeBin(): string | null {
  if (process.env.QALAM_SEE_BIN) return process.env.QALAM_SEE_BIN;
  if (process.platform !== "darwin") return null;
  const built = path.join("native", "see", ".build", "release", "qalam-see");
  const app = process.env.QALAM_APP_DIR;
  const places = [
    ...(app ? [path.join(path.dirname(app), "qalam-see"), path.join(app, "out", "qalam-see"), path.join(app, built)] : []),
    fileURLToPath(new URL(`../../${built}`, import.meta.url)),
  ];
  return places.find((p) => existsSync(p)) ?? null;
}

/** Run the reader; each JSON line goes to `on` as it's written. Ends when it exits or after `ms`. */
function run(bin: string, args: string[], ms: number, on: (o: Record<string, unknown>) => void): Promise<void> {
  return new Promise((done) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let rest = "";
    let said = "";
    const timer = setTimeout(() => child.kill(), ms);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      rest += chunk;
      for (let i = rest.indexOf("\n"); i >= 0; i = rest.indexOf("\n")) {
        const line = rest.slice(0, i);
        rest = rest.slice(i + 1);
        try {
          const o: unknown = JSON.parse(line);
          if (o && typeof o === "object") on(o as Record<string, unknown>);
        } catch {
          // Not one of its lines.
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (said = (said + chunk).slice(-2000)));
    child.on("error", (e) => {
      clearTimeout(timer);
      console.warn(`[see] couldn't run the reader: ${e.message}`);
      done();
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) console.warn(`[see] ${args[0]} ended (${code ?? signal})${said.trim() ? `: ${said.trim()}` : ""}`);
      done();
    });
  });
}

let checked: { bin: string; at: number; ok: boolean } | null = null;

/** Whether this Mac has the reader and it runs (asked again after a minute). */
export async function seeAvailable(): Promise<boolean> {
  const bin = seeBin();
  if (!bin) return false;
  if (checked?.bin === bin && Date.now() - checked.at < 60_000) return checked.ok;
  let ok = false;
  await run(bin, ["check"], 15_000, (o) => (ok ||= o.ok === true));
  checked = { bin, at: Date.now(), ok };
  return ok;
}

// ---------------------------------------------------------------------------
// The words on screenshots

/** Bump when the reader reads better: what was kept before is read again. */
const READ_VERSION = 1;

/** A picture's name as a file name: an asset's content hash, nothing that climbs out. */
const fileSafe = (hash: string) => /^[A-Za-z0-9_-]{1,128}$/.test(hash);

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function lineOf(v: unknown): ShotLine | null {
  const l = v as Partial<ShotLine> | null;
  if (!l || typeof l.text !== "string" || !Array.isArray(l.box) || l.box.length !== 4 || !l.box.every(num) || !num(l.conf)) return null;
  return { text: l.text, box: [l.box[0], l.box[1], l.box[2], l.box[3]], conf: l.conf };
}

/** A reader's line, or a kept file, as a read: null unless it has a size, a hash and lines. */
function readOf(v: unknown): ShotRead | null {
  const o = v as Partial<ShotRead> | null;
  if (!o || !num(o.w) || !num(o.h) || o.w <= 0 || o.h <= 0 || typeof o.dhash !== "string" || !/^[0-9a-f]{16}$/.test(o.dhash) || !Array.isArray(o.lines)) return null;
  return { w: o.w, h: o.h, dhash: o.dhash, lines: o.lines.map(lineOf).filter((l): l is ShotLine => !!l) };
}

const textFile = (orgDir: string, hash: string) => path.join(orgDir, ".qalam", "seen", "text", `${hash}.json`);

/**
 * The words on each screenshot, by its hash: kept ones from `.qalam/seen/text`, the rest read in
 * one run of the reader and kept. Null where there's no reader here or it couldn't read the file.
 */
export async function readShots(orgDir: string, shots: { hash: string; file: string }[]): Promise<Map<string, ShotRead | null>> {
  const out = new Map<string, ShotRead | null>();
  /** Files to read, each with the pictures it is. */
  const misses = new Map<string, string[]>();
  await Promise.all(
    shots.map(async ({ hash, file }) => {
      if (out.has(hash)) return;
      out.set(hash, null);
      const kept = fileSafe(hash) ? await readJson<ShotRead & { v?: number }>(textFile(orgDir, hash)) : null;
      const read = kept?.v === READ_VERSION ? readOf(kept) : null;
      if (read) return void out.set(hash, read);
      const abs = path.resolve(file);
      misses.set(abs, [...(misses.get(abs) ?? []), hash]);
    }),
  );
  const bin = misses.size ? seeBin() : null;
  if (!bin) return out;
  const keeping: Promise<unknown>[] = [];
  // Vision takes about a second a screenshot; the first waits for its models.
  await run(bin, ["read", ...misses.keys()], 30_000 + 10_000 * misses.size, (o) => {
    const hashes = typeof o.file === "string" ? misses.get(o.file) : undefined;
    const read = hashes && !("error" in o) ? readOf(o) : null;
    if (!hashes || !read) return;
    for (const hash of hashes) {
      out.set(hash, read);
      if (fileSafe(hash)) keeping.push(atomicWrite(textFile(orgDir, hash), `${JSON.stringify({ v: READ_VERSION, ...read })}\n`).catch((e) => console.warn(`[see] couldn't keep ${hash}: ${(e as Error).message}`)));
    }
  });
  await Promise.all(keeping);
  return out;
}

// ---------------------------------------------------------------------------
// The copies Qalam AI is sent

const sips = promisify(execFile);
const SIPS = "/usr/bin/sips";

/** The picture's size, as sips reads it; null when it isn't a picture sips reads. */
async function sizeOf(file: string): Promise<{ w: number; h: number } | null> {
  try {
    const { stdout } = await sips(SIPS, ["-g", "pixelWidth", "-g", "pixelHeight", file], { timeout: 15_000 });
    const w = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1]);
    const h = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1]);
    return w > 0 && h > 0 ? { w, h } : null;
  } catch {
    return null;
  }
}

/**
 * A copy of the screenshot no longer than `maxSide` on either side, as PNG or JPEG (quality 80),
 * kept as `.qalam/seen/prep/<hash>-<maxSide>.<ext>` and reused. A picture already that small and
 * of that type is sent as it is (sips would enlarge it). Off macOS, or when sips can't, the original.
 */
export async function prepShot(orgDir: string, hash: string, file: string, maxSide: number, format: "png" | "jpeg"): Promise<{ file: string; type: string }> {
  const original = { file, type: assetType(file) };
  if (process.platform !== "darwin" || !fileSafe(hash) || !existsSync(SIPS)) return original;
  const ext = format === "png" ? "png" : "jpg";
  const type = format === "png" ? "image/png" : "image/jpeg";
  const dir = path.join(orgDir, ".qalam", "seen", "prep");
  const kept = path.join(dir, `${hash}-${maxSide}.${ext}`);
  if (existsSync(kept)) return { file: kept, type };
  const size = await sizeOf(file);
  if (!size) return original;
  const smaller = Math.max(size.w, size.h) > maxSide;
  if (!smaller && original.type === type) return original;
  const tmp = path.join(dir, `.${hash}-${maxSide}.${randomBytes(4).toString("hex")}.${ext}`);
  try {
    await mkdir(dir, { recursive: true });
    const args = [...(smaller ? ["-Z", String(maxSide)] : []), "-s", "format", format, ...(format === "jpeg" ? ["-s", "formatOptions", "80"] : []), file, "--out", tmp];
    await sips(SIPS, args, { timeout: 30_000 });
    // sips says it skipped a file it can't read, and exits 0.
    if (!(await stat(tmp)).size) throw new Error("empty");
    await renameOver(tmp, kept);
    return { file: kept, type };
  } catch {
    await rm(tmp, { force: true });
    return original;
  }
}
