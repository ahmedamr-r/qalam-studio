import { describe, expect, it, vi } from "vitest";
import { trayMenuTemplate, type TrayStatus } from "./tray-menu";

const status = (over: Partial<TrayStatus> = {}): TrayStatus => ({ engine: { ready: true, word: "Ready" }, shortcut: "Control+Alt+Space", openAtLogin: false, canOpenAtLogin: true, keepInMenuBar: true, ...over });
const actions = () => ({ open: vi.fn(), capture: vi.fn(), setOpenAtLogin: vi.fn(), setKeepInMenuBar: vi.fn(), quit: vi.fn() });

describe("the menu bar's menu", () => {
  it("says whether Qalam AI is ready, and offers the app and quick capture with its keys", () => {
    const m = trayMenuTemplate(status(), actions());
    expect(m[0]).toMatchObject({ label: "●  Qalam AI · Ready", enabled: false });
    expect(m.find((i) => i.label === "Quick capture…")).toMatchObject({ accelerator: "Control+Alt+Space", registerAccelerator: false });
    expect(trayMenuTemplate(status({ engine: { ready: false, word: "Signed out" } }), actions())[0].label).toBe("○  Qalam AI · Signed out");
    expect(trayMenuTemplate(status({ engine: null }), actions())[0].label).toBe("Qalam is starting…");
  });

  it("says when another app has the shortcut", () => {
    const m = trayMenuTemplate(status({ shortcut: null }), actions());
    expect(m.find((i) => i.label === "Quick capture…")?.accelerator).toBeUndefined();
    expect(m.some((i) => i.label === "Its shortcut is taken by another app")).toBe(true);
  });

  it("toggles opening at login (installed app only) and staying in the menu bar", () => {
    const a = actions();
    const m = trayMenuTemplate(status({ openAtLogin: true, canOpenAtLogin: false }), a);
    const login = m.find((i) => i.label === "Open at login")!;
    expect(login).toMatchObject({ type: "checkbox", checked: true, enabled: false });
    (login.click as () => void)();
    expect(a.setOpenAtLogin).toHaveBeenCalledWith(false);
    (m.find((i) => i.label === "Keep Qalam in the menu bar")!.click as () => void)();
    expect(a.setKeepInMenuBar).toHaveBeenCalledWith(false);
  });
});
