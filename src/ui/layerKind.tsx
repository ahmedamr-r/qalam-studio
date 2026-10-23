import { Circle, Columns3, Diamond, FileText, Frame, Group, Image as ImageIcon, Minus, MoveUpRight, Network, Pentagon, Rows3, Shapes, Spline, Square, SquareDashed, Star, StickyNote, Type, type LucideIcon } from "lucide-react";
import type { SceneNode } from "@/doc/schema";
import { isGroup } from "@/doc/group";

/*
 * What a layer is, for the Layers panel and the Design panel header (design/spec.md §10): one icon
 * and one name per kind, so both panels and the canvas label agree. Vectors read their shape
 * (polygon, star, line, arrow); groups are frames with `meta.group`; component instances carry
 * `meta.component` and show in the component colour.
 */

export interface LayerKind {
  label: string;
  Icon: LucideIcon;
  /** Shown in the component colour (instances of a design-system component). */
  component: boolean;
}

/** A line with an arrowhead on either end is an arrow, like Figma's Arrow tool makes. */
export const isArrow = (n: SceneNode) => n.type === "path" && n.shape?.kind === "line" && !!n.ends && (isHead(n.ends.start) || isHead(n.ends.end));
const isHead = (e: string) => e !== "none" && e !== "round" && e !== "square";

export function layerKind(n: SceneNode): LayerKind {
  const component = !!n.meta.component && !isGroup(n);
  if (component) return { label: "Instance", Icon: Diamond, component };
  switch (n.type) {
    case "frame":
      // Discovery: a card of the opportunity tree, a sticky note.
      if (n.meta.ost) return { label: n.meta.ost.kind === "outcome" ? "Outcome" : n.meta.ost.kind === "opportunity" ? "Opportunity" : n.meta.ost.kind === "solution" ? "Solution" : "Test", Icon: Network, component };
      if (n.meta.note) return n.meta.note.kind === "source" ? { label: "Source", Icon: FileText, component } : { label: "Sticky", Icon: StickyNote, component };
      if (isGroup(n)) return { label: n.meta.mask ? "Mask group" : "Group", Icon: n.meta.mask ? SquareDashed : Group, component };
      // Auto layout frames show their flow, like Figma.
      if (n.layout) return { label: "Frame", Icon: n.layout.direction === "horizontal" ? Columns3 : Rows3, component };
      return { label: "Frame", Icon: Frame, component };
    case "rect":
      return { label: "Rectangle", Icon: Square, component };
    case "ellipse":
      return { label: "Ellipse", Icon: Circle, component };
    case "text":
      return { label: "Text", Icon: Type, component };
    case "icon":
      return { label: "Icon", Icon: Shapes, component };
    case "image":
      return { label: "Image", Icon: ImageIcon, component };
    case "path":
      if (n.shape?.kind === "polygon") return { label: "Polygon", Icon: Pentagon, component };
      if (n.shape?.kind === "star") return { label: "Star", Icon: Star, component };
      if (n.shape?.kind === "line") return isArrow(n) ? { label: "Arrow", Icon: MoveUpRight, component } : { label: "Line", Icon: Minus, component };
      return { label: "Vector", Icon: Spline, component };
  }
}
