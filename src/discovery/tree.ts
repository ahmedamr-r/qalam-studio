import type { Doc, SceneNode } from "@/doc/schema";
import { isOstCard, treeRootOf } from "@/doc/board";
import type { Orientation } from "./layout";
import { KIND_LABEL, SUB_OUTCOME_LABEL } from "./kinds";
import type { OstCard } from "./types";

/** Reading the tree (pure). */

/** The fold toggle's radius (card px). */
export const TOGGLE_R = 9;

/** Which way a card's tree grows: its root decides (top-down unless set). */
export function orientationOf(doc: Doc, id: string): Orientation {
  const root = treeRootOf(doc, id);
  return (root && doc.nodes[root]?.meta.ost?.orientation) || "tb";
}

/** Where a card's fold toggle sits, in the card's own px: on its child edge. */
export function foldToggle(n: { w: number; h: number }, o: Orientation): { x: number; y: number; r: number } {
  return o === "tb" ? { x: n.w / 2, y: n.h + 1, r: TOGGLE_R } : { x: n.w + 1, y: n.h / 2, r: TOGGLE_R };
}

/** Child cards (in order). */
export const childCards = (doc: Doc, id: string): string[] => (doc.nodes[id]?.children ?? []).filter((c) => isOstCard(doc.nodes[c]));

/** How many cards up to the tree's root (the root is 0). */
export function depthOf(doc: Doc, id: string): number {
  let d = 0;
  let p = doc.nodes[id]?.parentId;
  while (p && isOstCard(doc.nodes[p])) {
    d++;
    p = doc.nodes[p].parentId;
  }
  return d;
}

/** Every card of every tree on the board, with its data, depth-first. */
export function allCards(doc: Doc): { id: string; card: OstCard }[] {
  const out: { id: string; card: OstCard }[] = [];
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!isOstCard(n)) return;
    out.push({ id, card: n.meta.ost });
    n.children.forEach(walk);
  };
  doc.roots.forEach(walk);
  return out;
}

/** The opportunities from the tree's top down to (not including) this card. */
export function opportunityPath(doc: Doc, id: string): string[] {
  const out: string[] = [];
  let p = doc.nodes[id]?.parentId;
  while (p && isOstCard(doc.nodes[p])) {
    const c = doc.nodes[p].meta.ost!;
    if (c.kind === "opportunity") out.unshift(p);
    p = doc.nodes[p].parentId;
  }
  return out;
}

/** The nearest outcome a card sits under (itself for an outcome), if its tree has one. */
export function outcomeOf(doc: Doc, id: string): string | null {
  let n: SceneNode | undefined = doc.nodes[id];
  while (isOstCard(n)) {
    if (n.meta.ost.kind === "outcome") return n.id;
    n = n.parentId ? doc.nodes[n.parentId] : undefined;
  }
  return null;
}

/** An outcome under another outcome: a goal split into the outcomes that move it. */
export function isSubOutcome(doc: Doc, id: string): boolean {
  const n = doc.nodes[id];
  const p = n?.parentId ? doc.nodes[n.parentId] : undefined;
  return isOstCard(n) && n.meta.ost.kind === "outcome" && isOstCard(p) && p.meta.ost.kind === "outcome";
}

/** What a card is called on the board ("Sub-outcome" for an outcome under another). */
export function kindLabel(doc: Doc, id: string): string {
  const c = doc.nodes[id]?.meta.ost;
  if (!c) return "";
  return isSubOutcome(doc, id) ? SUB_OUTCOME_LABEL : KIND_LABEL[c.kind];
}

/** The trees that start at an outcome, in board order. */
export const outcomeRoots = (doc: Doc): string[] => doc.roots.filter((id) => isOstCard(doc.nodes[id]) && doc.nodes[id].meta.ost?.kind === "outcome");

/** The outcomes from the tree's root down to a card's nearest outcome (empty when it has none). */
export function outcomePath(doc: Doc, id: string): string[] {
  const out: string[] = [];
  let n: SceneNode | undefined = doc.nodes[outcomeOf(doc, id) ?? ""];
  while (isOstCard(n) && n.meta.ost.kind === "outcome") {
    out.unshift(n.id);
    n = n.parentId ? doc.nodes[n.parentId] : undefined;
  }
  return out;
}

/** Where a card's target is picked among: its nearest outcome's cards, or its tree's when there's none. */
export const targetScope = (doc: Doc, id: string): string | null => outcomeOf(doc, id) ?? treeRootOf(doc, id);

/** Each outcome on the board as a line for Qalam AI ("More weekly reorders (Weekly reorders per customer)"), sub-outcomes indented under theirs. */
export function outcomeLines(doc: Doc): string[] {
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    const n = doc.nodes[id];
    if (!isOstCard(n)) return;
    const c = n.meta.ost;
    if (c.kind !== "outcome") return;
    const title = c.title.replace(/\s+/g, " ").trim() || "(untitled)";
    lines.push(`${"  ".repeat(depth)}- ${title}${c.metric?.name ? ` (${c.metric.name})` : ""}`);
    for (const k of n.children) walk(k, depth + 1);
  };
  for (const r of outcomeRoots(doc)) walk(r, 0);
  return lines;
}
