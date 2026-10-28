import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createGunzip } from "node:zlib";
import type { Readable } from "node:stream";

/*
 * A repository's tarball unpacked into a folder of its own, safely: the archive is someone else's.
 * Only regular files under its top folder, nothing that would land outside it, no links, only the
 * kinds of files reading code needs (none vendored, built or binary), each file and the whole copy
 * under a size. Read in this process, block by block (ustar, with pax and GNU long names).
 */

export const COPY_LIMITS = { file: 512 * 1024, total: 40 * 1024 * 1024, files: 6000, archive: 200 * 1024 * 1024 } as const;

const KEEP = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro|py|rb|go|rs|java|kts?|swift|mm?|h|dart|php|cs|scala|exs?|ya?ml|json|md|mdx|html?|toml|gradle|plist|graphql|gql|sql|prisma)$/i;
const SKIP_DIR = /(^|\/)(node_modules|vendor|dist|build|out|\.next|\.nuxt|\.expo|\.git|coverage|Pods|DerivedData|\.gradle|\.idea|target|bin|obj|__pycache__|\.venv|venv|\.turbo|\.cache|storybook-static)(\/|$)/;
const GENERATED = /\.min\.(js|css)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Podfile\.lock|Cargo\.lock|poetry\.lock|composer\.lock)$/i;

/** Whether a file is one reading code needs: code and text, nothing vendored, built or generated. */
export const keepPath = (p: string) => KEEP.test(p) && !SKIP_DIR.test(p) && !GENERATED.test(p);

/** An entry's path in the repository (its top folder off), or null when it would land outside or isn't a path at all. */
export function entryPath(name: string): string | null {
  const norm = name.replace(/\\/g, "/");
  // An absolute name is never one of the repository's.
  if (norm.startsWith("/") || /^[A-Za-z]:/.test(norm)) return null;
  const parts = norm.split("/").filter((s) => s && s !== ".");
  if (parts.length < 2 || parts.some((s) => s === ".." || s.includes("\0"))) return null;
  const rel = parts.slice(1).join("/");
  return /^[A-Za-z]:/.test(rel) ? null : rel;
}

const text = (b: Buffer, from: number, len: number) => {
  const s = b.subarray(from, from + len);
  const end = s.indexOf(0);
  return s.subarray(0, end < 0 ? s.length : end).toString("utf8");
};

/** A header's size: octal, or base-256 for big files. */
function sizeOf(h: Buffer): number {
  if (h[124] & 0x80) {
    let n = 0;
    for (let i = 125; i < 136; i++) n = n * 256 + h[i];
    return n;
  }
  return parseInt(text(h, 124, 12).trim() || "0", 8) || 0;
}

/** A pax header's records ("27 path=a/very/long/name\n"). */
function paxOf(b: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let at = 0;
  while (at < b.length) {
    const sp = b.indexOf(0x20, at);
    if (sp < 0) break;
    const len = parseInt(b.subarray(at, sp).toString("ascii"), 10);
    if (!len || at + len > b.length) break;
    const rec = b.subarray(sp + 1, at + len - 1).toString("utf8");
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    at += len;
  }
  return out;
}

export interface Unpacked {
  files: number;
  bytes: number;
  /** The commit, as GitHub's tarball names it (its global pax header). */
  commit?: string;
}

/** Unpack a gzipped tarball into `dir` (a fresh folder), keeping only what reading code needs. */
export async function untarInto(input: Readable, dir: string): Promise<Unpacked> {
  const root = path.resolve(dir);
  await mkdir(root, { recursive: true });
  let archive = 0;
  input.on("data", (c: Buffer) => {
    archive += c.length;
    if (archive > COPY_LIMITS.archive) input.destroy(new Error("The repository is too big to read here."));
  });
  const gunzip = input.pipe(createGunzip());
  // A download that fails ends the reading too (a pipe doesn't pass errors on).
  input.on("error", (e) => gunzip.destroy(e));
  let buf: Buffer = Buffer.alloc(0);
  const out: Unpacked = { files: 0, bytes: 0 };
  // The entry being read: how much of it is left, whether it's kept, what's been read of it.
  let entry: { type: string; name: string; left: number; pad: number; keep: string | null; chunks: Buffer[] } | null = null;
  let nextName: string | null = null;
  let zeros = 0;

  const finish = async (e: NonNullable<typeof entry>) => {
    const body = Buffer.concat(e.chunks);
    if (e.type === "x") nextName = paxOf(body).path ?? null;
    else if (e.type === "g") out.commit = paxOf(body).comment?.trim() || out.commit;
    else if (e.type === "L") nextName = text(body, 0, body.length);
    else if (e.keep && !body.subarray(0, 8000).includes(0)) {
      const dest = path.resolve(root, e.keep);
      // Never outside the copy's folder, whatever the name said.
      if (!dest.startsWith(`${root}${path.sep}`)) return;
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, body, { flag: "wx" }).catch(() => {});
      out.files++;
      out.bytes += body.length;
    }
  };

  for await (const chunk of gunzip as AsyncIterable<Buffer>) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (entry) {
        if (entry.left > 0) {
          if (!buf.length) break;
          const take = Math.min(entry.left, buf.length);
          if (entry.keep || "xgL".includes(entry.type)) entry.chunks.push(buf.subarray(0, take));
          buf = buf.subarray(take);
          entry.left -= take;
          if (entry.left > 0) break;
        }
        if (buf.length < entry.pad) break;
        buf = buf.subarray(entry.pad);
        const done = entry;
        entry = null;
        await finish(done);
        continue;
      }
      if (buf.length < 512) break;
      const h = buf.subarray(0, 512);
      buf = buf.subarray(512);
      if (h.every((b) => b === 0)) {
        if (++zeros >= 2) return out;
        continue;
      }
      zeros = 0;
      const type = String.fromCharCode(h[156] || 48);
      const size = sizeOf(h);
      const prefix = text(h, 257, 6).startsWith("ustar") ? text(h, 345, 155) : "";
      const name = nextName ?? (prefix ? `${prefix}/${text(h, 0, 100)}` : text(h, 0, 100));
      if (!"xgL".includes(type)) nextName = null;
      // Regular files only: no links, devices or folders (folders come with their files).
      const rel = type === "0" || type === "7" ? entryPath(name) : null;
      const keep = rel && keepPath(rel) && size <= COPY_LIMITS.file && out.files < COPY_LIMITS.files && out.bytes + size <= COPY_LIMITS.total ? rel : null;
      entry = { type, name, left: size, pad: (512 - (size % 512)) % 512, keep, chunks: [] };
    }
  }
  return out;
}
