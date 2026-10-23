import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Development only: an import file from `.qalam-dev/` (git-ignored), for `?devImport=<name>` in the
 * studio (src/ui/devhooks.ts). Each browser keeps its own canvas, so this is how screens made outside
 * the designer's browser (by a script or another session) reach it.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const name = request.nextUrl.searchParams.get("name") ?? "";
  if (!/^\w[\w.-]*$/.test(name)) return Response.json({ error: "Bad import name" }, { status: 400 });
  try {
    const dir = path.resolve(process.env.QALAM_DEV_DIR ?? ".qalam-dev");
    const body = await readFile(path.join(dir, `${name}.json`), "utf8");
    return new Response(body, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: `No .qalam-dev/${name}.json` }, { status: 404 });
  }
}
