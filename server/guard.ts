/**
 * Only the user's own browser may reach the core when it listens on a port (the dev server and the
 * browser mode; the desktop app has no port). The core's routes spawn Claude Code and, soon, write
 * files, so a page on another site must not be able to call them:
 * - Host must name this machine (blocks DNS rebinding, where evil.com is re-pointed at 127.0.0.1).
 * - Anything but GET/HEAD/OPTIONS must come from this origin (blocks cross-site form and fetch posts;
 *   browsers always send Origin on those).
 * - With a launch token, every API request must also carry it (cookie or header).
 */

export interface GuardConfig {
  /** The port the core listens on; Host must carry it. */
  port: number;
  /** `<name>.localhost` hosts are allowed too (dev: separate browser storage per test). */
  subdomains?: boolean;
  /** Set by the launcher: requests must carry it as the cookie or the `x-qalam-token` header. */
  token?: string;
}

export interface RequestFacts {
  method: string;
  host: string | null;
  origin: string | null;
  cookie: string | null;
  tokenHeader: string | null;
}

export type Verdict = { ok: true } | { ok: false; status: 403; reason: string };

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** The cookie a launch token is kept in. Cookies are shared across ports on one host, so the name carries the port. */
export const tokenCookie = (port: number) => `qalam_t_${port}`;

/** Host names that mean this machine. */
export function localHost(host: string | null, cfg: GuardConfig): boolean {
  if (!host) return false;
  const m = /^(\[::1\]|[a-z0-9.-]+):(\d+)$/i.exec(host.trim());
  if (!m || Number(m[2]) !== cfg.port) return false;
  const name = m[1].toLowerCase();
  if (name === "127.0.0.1" || name === "localhost" || name === "[::1]") return true;
  return !!cfg.subdomains && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.localhost$/.test(name);
}

function cookieValue(cookie: string | null, name: string): string | null {
  for (const part of (cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Whether a request to the core may go ahead. */
export function checkRequest(r: RequestFacts, cfg: GuardConfig): Verdict {
  if (!localHost(r.host, cfg)) return { ok: false, status: 403, reason: "This address isn't Qalam on this computer." };
  if (!SAFE.has(r.method.toUpperCase()) && r.origin !== `http://${r.host}`) return { ok: false, status: 403, reason: "Requests from other sites aren't allowed." };
  if (cfg.token && cookieValue(r.cookie, tokenCookie(cfg.port)) !== cfg.token && r.tokenHeader !== cfg.token) return { ok: false, status: 403, reason: "Open Qalam from the link it printed when it started." };
  return { ok: true };
}

/**
 * Opening the printed link (`…/?t=<token>`) keeps the token in a cookie and drops it from the
 * address, so it isn't left in history or shared by copying the URL. Null when there's nothing to do.
 */
export function tokenLanding(url: URL, cfg: GuardConfig): { location: string; setCookie: string } | null {
  const t = url.searchParams.get("t");
  if (!cfg.token || t !== cfg.token) return null;
  const clean = new URL(url);
  clean.searchParams.delete("t");
  return { location: clean.pathname + clean.search, setCookie: `${tokenCookie(cfg.port)}=${encodeURIComponent(cfg.token)}; Path=/; HttpOnly; SameSite=Strict` };
}

/** The facts the guard needs, read from a standard Request. */
export function factsOf(req: Request): RequestFacts {
  const h = req.headers;
  return { method: req.method, host: h.get("host"), origin: h.get("origin"), cookie: h.get("cookie"), tokenHeader: h.get("x-qalam-token") };
}
