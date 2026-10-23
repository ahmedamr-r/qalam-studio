import { FONT_FAMILIES, getEngine, loadEngine } from "./canvaskit";

/**
 * Runtime font loading for design systems whose typefaces aren't bundled. Families are fetched
 * from Google Fonts as TTF, registered with CanvasKit (for rendering and measurement) and with
 * document.fonts (for panel previews). Text must be measured after this resolves, or layouts use
 * fallback metrics.
 */

const ready = new Set<string>(FONT_FAMILIES);
const pending = new Map<string, Promise<boolean>>();
const failed = new Set<string>();
const listeners = new Set<() => void>();

export const onFontsChanged = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const loadedFamilies = () => [...ready].sort();
export const fontFailed = (family: string) => failed.has(family);

async function load(family: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/fonts?family=${encodeURIComponent(family)}`);
    if (!r.ok) throw new Error(String(r.status));
    const { files } = (await r.json()) as { files: { weight: number; url: string }[] };
    const buffers = await Promise.all(files.map(async (f) => ({ weight: f.weight, bytes: await (await fetch(f.url)).arrayBuffer() })));
    await loadEngine();
    const { fonts } = getEngine();
    for (const b of buffers) {
      fonts.registerFont(b.bytes, family);
      if (typeof FontFace !== "undefined") {
        const face = new FontFace(family, b.bytes, { weight: String(b.weight) });
        await face.load();
        document.fonts.add(face);
      }
    }
    ready.add(family);
    return true;
  } catch {
    failed.add(family);
    return false;
  }
}

/** Make sure every family is renderable. Unknown families fall back to Inter at draw time. */
export async function ensureFonts(families: Iterable<string>): Promise<void> {
  const todo = [...new Set(families)].filter((f) => f && !ready.has(f) && !failed.has(f));
  if (!todo.length) return;
  const results = await Promise.all(
    todo.map((f) => {
      let p = pending.get(f);
      if (!p) {
        p = load(f);
        pending.set(f, p);
      }
      return p;
    }),
  );
  if (results.some(Boolean)) listeners.forEach((fn) => fn());
}
