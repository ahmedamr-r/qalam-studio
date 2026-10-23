import { feedback, registerCommands, type Command } from "@/commands";
import { studio } from "@/doc/store";
import { addLayoutGrid, gridFrames, removeLayoutGrids } from "@/doc/grids";
import type { FrameNode } from "@/doc/schema";

/*
 * Commands the canvas chrome makes real: the ⌥ measure and rotate gestures (listed with keycaps,
 * done by the controller) and layout grids. Same ids as the catalogue's placeholders, so these
 * replace them (registerCommands: the last one wins).
 */

const gesture = (id: string, label: string, caps: string[], keywords: string[] = []): Command => ({
  id,
  label,
  category: "cursor",
  gesture: caps,
  hidden: true,
  keywords,
  run: () => {},
});

const frames = () => gridFrames(studio().selection);
const needFrame = () => (frames().length ? true : "Select a frame");

const addGrid = (kind: "columns" | "rows" | "grid", label: string): Command => ({
  id: `arrange.layout-grid-${kind}`,
  label,
  category: "arrange",
  keywords: ["layout grid", "layout guide", kind, "grid"],
  enabled: needFrame,
  run: () => {
    const n = addLayoutGrid(frames(), kind);
    // A new grid should be visible: turn layout guides on if they were hidden.
    if (n && !studio().view.layoutGrids) studio().setView({ layoutGrids: true });
    if (n) feedback(`${label.replace(/^Add /, "")} added`, { id: "arrange.layout-grid" });
  },
});

registerCommands([
  gesture("cursor.measure", "Measure distance to selection", ["⌥", "Hover"], ["measure", "distance", "redline"]),
  gesture("cursor.rotate", "Rotate", ["Drag outside a corner"], ["rotation", "turn"]),
  gesture("cursor.rotate-snap", "Rotate in 15° steps", ["⇧", "Drag outside a corner"], ["rotation", "snap"]),
  gesture("cursor.line-end", "Move a line's end", ["Drag an end"], ["line", "arrow", "endpoint"]),
  addGrid("columns", "Add column grid"),
  addGrid("rows", "Add row grid"),
  addGrid("grid", "Add square grid"),
  {
    id: "arrange.layout-grid-remove",
    label: "Remove layout grids",
    category: "arrange",
    keywords: ["layout grid", "clear grid"],
    enabled: () => (frames().some((id) => (studio().doc.nodes[id] as FrameNode).grids?.length) ? true : "Select a frame with a layout grid"),
    run: () => {
      const n = removeLayoutGrids(frames());
      if (n) feedback("Layout grids removed", { id: "arrange.layout-grid" });
    },
  },
]);
