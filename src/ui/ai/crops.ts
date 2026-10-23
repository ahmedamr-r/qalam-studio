import { putAsset } from "@/doc/assets";
import { cropRefs, parseCrop, replaceRefs } from "@/design-system/crops";

/**
 * Cut the pictures a rebuilt screen (or a component read from a screenshot) points at
 * ("crop:x,y,w,h") out of its source screenshot and store them as assets, so it shows the source's
 * own photos, logos and illustrations.
 * `scale` maps the model's coordinates (the image it saw) to the source's pixels.
 */
export async function cutCrops<T>(spec: T, source: Blob, scale: { x: number; y: number } = { x: 1, y: 1 }): Promise<T> {
  const refs = cropRefs(spec);
  if (!refs.length) return spec;
  const bmp = await createImageBitmap(source);
  const map = new Map<string, string>();
  for (const ref of refs) {
    const b = parseCrop(ref)!;
    const sx = Math.max(0, Math.round(b.x * scale.x));
    const sy = Math.max(0, Math.round(b.y * scale.y));
    const sw = Math.min(bmp.width - sx, Math.round(b.w * scale.x));
    const sh = Math.min(bmp.height - sy, Math.round(b.h * scale.y));
    if (sw < 2 || sh < 2) continue;
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d")!.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (blob) map.set(ref, await putAsset(blob));
  }
  bmp.close();
  return replaceRefs(spec, map);
}
