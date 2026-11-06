/*
 * A website's own little icon, beside what was read there (pure; the core fetches it,
 * server/favicon.ts). Asked of the site itself, never of a favicon service, so no one else hears
 * which sites were read. Only bitmaps: an SVG served from this origin could run as a page.
 */

/** A web address's host, lower case, or null. */
export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOST = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})+$`);

/** A host name with a dot in it and nothing else: safe as a file name and as an address's host. */
export const isHost = (host: string) => HOST.test(host);

/** Where the window asks for a site's icon. */
export const faviconHref = (host: string) => `/api/favicon?host=${encodeURIComponent(host)}`;

export type IconType = "image/png" | "image/x-icon" | "image/gif" | "image/jpeg" | "image/webp";

/** What a picture is by its first bytes, among the kinds a favicon comes in (no SVG). */
export function iconType(b: Uint8Array): IconType | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 6 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return "image/x-icon";
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "").replace(/&amp;/g, "&").trim() : null;
};

/**
 * The icons a page names in its head, best first: one about 32px, then bigger, then any size,
 * then a touch icon. SVG and mask icons are left out. Addresses are resolved against the page.
 */
export function iconLinks(html: string, base: string): string[] {
  const found: { href: string; score: number }[] = [];
  for (const m of html.slice(0, 300_000).matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (attr(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const touch = rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed");
    if (!rel.includes("icon") && !touch) continue;
    const href = attr(tag, "href");
    if (!href || /svg/i.test(attr(tag, "type") ?? "") || /\.svg(?:[?#]|$)/i.test(href) || /^data:image\/svg/i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (!["https:", "http:", "data:"].includes(url.protocol)) continue;
    const size = Math.max(0, ...(attr(tag, "sizes") ?? "").split(/\s+/).map((s) => Number(/^(\d+)x\d+$/i.exec(s)?.[1] ?? 0)));
    const score = size >= 32 ? 1000 - size : size ? size : touch ? 400 : 500;
    found.push({ href: url.href, score });
  }
  return [...new Set(found.sort((a, b) => b.score - a.score).map((f) => f.href))].slice(0, 3);
}

/** An icon written into the page itself, as bytes. */
export function dataIcon(href: string): Uint8Array | null {
  const m = /^data:image\/[a-z.+-]+;base64,([a-z0-9+/=\s]+)$/i.exec(href);
  if (!m) return null;
  try {
    return Uint8Array.from(atob(m[1].replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
