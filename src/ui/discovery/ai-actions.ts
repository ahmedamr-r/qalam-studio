import type { Doc } from "@/doc/schema";
import { isOstCard } from "@/doc/board";
import { cardOf } from "@/discovery/ops";
import type { AIAction } from "../surfaces/ai-actions";
import { useDiscovery } from "./store";
import { openBrainDump } from "./dump";
import { draftSolutionsFor, useDrafting } from "./solutions";

/**
 * Qalam AI on a Discovery board, for the ⌘K palette and the context menu (the Screens actions,
 * Generate, Critique, Mirror and Audit, have nothing to work on here).
 */
export function boardAIActions(doc: Doc, selection: string[]): AIAction[] {
  const one = selection.length === 1 ? cardOf(doc, selection[0]) : null;
  const tree = doc.roots.some((id) => isOstCard(doc.nodes[id]) && doc.nodes[id].meta.ost?.kind === "outcome");
  const drafting = useDiscovery.getState().drafting ? "Qalam AI is drafting the tree" : null;
  return [
    {
      id: "ai:draft-solutions",
      label: "Draft solutions for this problem",
      sub: one?.kind === "opportunity" ? one.title || undefined : undefined,
      state: "Risks and a test each",
      keywords: ["solutions", "ideas", "ideate", "assumptions", "test", "experiment", "problem", "opportunity"],
      enabled: one?.kind !== "opportunity" ? "Select a problem to draft solutions for" : useDrafting.getState().card ? "Qalam AI is drafting solutions" : true,
      run: () => void draftSolutionsFor(selection[0]),
    },
    {
      id: "ai:design-this",
      label: "Design this solution…",
      sub: one?.kind === "solution" ? one.title || undefined : undefined,
      state: "Plans first",
      keywords: ["design", "screens", "generate", "handoff", "solution", "build"],
      enabled: one?.kind === "solution" ? true : "Select a solution to design",
      run: () => useDiscovery.setState({ designFor: selection[0] }),
    },
    {
      id: "ai:brain-dump",
      label: "Brain dump…",
      sub: one?.title || undefined,
      state: "Asks first",
      keywords: ["brain dump", "paste", "notes", "thinking", "goals", "ideas", "distribute", "place"],
      enabled: drafting ?? true,
      run: () => openBrainDump(),
    },
    {
      id: "ai:draft-tree",
      label: tree ? "Redo the product interview…" : "Draft a tree from a product interview…",
      keywords: ["interview", "draft", "questions", "outcome", "opportunities", "tree", "start"],
      enabled: drafting ?? true,
      run: () => useDiscovery.setState({ sheet: tree ? "interview" : "start" }),
    },
  ];
}
