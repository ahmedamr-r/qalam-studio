import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchGuarded, type Transport } from "@/discovery/fetch-guard";
import { dataIcon, iconLinks, iconType, isHost, type IconType } from "@/discovery/favicon";
import { localDir } from "./paths";

/*
 * A site's icon, for what was read there (src/discovery/favicon.ts). The core asks the site itself:
 * its /favicon.ico, else the icons its home page names, each through the guarded fetch (no private
 * addresses, a few seconds, a small body). Kept on this computer in .qalam/favicons/<host>, an empty
 * file where a site has none, asked again after a few days.
 */

export interface Icon {
  type: IconType;
  bytes: Uint8Array;
}

const ICON_BYTES = 200_000;
const PAGE_BYTES = 400_000;
const RETRY_MS = 3 * 24 * 60 * 60 * 1000;

const dirOf = () => path.join(localDir(), "favicons");
const asking = new Map<string, Promise<Icon | null>>();

async function fetchIcon(host: string, transport?: Transport): Promise<Icon | null> {
  const icon = async (url: string): Promise<Icon | null> => {
    const inline = url.startsWith("data:") ? dataIcon(url) : null;
    if (inline) {
      const type = iconType(inline);
      return type && inline.byteLength <= ICON_BYTES ? { type, bytes: inline } : null;
    }
    // Sites send icons under every type (text/plain, octet-stream, none): the bytes decide.
    const f = await fetchGuarded(url, { transport, accept: () => true, limits: { bytes: ICON_BYTES, timeoutMs: 6000, redirects: 3 } }).catch(() => null);
    const type = f && !f.truncated ? iconType(f.body) : null;
    return f && type ? { type, bytes: f.body } : null;
  };
  const ico = await icon(`https://${host}/favicon.ico`);
  if (ico) return ico;
  const page = await fetchGuarded(`https://${host}/`, { transport, limits: { bytes: PAGE_BYTES, timeoutMs: 8000 } }).catch(() => null);
  if (!page) return null;
  for (const href of iconLinks(new TextDecoder().decode(page.body), page.url)) {
    const hit = await icon(href);
    if (hit) return hit;
  }
  return null;
}

/** A site's icon, from this computer when it's been asked before; null when it has none. */
export async function faviconFor(host: string, opts: { transport?: Transport; dir?: string; now?: number } = {}): Promise<Icon | null> {
  if (!isHost(host)) return null;
  const file = path.join(opts.dir ?? dirOf(), host);
  const kept = await stat(file).catch(() => null);
  if (kept?.size) {
    const bytes = new Uint8Array(await readFile(file));
    const type = iconType(bytes);
    if (type) return { type, bytes };
  } else if (kept && (opts.now ?? Date.now()) - kept.mtimeMs < RETRY_MS) return null;
  const going = asking.get(file);
  if (going) return going;
  const run = (async () => {
    const icon = await fetchIcon(host, opts.transport);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, icon ? icon.bytes : new Uint8Array()).catch(() => {});
    return icon;
  })().finally(() => asking.delete(file));
  asking.set(file, run);
  return run;
}
