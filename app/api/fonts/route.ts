export const dynamic = "force-dynamic";

const FAMILY = /^[A-Za-z0-9 ]{1,40}$/;
const WEIGHTS = [400, 500, 600, 700];

/**
 * TTF URLs for a Google Font. Google's css2 endpoint returns TrueType (which CanvasKit can read)
 * when the request has no browser user agent; each weight is requested on its own because a
 * family that lacks one weight fails the whole multi-weight request.
 */
export async function GET(req: Request) {
  const family = new URL(req.url).searchParams.get("family")?.trim() ?? "";
  if (!FAMILY.test(family)) return Response.json({ error: "bad_family", message: "Unsupported font family name." }, { status: 400 });
  const q = encodeURIComponent(family).replace(/%20/g, "+");
  const files = (
    await Promise.all(
      WEIGHTS.map(async (weight) => {
        try {
          const r = await fetch(`https://fonts.googleapis.com/css2?family=${q}:wght@${weight}`, { headers: { "user-agent": "" }, cache: "force-cache" });
          if (!r.ok) return null;
          const url = (await r.text()).match(/src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/)?.[1];
          return url ? { weight, url } : null;
        } catch {
          return null;
        }
      }),
    )
  ).filter((f): f is { weight: number; url: string } => !!f);
  if (!files.length) return Response.json({ error: "not_found", message: `"${family}" is not on Google Fonts.` }, { status: 404 });
  return Response.json({ family, files }, { headers: { "cache-control": "public, max-age=86400" } });
}
