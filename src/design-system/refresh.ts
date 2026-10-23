import { current, isDraft } from "immer";
import type { Doc, FrameNode, SceneNode } from "@/doc/schema";
import { descendants } from "@/doc/geometry";
import { isEdited, reskinSubtree } from "./apply";
import { hasBackdrop, isDarkColor, platformOf, type BuildCtx, type ScreenSpec } from "./builders";
import { marginFor } from "./platform";
import { instOf, isOverridden } from "./instances";
import { buildScreenNodes, componentNodes, fingerprint } from "./place";
import { systemFor, tokenSetFor } from "./registry";
import { componentLookup } from "./custom";

/**
 * Bringing screens up to date with their design system (the source of every component). All of
 * it works on a document draft, so a whole refresh is one mutation.
 */

/** What an instance keeps from its old self when rebuilt: where and how it sits in its parent. */
const PLACEMENT = ["x", "y", "flipH", "flipV", "sizeH", "sizeV", "absolute", "minW", "maxW", "minH", "maxH", "grow", "margin", "rotation", "opacity", "visible", "locked", "name"] as const;

/**
 * Put freshly built nodes in place of the subtree at `oldId`. Nodes at the same place with the
 * same type keep their ids, so selection survives; the top keeps its placement (or, for a
 * root, just its position and name).
 */
function transplant(d: Doc, oldId: string, fresh: SceneNode[], keep: readonly (keyof SceneNode)[]) {
  const old = d.nodes[oldId];
  const byId = new Map(fresh.map((n) => [n.id, n]));
  const top = fresh[0];
  const ids = new Map<string, string>([[top.id, oldId]]);
  const match = (newId: string, prevId: string) => {
    const a = byId.get(newId)!;
    const b = d.nodes[prevId];
    a.children.forEach((c, i) => {
      const pc = b?.children[i];
      if (pc && d.nodes[pc]?.type === byId.get(c)?.type) {
        ids.set(c, pc);
        match(c, pc);
      }
    });
  };
  match(top.id, oldId);
  const reused = new Set(ids.values());
  for (const k of descendants(d, oldId)) if (!reused.has(k)) delete d.nodes[k];
  const map = (id: string) => ids.get(id) ?? id;
  for (const n of fresh) {
    const next = { ...n, id: map(n.id), parentId: n === top ? old.parentId : n.parentId && map(n.parentId), children: n.children.map(map) } as SceneNode;
    if (n === top) {
      for (const k of keep) (next as unknown as Record<string, unknown>)[k] = (old as unknown as Record<string, unknown>)[k];
      next.meta = {
        ...next.meta,
        source: old.meta.source,
        // A component placed on its own is a root: it stays bound to its system.
        ...(!next.meta.designSystem && old.meta.designSystem ? { designSystem: old.meta.designSystem } : {}),
        ...(old.meta.inst ? { inst: old.meta.inst } : {}),
        ...(old.meta.specPath !== undefined ? { specPath: old.meta.specPath } : {}),
      };
    }
    d.nodes[next.id] = next;
  }
}

/** Specs and instances read from a document draft, as plain data for the builders. */
const plain = <T>(v: T): T => (isDraft(v) ? (current(v as never) as T) : v);

/**
 * How to build an instance of a screen the way buildScreen did: its direction, language, platform,
 * margin, system and components, and the surface under it. `path` (its spec path) says where it
 * sits: what's in the header or hero of a dark backdrop is drawn light.
 */
export const ctxFor = (d: Doc, rootId: string, dsId: string, path?: string): BuildCtx => {
  const root = d.nodes[rootId];
  const spec = root.meta.spec;
  const dir = root.type === "frame" ? (root as FrameNode).dir : (spec?.dir ?? "ltr");
  const ts = tokenSetFor(dsId);
  const platform = platformOf(spec ?? {});
  const backdrop = hasBackdrop(spec);
  const darkTop = backdrop && !!path && /^(header|hero)\./.test(path) && isDarkColor(ts.paint("component.backdrop.fill")?.color);
  return {
    dir,
    lang: spec?.lang ?? (dir === "rtl" ? "ar" : "en"),
    ts,
    platform,
    gutter: marginFor(platform, spec?.margin, ts.dimension("layout.gutter")),
    backdrop,
    components: componentLookup(systemFor(dsId).docs.patterns, spec?.components),
    surface: spec?.background === "surface" && !backdrop ? "bg.surface" : "bg.canvas",
    ...(darkTop ? { onDark: true } : {}),
  };
};

/** Rebuild one instance from its source, keeping how it sits in its parent. */
export function rebuildInstance(d: Doc, id: string, rootId: string, dsId: string): boolean {
  const n = d.nodes[id];
  const inst = plain(instOf(d, id));
  if (!n || !inst) return false;
  const fresh = componentNodes(inst, ctxFor(d, rootId, dsId, n.meta.specPath), Math.max(1, n.w), n.meta.inst ? undefined : n.meta.specPath);
  transplant(d, id, fresh, PLACEMENT);
  return true;
}

/**
 * Rebuild a screen from a new spec (e.g. with part of it replaced). Layers that come out the same
 * keep their ids, so the selection and anything pointing at them survive.
 */
export function rebuildScreen(d: Doc, rootId: string, spec: ScreenSpec) {
  const root = d.nodes[rootId];
  if (!root) return;
  const dsId = root.meta.designSystem ?? "builtin";
  transplant(d, rootId, buildScreenNodes(plain(spec), dsId, { x: root.x, y: root.y }, root.meta.source), ["x", "y", "name"]);
  d.nodes[rootId].meta.specFingerprint = fingerprint(d, rootId);
}

/**
 * Refresh a root (a screen, or a component placed on its own) with the current version of its
 * design system. An untouched screen is rebuilt from its spec. Otherwise every token binding is
 * re-resolved, and each instance the designer hasn't overridden is rebuilt; overridden ones keep
 * their changes (their token-bound colours, radii and type still follow).
 */
export function refreshRoot(d: Doc, rootId: string) {
  const root = d.nodes[rootId];
  if (!root) return;
  const dsId = root.meta.designSystem ?? "builtin";
  const version = systemFor(dsId).updatedAt;
  if (root.meta.spec && !isEdited(d, rootId)) {
    transplant(d, rootId, buildScreenNodes(plain(root.meta.spec), dsId, { x: root.x, y: root.y }, root.meta.source), ["x", "y", "name"]);
    d.nodes[rootId].meta.specFingerprint = fingerprint(d, rootId);
  } else {
    reskinSubtree(d, rootId, tokenSetFor(dsId));
    const walk = (id: string) => {
      const n = d.nodes[id];
      if (!n) return;
      if ((n.meta.specPath !== undefined || n.meta.inst) && !isOverridden(d, id) && rebuildInstance(d, id, rootId, dsId)) return;
      [...n.children].forEach(walk);
    };
    walk(rootId);
  }
  d.nodes[rootId].meta.systemVersion = version;
}

/** Roots bound to a design system that has changed since they were built or last refreshed. */
export function staleRoots(doc: Doc): string[] {
  return doc.roots.filter((id) => {
    const n = doc.nodes[id];
    const dsId = n?.meta.designSystem;
    // The Components page is rebuilt by its own runtime.
    if (!dsId || dsId === "builtin" || n.meta.showcase) return false;
    const ds = systemFor(dsId);
    return ds.id === dsId && n.meta.systemVersion !== ds.updatedAt;
  });
}
