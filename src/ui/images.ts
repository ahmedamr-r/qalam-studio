import { studio } from "@/doc/store";
import { makeImage } from "@/doc/factory";
import { insertNodes } from "@/doc/ops";
import { putAsset } from "@/doc/assets";
import { prepareImage } from "@/design-system/extract";
import { nextSlot } from "@/design-system/place";

/** Screenshots are usually @2x/@3x: show a phone capture at 390pt wide, anything else within 1200×844. */
function displaySize(w: number, h: number) {
  const s = Math.min(1, 844 / h, 1200 / w, h / w > 1.6 ? 390 / w : Infinity);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

/**
 * Put image files on the canvas at a world point (dropped), or in free space to the right of the
 * existing content (pasted). Images are stored in the asset store at up to 2576px, the largest
 * size Claude reads, and selected afterwards.
 */
export async function placeImages(files: Blob[], at?: { x: number; y: number }): Promise<string[]> {
  const slot = at ?? nextSlot();
  let x = slot.x;
  const y = slot.y;
  const ids: string[] = [];
  studio().beginTx();
  try {
    for (const f of files) {
      const img = await prepareImage(f, 2576, { lossless: true });
      const src = await putAsset(await (await fetch(img.dataUrl)).blob());
      const size = displaySize(img.width, img.height);
      const name = (f instanceof File && f.name.replace(/\.[a-z0-9]+$/i, "")) || "Screenshot";
      const node = makeImage(src, { x: Math.round(x), y: Math.round(y), ...size, name, meta: { source: "import" } });
      insertNodes([node], null, undefined, false);
      ids.push(node.id);
      x += size.w + 40;
    }
  } finally {
    studio().commitTx();
  }
  studio().select(ids);
  return ids;
}

export const imageFiles = (list: FileList | DataTransferItemList | null | undefined): File[] => {
  if (!list) return [];
  const out: File[] = [];
  for (const it of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const f = "getAsFile" in it ? (it.kind === "file" ? it.getAsFile() : null) : it;
    if (f && f.type.startsWith("image/")) out.push(f);
  }
  return out;
};
