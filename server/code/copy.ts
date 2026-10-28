import { spawn } from "node:child_process";
import { lstat, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { CodeFile } from "@/code/scan";
import { COPY_LIMITS, keepPath, untarInto, type Unpacked } from "./tar";

/*
 * A repository's code, read-only: a copy from GitHub (this Mac's GitHub CLI, or Qalam's own
 * sign-in, the token only ever in a request's header) unpacked into .qalam/code/<key>, or a folder
 * on this Mac, read where it is and never written. Either way only the files reading code needs.
 */

export const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

/** owner/name as a folder's name. */
export const repoKey = (repo: string) => repo.replace("/", "__");

/** Who this Mac's GitHub CLI is signed in as, or null (not installed, not signed in). */
export function ghLogin(): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn("gh", ["api", "user", "--jq", ".login"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => resolve(code === 0 && out.trim() ? out.trim() : null));
    setTimeout(() => proc.kill(), 15_000).unref();
  });
}

/** Swap a fresh copy in for the old one only once it's whole. */
async function freshCopy(dir: string, fill: (into: string) => Promise<Unpacked>): Promise<Unpacked> {
  const next = `${dir}.next`;
  await rm(next, { recursive: true, force: true });
  try {
    const got = await fill(next);
    await rm(dir, { recursive: true, force: true });
    await rename(next, dir);
    return got;
  } catch (e) {
    await rm(next, { recursive: true, force: true });
    throw e;
  }
}

/** The default branch's code through this Mac's GitHub CLI (its own sign-in; Qalam never sees the token). */
export function copyWithGh(repo: string, dir: string, signal?: AbortSignal): Promise<Unpacked> {
  if (!REPO.test(repo)) throw new Error("Name the repository as owner/name.");
  return freshCopy(dir, async (into) => {
    const proc = spawn("gh", ["api", `repos/${repo}/tarball`], { stdio: ["ignore", "pipe", "pipe"], signal });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-1000)));
    const closed = new Promise<number | null>((resolve, reject) => {
      proc.on("error", (e) => reject(new Error(/ENOENT/.test(String(e)) ? "GitHub's CLI (gh) isn't installed on this Mac." : e.message)));
      proc.on("close", resolve);
    });
    const unpacked = await untarInto(proc.stdout, into).catch((e) => {
      proc.kill();
      throw e;
    });
    const code = await closed;
    if (code !== 0) throw new Error(/404|Not Found/i.test(stderr) ? "GitHub has no such repository, or this account can't see it." : stderr.trim() || "GitHub's CLI couldn't fetch it.");
    return unpacked;
  });
}

/** The default branch's code with Qalam's own GitHub sign-in: the token goes in the request's header, nowhere else. */
export function copyWithToken(repo: string, token: string, dir: string, signal?: AbortSignal): Promise<Unpacked> {
  if (!REPO.test(repo)) throw new Error("Name the repository as owner/name.");
  return freshCopy(dir, async (into) => {
    const res = await fetch(`https://api.github.com/repos/${repo}/tarball`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "Qalam Studio" }, redirect: "follow", signal });
    if (res.status === 404) throw new Error("GitHub has no such repository, or this sign-in can't see it.");
    if (!res.ok || !res.body) throw new Error(`GitHub said ${res.status}.`);
    return untarInto(Readable.fromWeb(res.body as never), into);
  });
}

/** The files reading code needs, from a copy or a folder on this Mac: read, never written; links never followed. */
export async function readCodeFiles(root: string): Promise<CodeFile[]> {
  const out: CodeFile[] = [];
  let bytes = 0;
  const walk = async (rel: string) => {
    const names = await readdir(path.join(root, rel)).catch(() => [] as string[]);
    for (const name of names.sort()) {
      if (out.length >= COPY_LIMITS.files || bytes >= COPY_LIMITS.total) return;
      const p = rel ? `${rel}/${name}` : name;
      const st = await lstat(path.join(root, p)).catch(() => null);
      if (!st || st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (!/^(node_modules|vendor|dist|build|out|\.next|\.nuxt|\.expo|\.git|coverage|Pods|DerivedData|\.gradle|\.idea|target|bin|obj|__pycache__|\.venv|venv|\.turbo|\.cache|\.qalam)$/.test(name)) await walk(p);
        continue;
      }
      if (!st.isFile() || st.size > COPY_LIMITS.file || !keepPath(p)) continue;
      const buf = await readFile(path.join(root, p)).catch(() => null);
      if (!buf || buf.subarray(0, 8000).includes(0)) continue;
      bytes += buf.length;
      out.push({ path: p, text: buf.toString("utf8") });
    }
  };
  await walk("");
  return out;
}
