import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { pipeline } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { checkUrl, googleDocsExport, isBlockedAddress, readableType } from "./url-guard";

/*
 * Reading a web page for a Discovery board, on the server (Node only: routes import this, never
 * the browser). Every hop is checked: the address before the request (url-guard.ts), and every
 * address its name resolves to as the socket connects, so a name can't pass the check with a
 * public address and then connect to a private one. Redirects are followed by hand, each checked
 * the same way. 10 seconds in all, 2 MB of body at most.
 */

export const FETCH_LIMITS = { bytes: 2 * 1024 * 1024, timeoutMs: 10_000, redirects: 5 };

export type RefusedCode = "blocked" | "bad_url" | "redirects" | "http" | "unsupported" | "private_doc" | "timeout" | "unreachable";

export class FetchRefused extends Error {
  constructor(
    public code: RefusedCode,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

type Resolver = (hostname: string, options: { all: true }, callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

const blocked = (hostname: string) => Object.assign(new Error(`${hostname} resolves to a private or local address.`), { code: "EBLOCKED" }) as NodeJS.ErrnoException;

/**
 * A DNS lookup for sockets that refuses private addresses. Every address the name resolves to is
 * checked (one private address is enough to refuse), and the socket only gets addresses that passed.
 */
export function guardedLookup(resolve: Resolver = dnsLookup as unknown as Resolver): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { all: true }, (err, addresses) => {
      if (err) return callback(err, "", 4);
      const all = (addresses ?? []).filter((a) => a.family === 4 || a.family === 6);
      if (!all.length || all.some((a) => isBlockedAddress(a.address))) return callback(blocked(hostname), "", 4);
      const family = options.family === 4 || options.family === "IPv4" ? 4 : options.family === 6 || options.family === "IPv6" ? 6 : 0;
      const list = family ? all.filter((a) => a.family === family) : all;
      if (!list.length) return callback(Object.assign(new Error(`${hostname} has no IPv${family} address.`), { code: "ENOTFOUND" }), "", 4);
      if (options.all) callback(null, list);
      else callback(null, list[0].address, list[0].family);
    });
  };
}

/** One response: its status and headers, and its (decoded) body as it arrives. */
export interface Hop {
  status: number;
  headers: IncomingHttpHeaders;
  body: AsyncIterable<Uint8Array>;
  close(): void;
}

/** Makes one GET request (no redirects followed). Swapped for a fake in tests. */
export type Transport = (url: URL, signal: AbortSignal) => Promise<Hop>;

const HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; QalamStudio/1.0; reads a page its user imported)",
  accept: "text/html,application/xhtml+xml,text/plain;q=0.9,text/markdown;q=0.9,application/pdf;q=0.8,application/vnd.openxmlformats-officedocument.wordprocessingml.document;q=0.8,*/*;q=0.1",
  "accept-encoding": "gzip, deflate, br",
  "accept-language": "en;q=0.9,*;q=0.5",
};

export const nodeTransport: Transport = (url, signal) =>
  new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, { method: "GET", headers: HEADERS, lookup: guardedLookup(), signal }, (res) => {
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
      const decode = enc === "gzip" || enc === "x-gzip" ? createGunzip() : enc === "deflate" ? createInflate() : enc === "br" ? createBrotliDecompress() : null;
      const body = decode ? pipeline(res, decode, () => {}) : res;
      resolve({ status: res.statusCode ?? 0, headers: res.headers, body, close: () => void res.destroy() });
    });
    req.on("error", reject);
    req.end();
  });

export interface Fetched {
  /** Where it was read from, after redirects. */
  url: string;
  contentType: string;
  body: Uint8Array;
  /** Only the first 2 MB were read. */
  truncated: boolean;
}

/** Read a page the board was given (see the top of this file). Throws FetchRefused with a reason the builder can act on. */
export async function fetchGuarded(raw: string, opts: { transport?: Transport; signal?: AbortSignal; limits?: Partial<typeof FETCH_LIMITS> } = {}): Promise<Fetched> {
  const limits = { ...FETCH_LIMITS, ...opts.limits };
  const transport = opts.transport ?? nodeTransport;
  const timeout = AbortSignal.timeout(limits.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
  const first = checkUrl(raw);
  if (!first.ok) throw new FetchRefused("blocked", first.reason);
  const doc = googleDocsExport(first.url);
  let url = doc;
  for (let hop = 0; ; hop++) {
    const check = checkUrl(url);
    if (!check.ok) throw new FetchRefused("blocked", hop ? `It redirects somewhere that can't be read. ${check.reason}` : check.reason);
    // A Google Doc that isn't shared publicly sends readers to sign in.
    if (doc !== first.url && url.hostname === "accounts.google.com") throw new FetchRefused("private_doc", "That Google Doc isn't public. Share it with “Anyone with the link”, or download it and add the file.");
    try {
      const res = await transport(url, signal);
      const location = res.headers.location;
      if (res.status >= 300 && res.status < 400 && location) {
        res.close();
        if (hop >= limits.redirects) throw new FetchRefused("redirects", "The page redirects too many times.");
        try {
          url = new URL(String(location), url);
        } catch {
          throw new FetchRefused("bad_url", "The page redirects to an address that isn't valid.");
        }
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        res.close();
        throw new FetchRefused("http", `The page answered with an error (${res.status}).`, 502);
      }
      const contentType = String(res.headers["content-type"] ?? "");
      if (!readableType(contentType)) {
        res.close();
        throw new FetchRefused("unsupported", "That address isn't a web page, a text, a PDF or a Word document.", 415);
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      let truncated = false;
      for await (const c of res.body) {
        const take = Math.min(c.byteLength, limits.bytes - size);
        if (take > 0) {
          chunks.push(take < c.byteLength ? c.subarray(0, take) : c);
          size += take;
        }
        if (take < c.byteLength) {
          truncated = true;
          break;
        }
      }
      res.close();
      const body = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        body.set(c, at);
        at += c.byteLength;
      }
      return { url: url.href, contentType, body, truncated };
    } catch (e) {
      if (e instanceof FetchRefused) throw e;
      if ((e as NodeJS.ErrnoException)?.code === "EBLOCKED") throw new FetchRefused("blocked", "Pages on a private or local address can't be read.");
      if (timeout.aborted) throw new FetchRefused("timeout", "The page took more than 10 seconds to answer.", 504);
      if (opts.signal?.aborted) throw e;
      throw new FetchRefused("unreachable", `Couldn't reach ${url.hostname}.`, 502);
    }
  }
}
