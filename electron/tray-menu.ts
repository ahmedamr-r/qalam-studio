import type { MenuItemConstructorOptions } from "electron";

/*
 * The menu bar's menu (pure, so it's tested without Electron): whether Qalam AI is ready, the way
 * into the app and quick capture, opening at login, staying in the menu bar, quitting.
 */

export interface TrayStatus {
  /** Qalam AI's state in a word ("Ready", "Signed out"…); null while the core starts. */
  engine: { ready: boolean; word: string } | null;
  /** The quick-capture shortcut as Electron writes it ("Control+Alt+Space"); null when another app has it. */
  shortcut: string | null;
  openAtLogin: boolean;
  /** Opening at login can be set (the installed app only). */
  canOpenAtLogin: boolean;
  keepInMenuBar: boolean;
}

export interface TrayActions {
  open: () => void;
  capture: () => void;
  setOpenAtLogin: (on: boolean) => void;
  setKeepInMenuBar: (on: boolean) => void;
  quit: () => void;
}

export function trayMenuTemplate(s: TrayStatus, a: TrayActions): MenuItemConstructorOptions[] {
  const engine = s.engine ? `${s.engine.ready ? "●" : "○"}  Qalam AI · ${s.engine.word}` : "Qalam is starting…";
  return [
    { label: engine, enabled: false },
    { type: "separator" },
    { label: "Open Qalam", click: a.open },
    { label: "Quick capture…", click: a.capture, ...(s.shortcut ? { accelerator: s.shortcut, registerAccelerator: false } : {}) },
    ...(s.shortcut ? [] : [{ label: "Its shortcut is taken by another app", enabled: false } as MenuItemConstructorOptions]),
    { type: "separator" },
    { label: "Open at login", type: "checkbox", checked: s.openAtLogin, enabled: s.canOpenAtLogin, click: () => a.setOpenAtLogin(!s.openAtLogin) },
    { label: "Keep Qalam in the menu bar", type: "checkbox", checked: s.keepInMenuBar, click: () => a.setKeepInMenuBar(!s.keepInMenuBar) },
    { type: "separator" },
    { label: "Quit Qalam", accelerator: "Command+Q", click: a.quit },
  ];
}
