import { getAssetBlob } from "@/doc/assets";
import { prepareImage } from "@/design-system/extract";
import type { DesignSystem } from "@/design-system/registry";
import type { References } from "@/ai/references";

const cache = new Map<string, Promise<References[number] | null>>();

/**
 * Up to two of the screenshots a system was extracted from, downsized for prompts (about 1280 px,
 * JPEG, under 900 KB each). Systems without sources (the built-in one, copies of it) have none.
 */
export async function referenceImages(ds: DesignSystem, max = 2): Promise<References> {
  const refs = await Promise.all(
    (ds.sources ?? []).slice(0, max).map((src) => {
      let p = cache.get(src);
      if (!p) {
        p = getAssetBlob(src)
          .then((b) => (b ? prepareImage(b, 1280, { maxBytes: 900_000 }) : null))
          .then((im) => (im ? { mediaType: im.mediaType, data: im.data } : null))
          .catch(() => null);
        cache.set(src, p);
      }
      return p;
    }),
  );
  return refs.filter((r): r is References[number] => !!r);
}
