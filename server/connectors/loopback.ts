import { execFile } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/*
 * Where a sign-in in the system's browser comes back to (shared by the MCP sign-ins in ./oauth.ts
 * and Google's in ./google.ts): a listener on this Mac's own addresses, open only for that sign-in,
 * the page it shows when it's done, and opening the service's page in the browser.
 */

/** A page to open in a browser: a web address only (`open` would start whatever a file or app address names). */
export function webAddress(u: URL): string {
  if (u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost"))) return u.href;
  throw new Error("The sign-in page isn't a web address.");
}

export function openInBrowser(url: string): Promise<void> {
  // Windows' own URL handler, never through a shell. Elsewhere the window's link opens it.
  const [cmd, ...args] = process.platform === "darwin" ? ["/usr/bin/open"] : process.platform === "linux" ? ["xdg-open"] : process.platform === "win32" ? ["rundll32.exe", "url.dll,FileProtocolHandler"] : [];
  return new Promise((resolve) => (cmd ? execFile(cmd, [...args, url], { timeout: 10_000 }, () => resolve()) : resolve()));
}

export interface Answer {
  code?: string;
  iss?: string;
  error?: string;
  errorDescription?: string;
  /** The page the browser shows (the browser waits for it while the code is exchanged). */
  reply: (ok: boolean, title: string, line: string) => void;
}

/**
 * The listener the service's page comes back to, on this Mac's own addresses only (`localhost` is
 * both 127.0.0.1 and ::1 to a browser): on `port` when it's free (the address Qalam registered
 * with), else any, unless the port is `fixed`. It takes one answer with the expected state on this
 * address, and turns everything else away; it closes on that answer, on `stop` or after `ms`.
 */
export async function listen(at: { port: number; host: string; fixed: boolean }, ms: number) {
  let expected = "";
  let settle: { resolve: (a: Answer) => void; reject: (e: Error) => void } | null = null;
  let taken = false;
  let held: ServerResponse | null = null;
  let ended: Error | null = null;
  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (taken || req.method !== "GET" || url.pathname !== "/callback" || req.headers.host !== `${at.host}:${bound}`) return send(res, 404, "Not here", "Qalam isn't waiting for anything at this address.");
    const state = url.searchParams.get("state") ?? "";
    if (!expected || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) return send(res, 400, "Not this sign-in", "This answer doesn't belong to the sign-in Qalam started.");
    const q = (k: string) => url.searchParams.get(k) ?? undefined;
    if (!q("code") && !q("error")) return send(res, 400, "Nothing came back", "The answer carried no code.");
    taken = true;
    held = res;
    for (const s of servers) s.close();
    settle?.resolve({ code: q("code"), iss: q("iss"), error: q("error"), errorDescription: q("error_description"), reply: (ok, title, line) => reply(ok ? 200 : 400, title, line) });
  };
  const servers = [createServer(handle), ...(at.host === "localhost" ? [createServer(handle)] : [])];
  const [server] = servers;
  const reply = (status: number, title: string, line: string) => {
    if (held && !held.headersSent) send(held, status, title, line);
    held = null;
  };
  const bound = await new Promise<number>((resolve, reject) => {
    const on = (p: number) => server.listen(p, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
    server.once("error", (e: NodeJS.ErrnoException) => {
      if (e.code !== "EADDRINUSE" || !at.port || at.fixed) return reject(e);
      server.once("error", reject);
      on(0);
    });
    on(at.port);
  });
  // The same port on ::1, where a Mac without IPv6 has none.
  if (servers[1]) await new Promise<void>((resolve) => servers[1].once("error", () => resolve()).listen(bound, "::1", () => resolve()));
  const timer = setTimeout(() => stop(new Error("The sign-in wasn't finished in time. Try again.")), ms);
  const stop = (why?: Error) => {
    clearTimeout(timer);
    if (!taken && why) settle?.reject(why);
    ended ??= why ?? new Error("The sign-in is over.");
    taken = true;
    reply(400, "Sign-in stopped", "Start it again from Qalam Studio.");
    for (const s of servers) {
      s.close();
      s.closeAllConnections();
    }
  };
  return {
    url: `http://${at.host}:${bound}/callback`,
    answer: (state: string) =>
      new Promise<Answer>((resolve, reject) => {
        if (ended) return reject(ended);
        expected = state;
        settle = { resolve, reject };
      }),
    /** Throws when it was stopped meanwhile (nothing is kept then). */
    check: () => {
      if (ended) throw ended;
    },
    stop,
  };
}

/** A small page with no script, saying how it went. */
export function send(res: ServerResponse, status: number, title: string, line: string) {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", connection: "close" });
  res.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>${esc(title)}</title><style>body{font:15px/1.5 -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:80vh;margin:0}main{max-width:380px;padding:0 16px;text-align:center}h1{font-size:17px;font-weight:600;margin:0 0 6px}p{margin:0;opacity:.7}</style></head><body><main><h1>${esc(title)}</h1><p>${esc(line)}</p></main></body></html>`,
  );
}
