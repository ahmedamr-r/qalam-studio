import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { localDir } from "../server/paths";

/*
 * The desktop app's own settings (~/Qalam/.qalam/desktop.json), kept by the main process alone:
 * whether Qalam stays in the menu bar when its window closes. Opening at login is the system's
 * (app.setLoginItemSettings), not kept here.
 */

export interface DesktopSettings {
  keepInMenuBar: boolean;
}

const file = () => path.join(localDir(), "desktop.json");
const DEFAULTS: DesktopSettings = { keepInMenuBar: true };

export function readDesktopSettings(): DesktopSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(readFileSync(file(), "utf8")) as Partial<DesktopSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeDesktopSettings(patch: Partial<DesktopSettings>): DesktopSettings {
  const next = { ...readDesktopSettings(), ...patch };
  mkdirSync(path.dirname(file()), { recursive: true });
  writeFileSync(file(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
