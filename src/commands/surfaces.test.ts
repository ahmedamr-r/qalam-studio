import { beforeEach, describe, expect, it } from "vitest";
import { closeContextMenu, closePalette, closeSurfaces, openContextMenu, openPalette, toggleShortcuts, useSurfaces } from "./surfaces";

describe("surfaces", () => {
  beforeEach(() => closeSurfaces());

  it("keeps the palette and the context menu exclusive", () => {
    openContextMenu(10, 20, { target: "empty" });
    expect(useSurfaces.getState().contextMenu).toEqual({ x: 10, y: 20, target: "empty", layers: [] });
    openPalette();
    expect(useSurfaces.getState().contextMenu).toBeNull();
    openContextMenu(1, 2);
    expect(useSurfaces.getState().palette).toBe(false);
    expect(useSurfaces.getState().contextMenu?.target).toBe("canvas");
  });

  it("leaves the shortcuts panel up while the palette comes and goes", () => {
    toggleShortcuts();
    openPalette();
    closePalette();
    expect(useSurfaces.getState().shortcuts).toBe(true);
    closeContextMenu();
    expect(useSurfaces.getState().shortcuts).toBe(true);
    toggleShortcuts();
    expect(useSurfaces.getState().shortcuts).toBe(false);
  });
});
