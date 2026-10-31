import { app, dialog, Menu, MenuItem, Notification, shell } from "electron";
import electronUpdater from "electron-updater";
import { signingTeam } from "./signature";

/**
 * Updates for the installed app, from GitHub Releases (electron-builder.yml): it looks for a newer
 * version when it starts and every six hours, downloads it quietly and installs it when it quits.
 * "Check for Updates…" in the app menu looks now and says what it found. Only a signed app can
 * install one (macOS checks), so a Mac app signed ad hoc (docs/install-mac.md) says a newer one is
 * out and opens its page instead. Only the installed app looks: npx and development don't.
 */

const EVERY_MS = 6 * 60 * 60 * 1000;
const RELEASES = "https://github.com/ahmedamr-r/qalam-studio/releases";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function watchForUpdates() {
  if (!app.isPackaged || process.env.QALAM_NO_UPDATES) return;
  const { autoUpdater } = electronUpdater;
  autoUpdater.logger = null;
  // Windows installs one unsigned; a Mac needs a team's signature.
  const installs = process.platform !== "darwin" || (await signingTeam()) != null;
  autoUpdater.autoDownload = installs;
  autoUpdater.autoInstallOnAppQuit = installs;
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

  // Signed ad hoc: it says a version is out (once, unless asked) and opens its page to download it.
  let told = "";
  let notice: Notification | null = null;
  const tell = async (version: string, fromMenu: boolean) => {
    const page = `${RELEASES}/tag/v${version}`;
    if (fromMenu) {
      const { response } = await dialog.showMessageBox({ type: "info", message: `Qalam Studio ${version} is out`, detail: "This copy can't update itself. Download the new one, quit Qalam, then drag it into Applications to replace this one and open it as you did the first time.", buttons: ["Download", "Later"], defaultId: 0, cancelId: 1 });
      if (response === 0) void shell.openExternal(page);
    } else if (told !== version) {
      told = version;
      notice = new Notification({ title: `Qalam Studio ${version} is out`, body: "Click to download it." });
      notice.on("click", () => void shell.openExternal(page));
      notice.show();
    }
  };

  const check = async (fromMenu: boolean) => {
    asked ||= fromMenu;
    try {
      const r = await autoUpdater.checkForUpdates();
      if (r?.isUpdateAvailable && !installs) {
        asked = false;
        return await tell(r.updateInfo.version, fromMenu);
      }
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
