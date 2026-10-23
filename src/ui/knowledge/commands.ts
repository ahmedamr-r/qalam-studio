import { registerCommands } from "@/commands/registry";
import { isDiscovery } from "@/projects/mode";
import { studio } from "@/doc/store";
import { topFrameOf } from "@/doc/geometry";
import { openWorkspace } from "../workspace/store";
import { openWhy, screenDecision } from "./why";

/** The Knowledge hub's commands: open it (the palette's way to the graph). */
registerCommands([
  {
    id: "knowledge.open",
    label: "Open Knowledge hub",
    category: "panels",
    context: "global",
    run: () => openWorkspace("knowledge"),
    enabled: () => (isDiscovery() ? "Boards keep their product context in the Library panel" : true),
    keywords: ["memory", "why", "decisions", "library", "graph", "what Qalam AI knows"],
  },
  {
    id: "knowledge.why-selection",
    label: "Why was this made?",
    category: "panels",
    context: "global",
    run: () => {
      const d = selectedScreenDecision();
      if (d) openWhy(d.ref, d.at);
    },
    enabled: () => (isDiscovery() ? "Boards keep their product context in the Library panel" : selectedScreenDecision() ? true : "Select a screen Qalam AI made"),
    keywords: ["why", "reasons", "decision", "trace", "relied on"],
  },
]);

/** The decision behind the selected screen (its root frame). */
function selectedScreenDecision() {
  const { doc, selection } = studio();
  const id = selection[0];
  if (!id || !doc.nodes[id]) return null;
  return screenDecision(topFrameOf(doc, id));
}
