// Renders build/dmg-open-anyway.html (540 × 380) to build/dmg-open-anyway.tiff at 1x and 2x, so the
// ad-hoc build's .dmg window (`pnpm dist:mac:adhoc`) stays sharp on a Retina screen. Run with
// Electron: `pnpm exec electron scripts/render-dmg.mjs`.
import { app, BrowserWindow, screen } from "electron";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "..", "build");
const [W, H] = [540, 380];

/** The page at twice its size, in a hidden window: offscreen rendering fails on macOS 26 (Electron 45). */
async function render2x() {
  const scale = screen.getPrimaryDisplay().scaleFactor;
  const win = new BrowserWindow({ width: (W * 2) / scale, height: (H * 2) / scale, show: false, frame: false, useContentSize: true, webPreferences: { zoomFactor: 2 / scale } });
  await win.loadFile(path.join(dir, "dmg-open-anyway.html"));
  await win.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage();
  win.destroy();
  return image.getSize().width === W * 2 ? image : image.resize({ width: W * 2, height: H * 2, quality: "best" });
}

app
  .whenReady()
  .then(async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "qalam-dmg-"));
    const [one, two, both] = ["bg.png", "bg@2x.png", "bg.tiff"].map((f) => path.join(tmp, f));
    const image = await render2x();
    writeFileSync(two, image.toPNG());
    writeFileSync(one, image.resize({ width: W, height: H, quality: "best" }).toPNG());
    execFileSync("/usr/bin/tiffutil", ["-cathidpicheck", one, two, "-out", both]);
    execFileSync("/usr/bin/tiffutil", ["-lzw", both, "-out", path.join(dir, "dmg-open-anyway.tiff")]);
    rmSync(tmp, { recursive: true, force: true });
    app.quit();
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
