import { app, BrowserWindow, dialog, ipcMain, MessageChannelMain, protocol, session, shell, utilityProcess, type WebContents } from "electron";
import { readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findClaude, joinPaths, loginShellPath } from "../server/claude";
import { requester, type FromCore } from "../server/rpc";
import { assetPath, contentSecurityPolicy, inlineScriptHashes, mimeOf } from "./assets";
import { watchForUpdates } from "./updates";

/**
 * Qalam as a desktop app. The window shows the built UI at qalam://app; its /api/* requests go to
 * the core, a background process, over a message port, so no network port is ever opened.
 * `QALAM_DEV_URL` points the window at the Vite dev server instead (UI and API with hot reload).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const ORIGIN = "qalam://app";
const DEV_URL = process.env.QALAM_DEV_URL || null;
/** For automated checks: run without showing the window. */
const HIDDEN = process.env.QALAM_HIDDEN === "1";

protocol.registerSchemesAsPrivileged([{ scheme: "qalam", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);
app.setName("Qalam Studio");
if (process.env.QALAM_DEBUG_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.QALAM_DEBUG_PORT);

let quitting = false;
let coreFetch: ((req: Request) => Promise<Response>) | null = null;
let restarts = 0;

/** Start the core, and again if it stops (at most 5 times, so a crash at startup can't loop). */
function startCore() {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), QALAM_APP_DIR: ROOT, NODE_ENV: "production" };
  const claude = findClaude();
  if (claude) env.CLAUDE_CLI_PATH = claude;
  const child = utilityProcess.fork(path.join(ROOT, "out", "core.js"), [], { serviceName: "Qalam core", stdio: "inherit", env });
  const { port1, port2 } = new MessageChannelMain();
  child.postMessage({ t: "port" }, [port2]);
  const core = requester(
    (m) => port1.postMessage(m),
    (cb) => port1.on("message", (e) => cb(e.data as FromCore)),
  );
  port1.start();
  coreFetch = core.fetch;
  child.once("exit", () => {
    core.failAll("Qalam's background process stopped. Try again.");
    port1.close();
    coreFetch = null;
    if (!quitting && restarts++ < 5) startCore();
  });
}

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

let csp: string | null = null;
const pagePolicy = () => (csp ??= contentSecurityPolicy(inlineScriptHashes(readFileSync(path.join(DIST, "index.html"), "utf8"))));

async function serve(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.host !== "app") return new Response("Not found", { status: 404 });
  if (url.pathname.startsWith("/api/")) {
    if (!coreFetch) return Response.json({ error: "starting", message: "Qalam is still starting. Try again in a moment." }, { status: 503 });
    try {
      return await coreFetch(req);
    } catch (e) {
      return Response.json({ error: "core", message: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  }
  const file = assetPath(DIST, url.pathname, isFile);
  if (!file) return new Response("Not found", { status: 404 });
  const headers: Record<string, string> = { "content-type": mimeOf(file) };
  if (file.endsWith(".html")) headers["content-security-policy"] = pagePolicy();
  return new Response(await readFile(file), { headers });
}

/** Web links open in the user's browser; nothing else leaves the app. */
function openOutside(url: string) {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

/** The app's own pages: qalam://app, or the dev server in desktop:dev. */
const ours = (url: string) => (DEV_URL ? url.startsWith(new URL(DEV_URL).origin + "/") : url.startsWith(`${ORIGIN}/`));

const webPreferences = { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: !HIDDEN, preload: path.join(ROOT, "out", "preload.cjs") };

/**
 * Every window stays on the app's pages: a link elsewhere opens in the user's browser, and a page
 * of the app asked for in a new window (a project "in a new tab") gets an app window of its own.
 */
function guard(contents: WebContents) {
  contents.on("will-navigate", (e, url) => {
    if (ours(url)) return;
    e.preventDefault();
    openOutside(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (ours(url)) return { action: "allow", overrideBrowserWindowOptions: { width: 1440, height: 900, minWidth: 900, minHeight: 600, backgroundColor: "#090908", webPreferences } };
    openOutside(url);
    return { action: "deny" };
  });
}

/** The system's folder picker, for the page's "Open a folder as an organization" (electron/preload.cjs). */
ipcMain.handle("qalam:choose-folder", async (e, title: string) => {
  if (!ours(e.senderFrame?.url ?? "")) return null;
  const win = BrowserWindow.fromWebContents(e.sender);
  const opts = { title: title.slice(0, 120), buttonLabel: "Open", properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? null : (r.filePaths[0] ?? null);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Qalam Studio",
    backgroundColor: "#090908",
    webPreferences,
  });
  win.once("ready-to-show", () => {
    if (!HIDDEN) win.show();
  });
  // Edits save 400 ms after they settle: give the page a moment to finish before the window goes.
  let closing = false;
  win.on("close", (e) => {
    if (closing) return;
    closing = true;
    e.preventDefault();
    const flushed = win.webContents.executeJavaScript("window.__qalamBeforeClose ? window.__qalamBeforeClose() : null", true).catch(() => {});
    void Promise.race([flushed, new Promise((r) => setTimeout(r, 3000))]).finally(() => win.destroy());
  });
  void win.loadURL(DEV_URL ?? `${ORIGIN}/`);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.on("before-quit", () => (quitting = true));
  app.on("window-all-closed", () => app.quit());
  app.on("web-contents-created", (_e, contents) => guard(contents));
  void app.whenReady().then(async () => {
    // Clipboard for copy and paste on the canvas; every other permission (camera, location…) is refused.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === "clipboard-read" || permission === "clipboard-sanitized-write" || permission === "fullscreen"));
    // The installed app, opened from the Dock or Finder, has only the system's PATH: take the one a
    // terminal has, so Claude Code (and the node an npm-installed one runs on) is found.
    if (app.isPackaged) process.env.PATH = joinPaths(await loginShellPath(), process.env.PATH);
    if (!DEV_URL) {
      protocol.handle("qalam", serve);
      startCore();
    }
    createWindow();
    watchForUpdates();
  });
}
