import { worldBounds } from "@/doc/geometry";
import type { Doc, SceneNode } from "@/doc/schema";
import type { TokenSet } from "../resolve";

/**
 * What a change did to a screen: the same spec built twice (before and after a knob moved), compared
 * component instance by instance. An instance changed when its own look did (size, fills, strokes,
 * corners, shadows, type, icon colour); its position doesn't count, and nested instances answer for
 * themselves, so a Card counts only when the card itself changed, not a button inside it.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChangedInstance {
  specPath: string;
  component: string;
  /** In the screen's coordinates (its top-left is 0,0). */
  box: Box;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

function look(n: SceneNode): unknown[] {
  const fill = n.fill ? [n.fill.color, (n.fill as { gradient?: unknown }).gradient ?? null] : null;
  const stroke = n.stroke ? [n.stroke.color, n.stroke.width] : null;
  const radius = n.radius ? [n.radius.tl.rx, n.radius.tr.rx, n.radius.br.rx, n.radius.bl.rx] : null;
  const effects = (n as { effects?: unknown[] }).effects ?? null;
  const text = n.type === "text" ? [n.text.fontFamily, n.text.fontSize, n.text.fontWeight, n.text.lineHeight, n.text.letterSpacing] : null;
  return [n.type, r1(n.w), r1(n.h), fill, stroke, radius, effects, text, n.opacity ?? 1];
}

function docOf(nodes: SceneNode[]): Doc {
  return { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), roots: nodes.filter((n) => !n.parentId).map((n) => n.id) };
}

/** Each instance's own look, keyed by its place in the spec. */
export function ownFingerprints(nodes: SceneNode[]): Map<string, { fp: string; component: string; box: Box }> {
  const doc = docOf(nodes);
  const root = nodes.find((n) => !n.parentId);
  const origin = root ? worldBounds(doc, root.id) : { x: 0, y: 0 };
  const owner = new Map<string, string>();
  const parts = new Map<string, unknown[]>();
  const out = new Map<string, { fp: string; component: string; box: Box }>();
  for (const n of nodes) {
    const own = n.meta.specPath ?? (n.parentId ? owner.get(n.parentId) : undefined);
    if (own === undefined) continue;
    owner.set(n.id, own);
    if (!parts.has(own)) parts.set(own, []);
    parts.get(own)!.push(look(n));
    if (n.meta.specPath !== undefined && !out.has(own)) {
      const b = worldBounds(doc, n.id);
      // "Button/Primary" counts as a Button.
      out.set(own, { fp: "", component: (n.meta.component ?? n.name).split("/")[0], box: { x: r1(b.x - origin.x), y: r1(b.y - origin.y), w: r1(b.w), h: r1(b.h) } });
    }
  }
  for (const [path, v] of out) v.fp = JSON.stringify(parts.get(path));
  return out;
}

/** The instances whose look differs between two builds of the same spec, and how many of each component. */
export function diffInstances(prev: SceneNode[], next: SceneNode[]): { changed: ChangedInstance[]; byComponent: Record<string, number> } {
  const a = ownFingerprints(prev);
  const b = ownFingerprints(next);
  const changed: ChangedInstance[] = [];
  const byComponent: Record<string, number> = {};
  for (const [path, nb] of b) {
    if (a.get(path)?.fp === nb.fp) continue;
    changed.push({ specPath: path, component: nb.component, box: nb.box });
    byComponent[nb.component] = (byComponent[nb.component] ?? 0) + 1;
  }
  return { changed, byComponent };
}

/** Where a component appears on a screen (by catalog name; nested uses too, like a table's status tags). */
export function componentBoxes(nodes: SceneNode[], name: string): Box[] {
  const doc = docOf(nodes);
  const root = nodes.find((n) => !n.parentId);
  const origin = root ? worldBounds(doc, root.id) : { x: 0, y: 0 };
  return nodes
    .filter((n) => n.meta.component?.split("/")[0] === name)
    .map((n) => {
      const b = worldBounds(doc, n.id);
      return { x: r1(b.x - origin.x), y: r1(b.y - origin.y), w: r1(b.w), h: r1(b.h) };
    });
}

/** Role and recipe tokens whose resolved value differs (primitives aside). */
export function diffTokens(a: TokenSet, b: TokenSet): string[] {
  const paths = new Set([...a.tokens, ...b.tokens].map((t) => t.path).filter((p) => !p.startsWith("color.")));
  return [...paths].filter((p) => JSON.stringify(a.get(p)?.value) !== JSON.stringify(b.get(p)?.value)).sort();
}

/** "3 Buttons, 2 Chips…" */
export function describeCounts(byComponent: Record<string, number>, max = 3): string {
  const list = Object.entries(byComponent).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  const named = list.slice(0, max).map(([c, n]) => `${n} ${n === 1 ? c : c.endsWith("s") ? c : `${c}s`}`);
  return list.length > max ? `${named.join(", ")}…` : named.join(", ");
}
