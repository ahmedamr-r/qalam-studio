/*
 * Which web pages the board may read through the server (pure). The server fetches a page for the
 * browser, so it must never be pointed at itself or the network around it: only http(s) on the
 * standard ports, never a private, loopback, link-local or otherwise special address. The address
 * check runs on every address a name resolves to, for the first request and every redirect.
 */

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const LOCAL_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|localdomain)$/i;

/** A URL the server may fetch, or why not. */
export function checkUrl(raw: string | URL): UrlCheck {
  let url: URL;
  try {
    url = typeof raw === "string" ? new URL(raw.trim()) : new URL(raw.href);
  } catch {
    return { ok: false, reason: "That isn't a web address." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "Only http and https pages can be read." };
  if (url.username || url.password) return { ok: false, reason: "Addresses with a user name or password can't be read." };
  if (url.port && url.port !== "80" && url.port !== "443") return { ok: false, reason: "Only pages on the standard web ports can be read." };
  // A name with a trailing dot ("localhost.") is the same name.
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  // Single-label names ("intranet") resolve through the local network's search domains.
  if (!host || LOCAL_NAMES.test(host) || (!host.includes(".") && !host.includes(":"))) return { ok: false, reason: "Pages on a local network can't be read." };
  if (isIpLiteral(host) && isBlockedAddress(host)) return { ok: false, reason: "Pages on a private or local address can't be read." };
  return { ok: true, url };
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export const isIpLiteral = (host: string) => IPV4.test(host) || host.includes(":");

function v4(ip: string): number | null {
  const m = IPV4.exec(ip);
  if (!m) return null;
  const b = m.slice(1).map(Number);
  if (b.some((x) => x > 255)) return null;
  return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
}

/** Special-purpose IPv4 ranges (RFC 6890 and friends): [network, prefix length]. */
const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], // this network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata lives here)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
];

const V4_RANGES = V4_BLOCKED.map(([net, len]) => ({ net: v4(net)!, mask: len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0 }));

function blockedV4(n: number): boolean {
  return V4_RANGES.some(({ net, mask }) => ((n & mask) >>> 0) === net);
}

/** An IPv6 address as 16 bytes (null if it isn't one). Accepts "::", an embedded IPv4 tail and a zone. */
function v6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, "");
  // An IPv4 tail ("::ffff:1.2.3.4") becomes two groups.
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (tail) {
    const n = v4(tail[1]);
    if (n === null) return null;
    s = `${s.slice(0, -tail[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groups = (h: string) => (h ? h.split(":") : []);
  const head = groups(halves[0]);
  const rest = halves.length === 2 ? groups(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array(fill).fill("0"), ...rest];
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 0xff];
  });
}

const bytesV4 = (b: number[], at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const zeros = (b: number[], from: number, to: number) => b.slice(from, to).every((x) => x === 0);

function blockedV6(b: number[]): boolean {
  // ::/96 holds the unspecified (::) and loopback (::1) addresses and the old IPv4-compatible form.
  if (zeros(b, 0, 12)) return true;
  // IPv4-mapped (::ffff:a.b.c.d): the IPv4 address decides.
  if (zeros(b, 0, 10) && b[10] === 0xff && b[11] === 0xff) return blockedV4(bytesV4(b, 12));
  // NAT64 (64:ff9b::/96): the IPv4 address decides. Local-use NAT64 (64:ff9b:1::/48) is private.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return zeros(b, 4, 12) ? blockedV4(bytesV4(b, 12)) : true;
  // 6to4 (2002::/16): the IPv4 address in bytes 2–5 decides.
  if (b[0] === 0x20 && b[1] === 0x02) return blockedV4(bytesV4(b, 2));
  // Discard-only (100::/64), Teredo (2001::/32), documentation (2001:db8::/32).
  if (b[0] === 0x01 && b[1] === 0x00 && zeros(b, 2, 8)) return true;
  if (b[0] === 0x20 && b[1] === 0x01 && ((b[2] === 0 && b[3] === 0) || (b[2] === 0x0d && b[3] === 0xb8))) return true;
  // Unique local (fc00::/7), link-local (fe80::/10), old site-local (fec0::/10), multicast (ff00::/8).
  if ((b[0] & 0xfe) === 0xfc) return true;
  if (b[0] === 0xfe && (b[1] & 0xc0) >= 0x80) return true;
  if (b[0] === 0xff) return true;
  return false;
}

/** An address the server must never connect to. Anything that doesn't parse counts as blocked. */
export function isBlockedAddress(ip: string): boolean {
  const host = ip.replace(/^\[|\]$/g, "");
  const n = v4(host);
  if (n !== null) return blockedV4(n);
  if (IPV4.test(host)) return true;
  const b = v6(host);
  return b ? blockedV6(b) : true;
}

/**
 * A public Google Doc as plain text: docs.google.com/document/d/<id>/… reads as
 * /document/d/<id>/export?format=txt (published "/d/e/…" pages stay as they are). Other URLs unchanged.
 */
export function googleDocsExport(url: URL): URL {
  if (url.hostname !== "docs.google.com") return url;
  const m = /^\/document(?:\/u\/\d+)?\/d\/([A-Za-z0-9_-]{20,})(?:\/|$)/.exec(url.pathname);
  if (!m) return url;
  return new URL(`https://docs.google.com/document/d/${m[1]}/export?format=txt`);
}

/** Response types the board can read: web pages, text, PDFs and Word documents (and untyped files, sniffed in the browser). */
export function readableType(contentType: string): boolean {
  const t = contentType.split(";")[0].trim().toLowerCase();
  if (!t) return true;
  return (
    t.startsWith("text/") ||
    t === "application/xhtml+xml" ||
    t === "application/xml" ||
    t === "application/json" ||
    t === "application/pdf" ||
    t === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    t === "application/octet-stream"
  );
}
