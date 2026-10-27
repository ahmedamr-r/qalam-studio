import type { Pt } from "@/doc/geometry";
import type { PointerInfo } from "./vector-tools";
import type { OstRenderInput } from "./ost-painter";

/**
 * A project mode's own canvas gestures (Discovery: dragging tree cards to re-parent them, the
 * card and sticky tools, folding branches, editing a card's title). The controller asks it right
 * after the vector tools; each handler returns true when it took the event, so the controller's
 * own move, resize and marquee code never sees it. Pointer moves arrive with no button pressed
 * too (hover): return false for those unless something of the delegate's own is under the pointer.
 * One delegate at a time, installed by the mode at boot.
 */
export interface CanvasDelegate {
  pointerDown(p: PointerInfo): boolean;
  pointerMove(p: PointerInfo): boolean;
  pointerUp(p: PointerInfo): boolean;
  doubleClick(p: PointerInfo): boolean;
  /** The cursor it wants over this screen point, or null for the controller's own. */
  cursor(screen: Pt): string | null;
  /** What the renderer draws for it this frame (cards being dragged, the drop target, folds). */
  render(): OstRenderInput | null;
  /** Text pasted onto the canvas (not the studio's own copied layers): true when it took it. */
  pasteText?(text: string): boolean;
}

let current: CanvasDelegate | null = null;

export const setCanvasDelegate = (d: CanvasDelegate | null) => void (current = d);
export const canvasDelegate = (): CanvasDelegate | null => current;
