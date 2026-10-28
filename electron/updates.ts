import { app, dialog, Menu, MenuItem, Notification } from "electron";
import electronUpdater from "electron-updater";

/**
 * Updates for the installed app, from GitHub Releases (electron-builder.yml): it looks for a newer
 * version when it starts and every six hours, downloads it quietly and installs it when it quits.
 * "Check for Updates…" in the app menu looks now and says what it found. Only a signed app can
 * install one (macOS checks), and only the installed app looks: npx and development don't.
 */

const EVERY_MS = 6 * 60 * 60 * 1000;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function watchForUpdates() {
  if (!app.isPackaged || process.env.QALAM_NO_UPDATES) return;
  const { autoUpdater } = electronUpdater;
  autoUpdater.logger = null;
  autoUpdater.autoInstallOnAppQuit = true;
  // Asked from the menu: say when it's ready, and offer to restart for it.
  let asked = false;

  autoUpdater.on("update-downloaded", (info) => {
    if (!asked) {
      new Notification({ title: `Qalam Studio ${info.version} is ready`, body: "It's installed when you quit Qalam." }).show();
      return;
    }
    asked = false;
    void dialog
      .showMessageBox({ type: "info", message: `Qalam Studio ${info.version} is ready`, detail: "It's installed when you quit. Restart now to use it?", buttons: ["Restart now", "Later"], defaultId: 0, cancelId: 1 })
      .then(({ response }) => response === 0 && autoUpdater.quitAndInstall());
  });

  const check = async (fromMenu: boolean) => {
    asked ||= fromMenu;
    try {
      const r = await autoUpdater.checkForUpdates();
      if (!fromMenu) return;
      if (r?.isUpdateAvailable) await dialog.showMessageBox({ type: "info", message: `Downloading Qalam Studio ${r.updateInfo.version}`, detail: "Qalam says when it's ready to install." });
      else {
        asked = false;
        await dialog.showMessageBox({ type: "info", message: "Qalam Studio is up to date", detail: `${app.getVersion()} is the newest version.` });
      }
    } catch (e) {
      asked = false;
      if (fromMenu) await dialog.showMessageBox({ type: "warning", message: "Qalam couldn't check for updates", detail: message(e) });
      else console.warn(`[qalam] couldn't check for updates: ${message(e)}`);
    }
  };

  // Beside "About Qalam Studio" in the app menu.
  const menu = Menu.getApplicationMenu();
  const appMenu = menu?.items[0]?.submenu;
  if (menu && appMenu) {
    appMenu.insert(1, new MenuItem({ label: "Check for Updates…", click: () => void check(true) }));
    Menu.setApplicationMenu(menu);
  }
  void check(false);
  setInterval(() => void check(false), EVERY_MS);
}
