import { createHash } from "node:crypto";
import path from "node:path";

/**
 * Serving the built UI (dist/) at qalam://app: which file a path means, its type, and the content
 * security policy the page runs under.
 */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  // Must be exact, or the browser can't compile CanvasKit while it downloads.
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
};

export const mimeOf = (file: string) => MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/**
 * The file a path serves: a file inside dist, or the app itself (index.html) for a page address
 * such as /d/<id>. Null: nothing to serve (a missing asset, or a path that leaves dist).
 */
export function assetPath(dist: string, pathname: string, isFile: (p: string) => boolean): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel.includes("\0")) return null;
  const file = path.resolve(dist, "." + path.posix.normalize("/" + rel));
  if (file !== dist && !file.startsWith(dist + path.sep)) return null;
  if (file !== dist && isFile(file)) return file;
  return path.extname(rel) ? null : path.join(dist, "index.html");
}

/** The hashes of the page's inline scripts (the theme boot), so the policy allows exactly those. */
export function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => `sha256-${createHash("sha256").update(m[1]).digest("base64")}`);
}

/**
 * The page may run only its own scripts. `unsafe-eval` is for the prototype runner, which
 * evaluates the code Qalam compiles from your screens (src/ui/prototype/runtime.ts); remote
 * images, fonts and fetches stay allowed for sources and Google Fonts.
 */
export function contentSecurityPolicy(inlineHashes: string[]): string {
  return [
    "default-src 'self'",
    ["script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'", ...inlineHashes.map((h) => `'${h}'`)].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
