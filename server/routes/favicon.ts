import { isHost } from "@/discovery/favicon";
import { faviconFor } from "../favicon";

/** A site's icon (server/favicon.ts), for an <img>: a bitmap or a 404, each kept a while by the window. */
export async function GET(req: Request) {
  const host = (new URL(req.url).searchParams.get("host") ?? "").toLowerCase();
  if (!isHost(host)) return Response.json({ error: "bad_input", message: "That isn't a site's name." }, { status: 400 });
  const icon = await faviconFor(host).catch(() => null);
  if (!icon) return new Response(null, { status: 404, headers: { "cache-control": "private, max-age=86400" } });
  return new Response(icon.bytes as BodyInit, {
    headers: {
      "content-type": icon.type,
      "cache-control": "private, max-age=604800",
      "content-security-policy": "default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}
