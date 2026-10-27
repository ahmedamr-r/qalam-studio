import { z } from "zod";
import { FetchRefused, fetchGuarded } from "@/discovery/fetch-guard";

const Body = z.object({ url: z.string().trim().min(4).max(2048) });

// Its own small limit (it isn't an AI call, so it doesn't spend the AI's).
const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 40;
function limited(req: Request): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  return list.length > MAX_HITS;
}

const error = (status: number, code: string, message: string) => Response.json({ error: code, message }, { status });

/**
 * A web page for a Discovery board's sources: fetched here (the browser can't read other sites),
 * checked at every hop (src/discovery/fetch-guard.ts), and returned as it came. The browser turns
 * it into text, so quotes are checked against exactly what the page said. The body goes back as
 * opaque bytes, never rendered from this origin; its own type rides along in x-source-type.
 */
export async function POST(req: Request) {
  // JSON only: a form on another site can't send it.
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) return error(415, "bad_input", "Send JSON.");
  if (limited(req)) return error(429, "rate_limited", "Too many pages read, try again in a few minutes.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error(400, "bad_input", "That isn't a web address.");
  try {
    const page = await fetchGuarded(parsed.data.url, { signal: req.signal });
    return new Response(page.body as BodyInit, {
      headers: {
        "content-type": "application/octet-stream",
        "content-security-policy": "sandbox",
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
        "x-source-type": page.contentType.slice(0, 200),
        // A URL's href is plain ASCII (punycode, percent-escapes): safe as a header.
        "x-final-url": page.url.slice(0, 2048),
        ...(page.truncated ? { "x-truncated": "1" } : {}),
      },
    });
  } catch (e) {
    if (e instanceof FetchRefused) return error(e.status, e.code, e.message);
    return error(502, "unreachable", "Couldn't read that page.");
  }
}
