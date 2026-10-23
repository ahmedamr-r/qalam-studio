import type { Doc, Prototype, SceneNode } from "@/doc/schema";
import { descendants } from "@/doc/geometry";
import { parseStateKey } from "@/doc/proto";
import { isEdited } from "@/design-system/apply";
import { instOf, isOverridden } from "@/design-system/instances";
import { componentNodes } from "@/design-system/place";
import { ctxFor } from "@/design-system/refresh";
import type { StateVariants } from "./compile";

/**
 * A state's look, built the way the screen was: each instance a state changes is rebuilt from its
 * component with the state's props, laid out at the width it has in the screen. The compiler then
 * compares the result with the screen (states.ts). Needs the layout engine (ensureYoga) and the
 * system's fonts, like any build.
 */
export function buildStateVariants(doc: Doc, screens: string[], proto: Prototype | undefined = doc.proto): { variants: StateVariants; warnings: string[] } {
  const variants: StateVariants = {};
  const warnings: string[] = [];
  for (const rootId of screens) {
    const root = doc.nodes[rootId];
    const states = proto?.states[rootId];
    if (!root || !states) continue;
    const dsId = root.meta.designSystem ?? "builtin";
    for (const [state, diff] of Object.entries(states)) {
      const byPath = new Map<string, Record<string, unknown>>();
      for (const [k, value] of Object.entries(diff)) {
        const ref = parseStateKey(k);
        if (!ref) continue;
        byPath.set(ref.path, { ...byPath.get(ref.path), [ref.prop]: value });
      }
      for (const [path, props] of byPath) {
        const id = descendants(doc, rootId).find((d) => doc.nodes[d]?.meta.specPath === path);
        const inst = id ? instOf(doc, id) : undefined;
        if (!id || !inst) {
          warnings.push(`State "${state}" of "${root.name}" changes ${path}, which isn't a component on the screen.`);
          continue;
        }
        if (isEdited(doc, rootId) && isOverridden(doc, id)) warnings.push(`"${root.name}" › ${path} was edited by hand; its "${state}" state is built from the component and leaves those edits out.`);
        const n = doc.nodes[id];
        const parent = n.parentId ? doc.nodes[n.parentId] : undefined;
        // Laid out as it sits: a fill-width instance in a column gets the column's inner width.
        const width =
          parent?.type === "frame" && parent.layout?.direction === "vertical" && n.sizeH === "fill" ? parent.w - parent.layout.padding.start - parent.layout.padding.end : n.w;
        const built: SceneNode[] = componentNodes({ ...inst, props: { ...inst.props, ...props } }, ctxFor(doc, rootId, dsId, path), Math.max(1, width), path);
        ((variants[rootId] ??= {})[state] ??= {})[path] = built;
      }
    }
  }
  return { variants, warnings };
}
