// Renders build/icon.svg to build/icon.png (1024 px, transparent), which electron-builder turns
// into the app's icon. Run with Electron: `pnpm exec electron scripts/render-icon.mjs`.
import { app, BrowserWindow } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "..", "build");
const svg = readFileSync(path.join(dir, "icon.svg"), "utf8");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true, zoomFactor: 1 } });
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const png = image.getSize().width === 1024 ? image : image.resize({ width: 1024, height: 1024, quality: "best" });
  writeFileSync(path.join(dir, "icon.png"), png.toPNG());
  app.quit();
});
