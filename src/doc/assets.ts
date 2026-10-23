/**
 * Image bytes live in IndexedDB; image nodes reference them as "asset:<hash>". Keeping them out of
 * the localStorage document matters: a couple of screenshots as data URLs exceed the quota, and a
 * failed save silently stops the whole document from persisting.
 */
import { openStores } from "@/ui/idb";

export const ASSET_PREFIX = "asset:";
const blobs = openStores("qalam-assets", 1, ["blobs"])("blobs");

async function hash(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...d.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const isAsset = (src: string) => src.startsWith(ASSET_PREFIX);

/** Store a blob (deduplicated by content) and return its "asset:" reference. */
export async function putAsset(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const key = await hash(buf);
  await blobs.put(key, { type: blob.type || "application/octet-stream", bytes: buf });
  return ASSET_PREFIX + key;
}

export async function getAssetBlob(src: string): Promise<Blob | null> {
  if (!isAsset(src)) return null;
  const rec = await blobs.get<{ type: string; bytes: ArrayBuffer }>(src.slice(ASSET_PREFIX.length));
  return rec ? new Blob([rec.bytes], { type: rec.type }) : null;
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

const urls = new Map<string, Promise<string | null>>();
/** An object URL for <img> previews in panels. */
export function assetURL(src: string): Promise<string | null> {
  if (!isAsset(src)) return Promise.resolve(src);
  let p = urls.get(src);
  if (!p) {
    p = getAssetBlob(src).then((b) => (b ? URL.createObjectURL(b) : null));
    urls.set(src, p);
  }
  return p;
}
