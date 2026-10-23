import { assetURL, isAsset } from "@/doc/assets";
import { rootsOf } from "@/design-system/apply";
import { tokenSetFor } from "@/design-system/registry";
import { ensureSystemFonts } from "@/design-system/place";
import type { Doc } from "@/doc/schema";
import { protoScreens } from "@/doc/proto";
import { descendants } from "@/doc/geometry";
import { ensureYoga } from "@/engine/layout";
import { compilePrototype, type CompileResult } from "@/codegen/compile";
import { buildStateVariants } from "@/codegen/variants";
import { isPart, partFrames, partOf } from "@/proto/routes";

/**
 * What Prototype mode plays: the selected screens and every screen their links lead to (or the
 * prototype's screens when nothing is selected), compiled once for the preview (pictures as object
 * URLs) and once for export (pictures as /assets/<hash>).
 */
export interface BuiltPrototype {
  /** Plays in the studio. */
  preview: CompileResult;
  /** Copy / Download. */
  code: string;
  warnings: string[];
}

/**
 * Screens to play: the selection's screens and what their links and rules reach; else the
 * prototype's; else every screen. A selected sheet or bar plays the screen it belongs to.
 */
export function playScreens(doc: Doc, selection: string[]): { screens: string[]; start?: string } {
  const frames = rootsOf(doc, selection).filter((id) => doc.nodes[id]?.type === "frame");
  const picked = [...new Set(frames.map((id) => partOf(doc, id)?.owner ?? id))];
  if (!picked.length) {
    const proto = protoScreens(doc);
    return { screens: proto.length ? proto : doc.roots.filter((id) => doc.nodes[id]?.type === "frame" && !isPart(doc, id)) };
  }
  const out = [...picked];
  const reach = (to: string) => {
    if (doc.nodes[to] && !out.includes(to)) out.push(to);
  };
  for (let i = 0; i < out.length; i++) {
    for (const l of doc.proto?.links ?? []) if (l.from.screen === out[i] && typeof l.to === "object" && "screen" in l.to) reach(l.to.screen);
    for (const ru of doc.proto?.routes?.[out[i]]?.rules ?? []) for (const a of ru.then) if (a.do === "go") reach(a.screen);
  }
  // One screen selected: start there. Several: where the prototype starts, if it's one of them.
  const start = picked.length > 1 && doc.proto?.start && out.includes(doc.proto.start) ? doc.proto.start : picked[0];
  return { screens: doc.roots.filter((id) => out.includes(id)), start };
}

export async function buildPrototype(doc: Doc, selection: string[], title?: string): Promise<BuiltPrototype> {
  const { screens, start } = playScreens(doc, selection);
  const dsId = doc.nodes[screens[0]]?.meta.designSystem ?? "builtin";
  await Promise.all([ensureYoga(), ensureSystemFonts(dsId)]);
  const { variants, warnings } = buildStateVariants(doc, screens);
  const ts = tokenSetFor(dsId);
  const typography = (path: string) => ts.typography(path);

  const images = new Map<string, string>();
  // Pictures in the screens' parts (a dish photo in its sheet) play too.
  for (const id of [...screens, ...screens.flatMap((s) => partFrames(doc, s).map((p) => p.frame))]) {
    for (const d of descendants(doc, id)) {
      const n = doc.nodes[d];
      if (n?.type === "image" && isAsset(n.src) && !images.has(n.src)) images.set(n.src, (await assetURL(n.src)) ?? n.src);
    }
  }
  const opts = { screens, start, variants, typography, title };
  // The preview marks its layers for the session's markers and cursor; the export never does.
  const preview = compilePrototype(doc, { ...opts, imageUrl: (src) => images.get(src) ?? src, preview: true });
  const exported = compilePrototype(doc, opts);
  return { preview, code: exported.code, warnings: [...warnings, ...exported.warnings] };
}
