import type { Doc, FrameNode } from "@/doc/schema";
import type { Pt } from "@/doc/geometry";
import { emptyDoc } from "@/doc/schema";
import { makeCardNode, newCard } from "./ops";
import { layoutDocTrees } from "./pass";
import type { Draft } from "./sanitize";

/**
 * A draft as cards (pure): the outcome at `at`, its opportunities and solutions nested under it,
 * laid out by the same pass the board uses. The streaming preview (a ghost) and the final insert
 * are both built here, so the tree lands exactly where it was previewed.
 */
export function draftToDoc(draft: Draft, at: Pt): { doc: Doc; rootId: string } | null {
  if (!draft.outcome) return null;
  const root = makeCardNode(draft.outcome, at);
  const doc: Doc = { ...emptyDoc(), nodes: { [root.id]: root }, roots: [root.id] };
  const byRef = new Map<string, FrameNode>();
  for (const c of draft.cards) {
    const parent = c.parent ? byRef.get(c.parent) : root;
    if (!parent) continue;
    const n = makeCardNode(c.card);
    n.parentId = parent.id;
    parent.children.push(n.id);
    doc.nodes[n.id] = n;
    byRef.set(c.ref, n);
  }
  return { doc: layoutDocTrees(doc), rootId: root.id };
}

/** An outcome card standing in for a draft that's still being written (nothing complete yet). */
export function placeholderDoc(at: Pt): { doc: Doc; rootId: string } {
  const root = makeCardNode(newCard("outcome", { createdBy: "ai", title: "" }), at);
  return { doc: layoutDocTrees({ ...emptyDoc(), nodes: { [root.id]: root }, roots: [root.id] }), rootId: root.id };
}
