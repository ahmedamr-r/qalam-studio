import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStudio, studio } from "@/doc/store";
import type { SceneNode } from "@/doc/schema";
import { updateNodes } from "@/doc/ops";
import { activeTokens, dsIdForNode, tokenSetFor, tokensForNode, useSystems } from "@/design-system/registry";
import type { TokenSet } from "@/design-system/resolve";

export function useSelectedNodes(): SceneNode[] {
  return useStudio(useShallow((s) => s.selection.map((id) => s.doc.nodes[id]).filter(Boolean)));
}

/** Edit helpers: continuous edits (scrubbing) are grouped into one undo step. */
export function edit(ids: string[], fn: (n: SceneNode) => void) {
  studio().beginTx();
  updateNodes(ids, fn);
}
export function commit() {
  studio().commitTx();
}
/** One-shot edit with its own undo step. */
export function editNow(ids: string[], fn: (n: SceneNode) => void) {
  updateNodes(ids, fn);
}

/** Shared value across nodes, or null when mixed. */
export function shared<T>(nodes: SceneNode[], get: (n: SceneNode) => T): T | null {
  if (!nodes.length) return null;
  const v = get(nodes[0]);
  return nodes.every((n) => get(n) === v) ? v : null;
}

/** Token set of the design system the selection's screen is bound to. */
export function useNodeTokens(nodes: SceneNode[]): TokenSet {
  const first = nodes[0]?.id;
  const dsId = useStudio((s) => (first && s.doc.nodes[first] ? dsIdForNode(s.doc, first) : null));
  const systems = useSystems((s) => s.systems);
  const active = useSystems((s) => s.activeId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (dsId ? tokenSetFor(dsId) : activeTokens()), [dsId, systems, active]);
}

/** Same, outside React (for edit callbacks). */
export const tsFor = (ids: string[]): TokenSet => (ids.length && studio().doc.nodes[ids[0]] ? tokensForNode(studio().doc, ids[0]) : activeTokens());
