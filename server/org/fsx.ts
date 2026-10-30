import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Writing an org's files safely and readably: canonical JSON (so Git diffs stay small), atomic
 * writes (a reader never sees half a file), one writer per path at a time, and paths that can't
 * leave the org's folder.
 */

/** Keys that lead a file, in this order; the rest follow alphabetically. */
const HEAD = ["qalam", "id", "type", "kind", "name", "title", "createdAt", "updatedAt", "addedAt"];

function order(keys: string[]): string[] {
  const head = HEAD.filter((k) => keys.includes(k));
  return [...head, ...keys.filter((k) => !HEAD.includes(k)).sort()];
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of order(Object.keys(o))) if (o[k] !== undefined) out[k] = canonical(o[k]);
    return out;
  }
  return v;
}

/** JSON with a fixed key order, two-space indent and a final newline. */
export const stableStringify = (v: unknown) => `${JSON.stringify(canonical(v), null, 2)}\n`;

/** A short content hash: versions for If-Match, asset names. */
export const contentHash = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex").slice(0, 16);

/** The hash Qalam names assets by: the first 12 bytes of SHA-256, as hex (src/doc/assets.ts). */
export const assetHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex").slice(0, 24);

/** A path inside `root`, or null when the relative path would leave it. */
export function inside(root: string, rel: string): string | null {
  if (rel.includes("\0")) return null;
  const abs = path.resolve(root, rel);
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}

/** Write a file whole: to a temp file next to it, then rename over it. */
/**
 * Rename `from` over `to`. Windows refuses while anything else has `to` open for a moment (a
 * reader, the folder watcher, an antivirus scan), with EPERM, EACCES or EBUSY: try again, a little
 * later each time, for about two seconds, as graceful-fs does.
 */
export async function renameOver(from: string, to: string, o: { platform?: NodeJS.Platform; rename?: (a: string, b: string) => Promise<void> } = {}) {
  const move = o.rename ?? rename;
  const windows = (o.platform ?? process.platform) === "win32";
  for (let wait = 10; ; wait *= 2) {
    try {
      return await move(from, to);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (!windows || wait > 1280 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw e;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

export async function atomicWrite(file: string, data: string | Uint8Array) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    await writeFile(tmp, data);
    await renameOver(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

const chains = new Map<string, Promise<unknown>>();

/** Run `fn` with this path to itself: writes to one file never interleave. */
export function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {});
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return next;
}

/** A file name from a title: lowercase words joined by hyphens (Latin letters and digits; anything else falls back). */
export function slugify(title: string, fallback = "untitled"): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return s || fallback;
}

/** `base` + `ext`, or `base-2` + `ext`… whichever isn't taken. */
export function uniqueName(base: string, ext: string, taken: (name: string) => boolean): string {
  for (let n = 1; ; n++) {
    const name = `${n === 1 ? base : `${base}-${n}`}${ext}`;
    if (!taken(name)) return name;
  }
}
