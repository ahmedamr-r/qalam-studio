import { app, Menu, nativeImage, Tray, type NativeImage } from "electron";
import { readDesktopSettings, writeDesktopSettings } from "./desktop-settings";
import { trayMenuTemplate, type TrayStatus } from "./tray-menu";

/*
 * Qalam in the menu bar: it stays there when the window closes, so the inbox and the connectors keep
 * working. Its menu says whether Qalam AI is ready (from the core's health, asked every half
 * minute), opens the app or quick capture, and holds opening at login and staying in the menu bar.
 */

/** The Qalam AI nuqta pair as a template image (black and clear: macOS tints it). */
function glyph(): NativeImage {
  const size = 32;
  const px = Buffer.alloc(size * size * 4);
  const dots = [
    [11, 19, 5.2],
    [21, 13, 5.2],
  ];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // Coverage at the pixel's centre, softened over a pixel for a smooth edge.
      const a = Math.max(...dots.map(([cx, cy, r]) => Math.min(1, Math.max(0, r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5))));
      px[(y * size + x) * 4 + 3] = Math.round(a * 255);
    }
  const img = nativeImage.createFromBitmap(px, { width: size, height: size, scaleFactor: 2 });
  img.setTemplateImage(true);
  return img;
}

export interface TrayDeps {
  open: () => void;
  capture: () => void;
  /** The core's answer to an /api path (null while it starts). */
  api: (path: string) => Promise<Response | null>;
  shortcut: () => string | null;
}

export function startTray(deps: TrayDeps): Tray {
  const tray = new Tray(glyph());
  tray.setToolTip("Qalam Studio");
  let engine: TrayStatus["engine"] = null;

  const rebuild = () => {
    const login = app.getLoginItemSettings();
    const status: TrayStatus = { engine, shortcut: deps.shortcut(), openAtLogin: login.openAtLogin, canOpenAtLogin: app.isPackaged, keepInMenuBar: readDesktopSettings().keepInMenuBar };
    tray.setContextMenu(
      Menu.buildFromTemplate(
        trayMenuTemplate(status, {
          open: deps.open,
          capture: deps.capture,
          setOpenAtLogin: (on) => {
            app.setLoginItemSettings({ openAtLogin: on });
            rebuild();
          },
          setKeepInMenuBar: (on) => {
            writeDesktopSettings({ keepInMenuBar: on });
            rebuild();
          },
          quit: () => app.quit(),
        }),
      ),
    );
  };

  const check = async () => {
    try {
      const res = await deps.api("/api/health");
      if (res?.ok) {
        const { rows } = (await res.json()) as { rows: { id: string; word: string }[] };
        const row = rows.find((r) => r.id === "engine");
        engine = row ? { ready: false, word: row.word } : { ready: true, word: "Ready" };
      }
    } catch {
      // The core is starting or restarting: say so until it answers.
    }
    rebuild();
  };
  rebuild();
  void check();
  const timer = setInterval(() => void check(), 30_000);
  app.once("will-quit", () => clearInterval(timer));
  return tray;
}
