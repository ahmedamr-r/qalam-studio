import { studio } from "@/doc/store";
import { descendants } from "@/doc/geometry";
import { fitText } from "@/doc/ops";
import type { Doc, SceneNode } from "@/doc/schema";
import { ensureYoga } from "@/engine/layout";
import { hasArabic } from "@/engine/text";
import { lintNodes } from "@/lint/rules";
import type { ScreenSpec } from "./builders";
import { buildScreenNodes, ensureSystemFonts, fingerprint } from "./place";
import { tokenSetFor } from "./registry";
import type { TokenSet } from "./resolve";

export type ApplyMode = "rebuild" | "reskin";

/** Top-level screens containing these nodes (deduplicated, in order). */
export function rootsOf(doc: Doc, ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    let n = doc.nodes[id];
    while (n?.parentId) n = doc.nodes[n.parentId];
    if (n && !out.includes(n.id)) out.push(n.id);
  }
  return out;
}

export const canRebuild = (doc: Doc, rootId: string) => !!doc.nodes[rootId]?.meta.spec;

/** Built from a spec, then changed by hand: a rebuild would throw those edits away. */
export function isEdited(doc: Doc, rootId: string): boolean {
  const n = doc.nodes[rootId];
  return !!n?.meta.spec && !!n.meta.specFingerprint && fingerprint(doc, rootId) !== n.meta.specFingerprint;
}

/** Re-resolve every token binding in a subtree against `ts` (mutates the draft); auto layout reflows it. */
export function reskinSubtree(d: Doc, rootId: string, ts: TokenSet) {
  const arabic = String(ts.get("font.family.arabic")?.value ?? "IBM Plex Sans Arabic");
  for (const id of [rootId, ...descendants(d, rootId)]) {
    const n = d.nodes[id] as SceneNode;
    if (n.fill?.token) {
      const p = ts.paint(n.fill.token);
      if (p) n.fill = p.gradient ? { color: p.color, token: n.fill.token, gradient: p.gradient } : { color: p.color, token: n.fill.token };
    }
    if (n.stroke) {
      const c = n.stroke.token ? ts.color(n.stroke.token) : undefined;
      const w = n.stroke.widthToken ? ts.dimension(n.stroke.widthToken) : undefined;
      if (c) n.stroke.color = c;
      if (w !== undefined) n.stroke.width = w;
    }
    if (n.radius?.token) {
      const v = ts.dimension(n.radius.token);
      if (v !== undefined) {
        const corners = ["tl", "tr", "br", "bl"] as const;
        const masked = corners.some((c) => n.radius![c].rx === 0) && corners.some((c) => n.radius![c].rx > 0);
        for (const c of corners) if (!masked || n.radius[c].rx > 0) n.radius[c] = { rx: v, ry: v };
      }
    }
    if (n.type === "frame" && n.layout) {
      const L = n.layout;
      const dim = (t?: string) => (t ? ts.dimension(t) : undefined);
      L.gap = dim(L.gapToken) ?? L.gap;
      L.crossGap = dim(L.crossGapToken) ?? L.crossGap;
      for (const k of ["top", "end", "bottom", "start"] as const) L.padding[k] = dim(L.paddingTokens?.[k]) ?? L.padding[k];
    }
    if (n.shadowToken) {
      const layers = ts.shadowLayers(n.shadowToken);
      if (layers) n.effects = layers.length ? layers : undefined;
    }
    if (n.type === "text" && n.text.typeToken) {
      const s = ts.typography(n.text.typeToken);
      if (s) {
        const isArabic = hasArabic(n.text.content);
        Object.assign(n.text, { fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, fontFamily: s.fontFamily });
        if (isArabic) {
          n.text.fontFamily = arabic;
          n.text.letterSpacing = 0;
          n.text.lineHeight = Math.max(s.lineHeight, Math.round(s.fontSize * 1.55));
        }
        fitText(n);
      }
    }
  }
}

/**
 * Move screens to a design system in one undo step. "rebuild" lays the screen out again from its
 * stored spec (new spacing, sizes and component recipes); "reskin" swaps token values in place.
 * Screens without a spec are always reskinned.
 */
export async function applyDesignSystem(ids: string[], dsId: string, mode: ApplyMode): Promise<string[]> {
  const roots = rootsOf(studio().doc, ids);
  if (!roots.length) return [];
  await Promise.all([ensureYoga(), ensureSystemFonts(dsId)]);
  const ts = tokenSetFor(dsId);
  const s = studio();
  s.beginTx();
  for (const id of roots) {
    const root = studio().doc.nodes[id];
    if (!root) continue;
    if (mode === "rebuild" && root.meta.spec) {
      replaceScreen(id, root.meta.spec, dsId);
    } else {
      studio().mutate((d) => {
        reskinSubtree(d, id, ts);
        d.nodes[id].meta.designSystem = dsId;
      });
      // Fingerprint the reflowed result (auto layout runs after each recipe).
      studio().mutate((d) => {
        const r = d.nodes[id];
        if (r.meta.spec) r.meta.specFingerprint = fingerprint(d, id);
      });
    }
  }
  s.commitTx();
  lintNodes(roots);
  return roots;
}

/** Swap a screen's subtree for a fresh build of `spec`, keeping the root id and position. */
export function replaceScreen(rootId: string, spec: ScreenSpec, dsId: string) {
  const old = studio().doc.nodes[rootId];
  // Passes that rewrite a screen (repair, restyle, critique fixes) return it without the components made for it.
  if (!spec.components && old.meta.spec?.components) spec = { ...spec, components: old.meta.spec.components };
  const nodes = buildScreenNodes(spec, dsId, { x: old.x, y: old.y }, old.meta.source);
  const newRoot = nodes[0].id;
  for (const n of nodes) {
    if (n.id === newRoot) n.id = rootId;
    if (n.parentId === newRoot) n.parentId = rootId;
  }
  nodes[0].name = old.name;
  studio().mutate((d) => {
    for (const k of descendants(d, rootId)) delete d.nodes[k];
    for (const n of nodes) d.nodes[n.id] = n;
    d.nodes[rootId].meta.specFingerprint = fingerprint(d, rootId);
  });
}
