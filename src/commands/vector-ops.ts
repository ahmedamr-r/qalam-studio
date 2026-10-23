import { studio } from "@/doc/store";
import type { BoolOp } from "@/doc/path-ops";
import { booleanSelection, canBoolean, canFlatten, canOutlineStroke, flattenSelection, outlineStrokeSelection } from "@/doc/booleans";
import { isMaskGroup, isMaskLayer } from "@/doc/mask";
import { canMask, toggleMask } from "@/doc/mask-ops";
import { rotateNodes } from "@/doc/rotate";
import { getCommand, registerCommands, type Command } from "./registry";
import { feedback } from "./feedback";

/**
 * Vector operations (doc/booleans.ts, doc/mask.ts), registered over the catalogue's "Coming soon"
 * entries with the same ids: the catalogue keeps their labels, keys and keywords.
 */

const sel = () => studio().selection;

/** The catalogue entry, working now: `unavailable` dropped, `run`/`enabled` (and anything else) replaced. */
function over(id: string, patch: Pick<Command, "run"> & Partial<Command>): Command {
  const base = getCommand(id);
  if (!base) throw new Error(`No catalogue entry ${id}`);
  const { unavailable: _, ...rest } = base;
  return { ...rest, ...patch };
}

/** Errors become a toast; success shows itself on the canvas. */
const report = (r: { error: string } | object) => {
  if ("error" in r) feedback(r.error, { kind: "error", id: "shape.vector-op" });
};

const bool = (op: BoolOp, keywords: string[]): Command =>
  over(`shape.${op}`, {
    run: () => report(booleanSelection(sel(), op)),
    enabled: () => canBoolean(sel()),
    keywords: ["boolean", ...keywords],
  });

registerCommands([
  bool("union", ["combine", "merge", "add"]),
  bool("subtract", ["minus", "cut out", "difference"]),
  bool("intersect", ["overlap", "common"]),
  bool("exclude", ["xor", "difference"]),
  over("shape.flatten", {
    run: () => report(flattenSelection(sel())),
    enabled: () => canFlatten(sel()),
    keywords: ["vector", "merge", "bake", "convert to vector"],
  }),
  over("shape.outline-stroke", {
    run: () => report(outlineStrokeSelection(sel())),
    enabled: () => canOutlineStroke(sel()),
    keywords: ["stroke to path", "expand", "convert stroke"],
  }),
  over("shape.mask", {
    run: () => {
      if (toggleMask(sel()) === "unmasked") feedback("Mask removed", { id: "shape.mask" });
    },
    enabled: () => canMask(sel()),
    // On while a mask group (or its mask) is selected: ⌃⌘M turns it off, like Figma's toggle.
    checked: () => {
      const { doc, selection } = studio();
      return selection.length === 1 && (isMaskGroup(doc.nodes[selection[0]]) || isMaskLayer(doc, selection[0]));
    },
    keywords: ["clip", "mask group", "crop"],
  }),
  over("transform.rotate", {
    label: "Rotate 90°",
    // ⌥⌘↑ turns left, ⌥⌘↓ (and the palette) turns right.
    run: ({ event }) => void rotateNodes(sel(), event?.key === "ArrowUp" ? -90 : 90),
    enabled: () => {
      const { doc, selection } = studio();
      if (!selection.length) return "Select a layer first";
      return selection.some((id) => doc.nodes[id] && !doc.nodes[id].locked) ? true : "The selection is locked";
    },
    keywords: ["rotate 90", "rotate left", "rotate right", "turn", "quarter"],
  }),
  // Qalam components are design-system definitions (a composition of catalog components with
  // props), not layer trees: turning arbitrary layers into one would lose what they are.
  over("components.create", {
    run: () => {},
    unavailable: "Components in Qalam are design-system definitions, not layers: Qalam AI proposes them while it designs, and Add to system adopts one",
  }),
]);
