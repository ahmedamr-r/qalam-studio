import type { Doc } from "@/doc/schema";
import { buildScreenNodes } from "@/design-system/place";
import { DEMO_SCREENS, demoProto } from "@/ui/demo";

/**
 * The order-tracking demo as a document, built like "Load demo screens" builds it (needs
 * ensureYoga first): Map first, Timeline, Compact side by side, with the demo prototype.
 */
export function orderTrackingDoc(): { doc: Doc; ids: { mapFirst: string; timeline: string; compact: string } } {
  const doc: Doc = { nodes: {}, roots: [] };
  let x = 0;
  const ids: string[] = [];
  for (const spec of DEMO_SCREENS.slice(0, 3)) {
    const nodes = buildScreenNodes(spec, "builtin", { x, y: 0 }, "ai");
    for (const n of nodes) doc.nodes[n.id] = n;
    doc.roots.push(nodes[0].id);
    ids.push(nodes[0].id);
    x += nodes[0].w + 80;
  }
  const named = { mapFirst: ids[0], timeline: ids[1], compact: ids[2] };
  doc.proto = demoProto(named);
  return { doc, ids: named };
}
