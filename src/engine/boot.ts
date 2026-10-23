import { loadEngine } from "./canvaskit";
import { measureTextProps } from "./text";
import { setTextMeasurer } from "@/doc/ops";
import { ensureYoga } from "@/doc/autolayout";

/**
 * CanvasKit, Yoga and the text measurer: what the studio and the interview's previews both need
 * before they can build or draw a screen. Each loader keeps one shared promise, so this is cheap
 * to call again.
 */
let booted: Promise<void> | null = null;
export function bootEngine(): Promise<void> {
  booted ??= Promise.all([loadEngine(), ensureYoga()]).then(() => setTextMeasurer(measureTextProps));
  booted.catch(() => {
    booted = null;
  });
  return booted;
}
