import { isDraft } from "immer";
import type { TextProps } from "./schema";

// Text measurement is provided by the engine once CanvasKit is ready.

export type TextMeasurer = (t: TextProps, maxWidth: number | null) => { w: number; h: number };

let measurer: TextMeasurer = (t) => ({ w: t.content.length * t.fontSize * 0.55, h: t.lineHeight });
/** Results per TextProps object (they are replaced, never mutated, outside immer drafts). */
let cache = new WeakMap<TextProps, Map<number, { w: number; h: number }>>();

export const setTextMeasurer = (m: TextMeasurer) => {
  measurer = m;
  clearMeasureCache();
};

/** Drop cached sizes, e.g. when a typeface finishes loading. */
export const clearMeasureCache = () => {
  cache = new WeakMap();
};

export const measureText: TextMeasurer = (t, w) => {
  if (isDraft(t)) return measurer(t, w);
  let byWidth = cache.get(t);
  if (!byWidth) cache.set(t, (byWidth = new Map()));
  const key = w ?? -1;
  let m = byWidth.get(key);
  if (!m) byWidth.set(key, (m = measurer(t, w)));
  return m;
};
