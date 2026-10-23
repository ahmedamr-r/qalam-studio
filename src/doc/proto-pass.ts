/**
 * The prototype's doc pass (see registerDocPass in store.ts): it runs with every edit, in the same
 * undo step. A prototype in a document being opened is validated (a file may carry anything), and
 * an edit that removed screens drops what points at them, so undo brings both back together.
 * Edits in between are left alone: the Prototype tab adds a state before it has any props.
 *
 * A route's parts (its overlays and add-ons, frames beside the screen) go where their screen goes:
 * moved with it unless they were moved too, deleted with it.
 */
import { normalizeProto, pruneProto } from "./proto";
import type { Doc } from "./schema";
import { registerDocPass } from "./store";
import { registerCanvasExtents } from "@/design-system/place";
import { routeGeometry } from "@/proto/canvas/layout";

/** openDoc runs the passes from an empty document. */
const isOpening = (prev: Doc) => !prev.proto && prev.roots.length === 0 && Object.keys(prev.nodes).length === 0;

const partFramesOf = (doc: Doc, screen: string): string[] => {
  const r = doc.proto?.routes?.[screen];
  return r ? [...Object.values(r.overlays), ...Object.values(r.addOns)].map((p) => p.frame) : [];
};

/** The document without these top-level frames and everything in them. */
function without(doc: Doc, frames: string[]): Doc {
  const drop = new Set<string>();
  const add = (id: string) => {
    if (drop.has(id) || !doc.nodes[id]) return;
    drop.add(id);
    doc.nodes[id].children.forEach(add);
  };
  frames.forEach(add);
  if (!drop.size) return doc;
  const nodes = { ...doc.nodes };
  for (const id of drop) delete nodes[id];
  return { ...doc, nodes, roots: doc.roots.filter((id) => !drop.has(id)) };
}

/** Parts whose screen was deleted go with it. */
function dropOrphanParts(prev: Doc, next: Doc): Doc {
  const routes = prev.proto?.routes;
  if (!routes || next.roots === prev.roots) return next;
  const roots = new Set(next.roots);
  const orphans = Object.keys(routes)
    .filter((screen) => !roots.has(screen))
    .flatMap((screen) => partFramesOf(prev, screen))
    .filter((f) => roots.has(f));
  return orphans.length ? without(next, orphans) : next;
}

/** Parts move with their screen, unless they moved too (dragged together). */
function moveParts(prev: Doc, next: Doc): Doc {
  const routes = next.proto?.routes;
  if (!routes || next.nodes === prev.nodes) return next;
  let nodes: Doc["nodes"] | null = null;
  for (const screen of Object.keys(routes)) {
    const a = prev.nodes[screen];
    const b = next.nodes[screen];
    if (!a || !b || a === b || (a.x === b.x && a.y === b.y)) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    for (const f of partFramesOf(next, screen)) {
      const p0 = prev.nodes[f];
      const p1 = (nodes ?? next.nodes)[f];
      if (!p0 || !p1 || p1.parentId || p0.x !== p1.x || p0.y !== p1.y) continue;
      nodes ??= { ...next.nodes };
      nodes[f] = { ...p1, x: p1.x + dx, y: p1.y + dy };
    }
  }
  return nodes ? { ...next, nodes } : next;
}

export function protoPass(prev: Doc, next: Doc): Doc {
  if (!next.proto && !prev.proto?.routes) return next;
  const opening = isOpening(prev);
  next = dropOrphanParts(prev, next);
  if (!next.proto) return next;
  let proto = opening ? normalizeProto(next.proto) : next.proto;
  if (proto && (opening || next.roots !== prev.roots)) proto = pruneProto(proto, next.roots);
  if (proto !== next.proto) {
    if (!proto) {
      const rest = { ...next };
      delete rest.proto;
      return rest;
    }
    next = { ...next, proto };
  }
  return moveParts(prev, next);
}

/** Screens and design-system projects keep a prototype (Discovery boards don't); new screens go clear of the routes' containers. */
export const registerProtoPass = () => {
  const pass = registerDocPass(protoPass);
  const room = registerCanvasExtents((doc) => routeGeometry(doc).flatMap((g) => (g.container ? [g.container] : [])));
  return () => {
    pass();
    room();
  };
};
