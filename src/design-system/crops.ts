/**
 * Pictures in a spec. A model rebuilding a screenshot can't send image bytes, so it points at the
 * picture instead: "crop:x,y,w,h", a box in pixels of the screenshot as it saw it. Before the
 * screen is placed, the studio cuts those boxes out of the source and stores them as assets
 * (src/ui/ai/crops.ts), so the spec ends up holding "asset:" references like any other image.
 */

export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CROP = /^crop:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*$/;

/** A crop reference's box, or null when it isn't one (or the box is empty). */
export function parseCrop(ref: string): CropBox | null {
  const m = CROP.exec(ref);
  if (!m) return null;
  const [x, y, w, h] = m.slice(1).map(Number);
  return w >= 2 && h >= 2 ? { x: Math.max(0, x), y: Math.max(0, y), w, h } : null;
}

/** Something an image prop can hold: a crop of the source, a stored asset, a data URL or an app path. */
export function isImageRef(ref: string): boolean {
  return ref === "" || !!parseCrop(ref) || ref.startsWith("asset:") || /^data:image\/[a-z+]+;base64,/.test(ref) || /^\/[\w\-./]+\.(png|jpe?g|webp|svg)$/i.test(ref);
}

/** Shown as a picture (not a placeholder): stored or served, not a crop still to cut. */
export const isDrawable = (ref: string | undefined): ref is string => !!ref && isImageRef(ref) && !parseCrop(ref);

/** Every crop reference in a spec (any depth, any prop), or in a component's composition. */
export function cropRefs(spec: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (parseCrop(v)) out.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(spec);
  return [...out];
}

/** The spec with references swapped (crop → asset); a crop left out of `map` becomes a placeholder. */
export function replaceRefs<T>(spec: T, map: Map<string, string>): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return parseCrop(v) ? (map.get(v) ?? "") : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(spec) as T;
}
