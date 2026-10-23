import { useMemo } from "react";
import { useStudio } from "@/doc/store";
import { wholeDoc } from "@/doc/pages";
import { BUILTIN_ID, useSystems, type DesignSystem } from "@/design-system/registry";
import { systemPayload } from "@/ai/ds-payload";
import { promptSystem } from "@/knowledge/facts";
import { buildKnowledgeGraph, type SystemInput } from "@/knowledge/graph";
import { useKnowledge } from "@/knowledge/store";
import type { KnowledgeGraph } from "@/knowledge/types";
import { loadDecisions } from "../ai/aiStore";
import { useChats } from "../ai/chats";

/** A system as the graph reads it: what its prompt is built from, and where its facts came from. */
export function systemInput(ds: DesignSystem): SystemInput {
  return {
    id: ds.id,
    name: ds.name,
    source: ds.source,
    createdAt: ds.createdAt,
    prompt: promptSystem(systemPayload(ds)),
    provenance: ds.provenance,
    forkedFrom: ds.forkedFrom,
  };
}

/** The systems a project uses: the active one, and every one a screen is bound to. */
function systemsInUse(systems: DesignSystem[], activeId: string, boundIds: string[]): DesignSystem[] {
  const ids = new Set([activeId, ...boundIds]);
  return systems.filter((s) => ids.has(s.id) || (s.id === BUILTIN_ID && ids.has(BUILTIN_ID)));
}

/** The open project's graph from the stores as they are now (dev hooks, tests). */
export function currentKnowledgeGraph(opts: { asOf?: number; window?: number } = {}): KnowledgeGraph {
  const doc = wholeDoc(useStudio.getState().doc);
  const { systems: all, activeId } = useSystems.getState();
  const bound = doc.roots.map((id) => doc.nodes[id]?.meta?.designSystem).filter((x): x is string => !!x);
  return buildKnowledgeGraph({
    doc: { nodes: doc.nodes, roots: doc.roots, brief: doc.brief },
    systems: systemsInUse(all, activeId, bound).map(systemInput),
    naming: loadDecisions(),
    chats: useChats.getState().chats,
    traces: useKnowledge.getState().traces,
    controls: doc.knowledge,
    ...opts,
  });
}

/** The open project's knowledge graph, rebuilt when any of its stores change. */
export function useKnowledgeGraph(opts: { asOf?: number; window?: number } = {}): KnowledgeGraph {
  const brief = useStudio((s) => s.doc.brief);
  const controls = useStudio((s) => s.doc.knowledge);
  // Screens' names and systems: a key that only changes when one of those does.
  const rootsKey = useStudio((s) => {
    const d = wholeDoc(s.doc);
    return d.roots.map((id) => `${id}\u0001${d.nodes[id]?.name ?? ""}\u0001${d.nodes[id]?.meta?.designSystem ?? ""}`).join("\u0002");
  });
  const allSystems = useSystems((s) => s.systems);
  const activeId = useSystems((s) => s.activeId);
  const chats = useChats((s) => s.chats);
  const traces = useKnowledge((s) => s.traces);

  return useMemo(() => {
    // Every page's screens.
    const doc = wholeDoc(useStudio.getState().doc);
    // Every frame a brief entry or a turn names can be an anchor, not only the roots.
    const bound = doc.roots.map((id) => doc.nodes[id]?.meta?.designSystem).filter((x): x is string => !!x);
    const systems = systemsInUse(allSystems, activeId, bound).map(systemInput);
    return buildKnowledgeGraph({ doc: { nodes: doc.nodes, roots: doc.roots, brief }, systems, naming: loadDecisions(), chats, traces, controls, asOf: opts.asOf, window: opts.window });
    // rootsKey stands for the screens' names and systems.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, controls, rootsKey, allSystems, activeId, chats, traces, opts.asOf, opts.window]);
}
