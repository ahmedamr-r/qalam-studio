import { create } from "zustand";

/**
 * Command surfaces over the canvas: the ⌘K Actions palette, the ⌃⇧? shortcuts panel and the
 * right-click menu. Commands open them; their components (src/ui/surfaces) render from this store.
 */

/** What was right-clicked: a point on the canvas (on layers or empty), a row in the Layers panel or a page in the Pages list. */
export type ContextTarget = "canvas" | "empty" | "layer-row" | "page-row";

export interface ContextMenuState {
  /** Client px of the click. */
  x: number;
  y: number;
  target: ContextTarget;
  /** Layers under the pointer, top-most first (canvas only), for "Select layer ▸". */
  layers: string[];
  /** ⌘-right-click: only the "Select layer" list. */
  selectOnly?: boolean;
  /** A page row: its page. */
  page?: string;
}

export interface Surfaces {
  palette: boolean;
  shortcuts: boolean;
  /** An open context menu. */
  contextMenu: ContextMenuState | null;
}

export const useSurfaces = create<Surfaces>(() => ({ palette: false, shortcuts: false, contextMenu: null }));

/** The palette and the context menu are exclusive; the shortcuts panel stays up while you work. */
export function openPalette(): void {
  useSurfaces.setState({ palette: true, contextMenu: null });
}

export function closePalette(): void {
  useSurfaces.setState({ palette: false });
}

export function toggleShortcuts(): void {
  useSurfaces.setState((s) => ({ shortcuts: !s.shortcuts, contextMenu: null }));
}

export function openContextMenu(x: number, y: number, extra: Partial<Omit<ContextMenuState, "x" | "y">> = {}): void {
  useSurfaces.setState({ contextMenu: { x, y, target: "canvas", layers: [], ...extra }, palette: false });
}

export function closeContextMenu(): void {
  useSurfaces.setState({ contextMenu: null });
}

export function closeSurfaces(): void {
  useSurfaces.setState({ palette: false, shortcuts: false, contextMenu: null });
}
