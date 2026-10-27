/**
 * Image bytes live in the organization's folder (assets/<hash>.<ext>); image nodes reference them
 * as "asset:<hash>". The hash is the first 12 bytes of the content's SHA-256, so the same image is
 * kept once, and the server checks the bytes match the name before keeping them.
 */
import { orgFetch, orgPath } from "@/org/client";

export const ASSET_PREFIX = "asset:";

async function hash(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...d.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const isAsset = (src: string) => src.startsWith(ASSET_PREFIX);

/** Images this window already sent (or found there): sending one again is a no-op, so skip it. */
const kept = new Set<string>();

/** Store a blob (deduplicated by content) and return its "asset:" reference. */
export async function putAsset(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const key = await hash(buf);
  if (!kept.has(key)) {
    await orgFetch(`/assets/${key}`, { method: "PUT", body: buf, headers: { "content-type": blob.type || "application/octet-stream" } });
    kept.add(key);
  }
  return ASSET_PREFIX + key;
}

/** The address an image is served from (immutable: the browser caches it). */
const assetHref = (src: string) => orgPath(`/assets/${src.slice(ASSET_PREFIX.length)}`);

export async function getAssetBlob(src: string): Promise<Blob | null> {
  if (!isAsset(src)) return null;
  const r = await fetch(await assetHref(src));
  if (!r.ok) return null;
  kept.add(src.slice(ASSET_PREFIX.length));
  return r.blob();
}

/** Bytes of any image source: asset reference, data URL or URL. */
export async function sourceBytes(src: string): Promise<Uint8Array | null> {
  if (isAsset(src)) {
    const b = await getAssetBlob(src);
    return b ? new Uint8Array(await b.arrayBuffer()) : null;
  }
  const r = await fetch(src);
  return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
}

export async function sourceBlob(src: string): Promise<Blob | null> {
  if (isAsset(src)) return getAssetBlob(src);
  const r = await fetch(src);
  return r.ok ? r.blob() : null;
}

/** An address for <img> previews in panels. */
export function assetURL(src: string): Promise<string | null> {
  return isAsset(src) ? assetHref(src) : Promise.resolve(src);
}
