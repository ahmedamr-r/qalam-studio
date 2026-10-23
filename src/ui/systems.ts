import { studio } from "@/doc/store";
import { release, reserve } from "@/doc/reservations";
import { callAI } from "@/ai/client";
import type { RestyleResult } from "@/ai/ds-schemas";
import { systemPayload } from "@/ai/ds-payload";
import { systemFor } from "@/design-system/registry";
import { ensureSystemFonts } from "@/design-system/place";
import { replaceScreen, rootsOf } from "@/design-system/apply";
import { ensureYoga } from "@/engine/layout";
import { lintNodes } from "@/lint/rules";
import type { ScreenSpec } from "@/design-system/builders";
import { nodeToDataURL } from "./exporter";
import { outline } from "./ai/outline";
import { referenceImages } from "./ai/references";

/**
 * AI restyle of selected parts of a screen, in a design system's language. (Extracting a design
 * system from screenshots is a chat tool: src/ui/ai/extract.ts.)
 */

export interface RestyleOutcome {
  rootId: string;
  changes: RestyleResult["changes"];
  model?: string;
}

const keysOf = (path: string) => path.split(".").map((k) => (/^\d+$/.test(k) ? Number(k) : k));
function getAt(o: unknown, path: string): unknown {
  let n = o;
  for (const k of keysOf(path)) n = n && typeof n === "object" ? (n as Record<string | number, unknown>)[k] : undefined;
  return n;
}

/**
 * Only the selected parts may change: take the model's version of each targeted subtree and put
 * it into the original spec. If the model restructured so a path no longer exists, use its whole
 * answer.
 */
export function spliceTargets(original: ScreenSpec, revised: ScreenSpec, paths: string[]): ScreenSpec {
  const out = structuredClone(original);
  for (const p of paths) {
    const value = getAt(revised, p);
    const keys = keysOf(p);
    const parent = getAt(out, keys.slice(0, -1).join("."));
    if (value === undefined || !parent || typeof parent !== "object") return revised;
    (parent as Record<string | number, unknown>)[keys[keys.length - 1]] = structuredClone(value);
  }
  return out;
}

/** Nearest catalog instance at or above each selected node, as spec paths. */
function targetsFor(rootId: string, ids: string[]): { paths: string[]; names: string[] } {
  const { doc } = studio();
  const paths: string[] = [];
  const names: string[] = [];
  for (const id of ids) {
    if (id === rootId) return { paths: [], names: [] };
    let n = doc.nodes[id];
    while (n && n.meta.specPath === undefined && n.parentId) n = doc.nodes[n.parentId];
    if (n?.meta.specPath !== undefined && !paths.includes(n.meta.specPath)) {
      paths.push(n.meta.specPath);
      names.push(n.meta.component ?? n.name);
    }
  }
  return { paths, names };
}

/**
 * Ask Claude to revamp the selected parts of a screen in a design system's language, then rebuild
 * the screen with that system (one undo step). Screens drawn by hand are rebuilt as a whole.
 */
export async function restyleSelection(dsId: string, onProgress?: (t: number) => void, signal?: AbortSignal): Promise<RestyleOutcome> {
  const { doc, selection } = studio();
  const [rootId] = rootsOf(doc, selection);
  if (!rootId) throw new Error("Select a screen or part of one.");
  const root = doc.nodes[rootId];
  const ds = systemFor(dsId);
  const spec = root.meta.spec;
  const { paths, names } = spec ? targetsFor(rootId, selection) : { paths: [], names: [] };
  const img = spec ? null : nodeToDataURL(rootId, 1);
  // The screen shimmers while it's being restyled.
  const held = reserve("Restyling", [], [rootId]);
  let res: { data: RestyleResult; model?: string };
  try {
    res = await callAI<RestyleResult>(
      "/api/restyle",
      {
        spec,
        outline: spec ? undefined : outline(doc, rootId),
        image: img ? img.split(",")[1] : undefined,
        targets: paths,
        targetNames: names,
        designSystem: systemPayload(ds),
        references: (await referenceImages(ds)) || undefined,
      },
      onProgress,
      signal,
    );
  } finally {
    release(held);
  }
  const { data, model } = res;
  await Promise.all([ensureYoga(), ensureSystemFonts(ds.id)]);
  const revised: ScreenSpec = { ...data.screen, name: data.screen.name || spec?.name || root.name };
  const next = spec && paths.length ? spliceTargets(spec, revised, paths) : revised;
  studio().beginTx();
  replaceScreen(rootId, next, ds.id);
  studio().commitTx();
  lintNodes([rootId]);
  studio().select([rootId]);
  return { rootId, changes: data.changes ?? [], model };
}
