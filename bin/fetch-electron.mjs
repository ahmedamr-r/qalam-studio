// Fetches the Electron that `npx qalam-studio` runs on, the first time. Electron's own install shows no
// progress and has no timeout, and one bad connection to GitHub can crawl for hours when a new one takes a minute.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const LOOK_EVERY = 5_000;
const SAY_EVERY = 15_000;
/** How little has to arrive in how long for a connection to count as crawling: hours for the whole file. */
const WINDOW = 45_000;
const AT_LEAST = 1_000_000;
const TRIES = 3;

const mb = (bytes) => `${Math.round(bytes / 1_000_000)} MB`;

/** Whether it's crawling, from how much had arrived when (oldest first). Too early to say is no. */
export function crawling(samples, now, window = WINDOW, atLeast = AT_LEAST) {
  const then = [...samples].reverse().find((s) => now - s.at >= window);
  return !!then && samples[samples.length - 1].bytes - then.bytes < atLeast;
}

/** The download under way: the newest of Electron's temp folders since it started, and how much is in it. */
function partial(since) {
  const root = tmpdir();
  let found = null;
  for (const name of readdirSync(root)) {
    if (!name.startsWith("electron-download-")) continue;
    const dir = path.join(root, name);
    try {
      const at = statSync(dir).mtimeMs;
      if (at < since || (found && at < found.at)) continue;
      const bytes = readdirSync(dir).reduce((n, f) => n + statSync(path.join(dir, f)).size, 0);
      found = { dir, at, bytes };
    } catch {
      // Gone as it was looked at: it finished.
    }
  }
  return found;
}

/** One go: "done", "failed", or "crawling" once it's been stopped for crawling (`patient`: it's left to go on). */
function attempt(electronDir, patient, say) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(electronDir, "install.js")], { stdio: "inherit" });
    const samples = [{ at: started, bytes: 0 }];
    let said = started;
    let current = null;
    const stop = setInterval(() => {
      const now = Date.now();
      // Unpacking from here on, and nothing arrives while it does.
      if (existsSync(path.join(electronDir, "dist"))) return clearInterval(stop);
      current = partial(started - 1000);
      samples.push({ at: now, bytes: current?.bytes ?? 0 });
      if (now - said >= SAY_EVERY) {
        said = now;
        say(`  ${mb(current?.bytes ?? 0)} so far…`);
      }
      if (!patient && crawling(samples, now)) {
        clearInterval(stop);
        child.removeAllListeners("exit");
        child.once("exit", () => {
          if (current) rmSync(current.dir, { recursive: true, force: true });
          resolve("crawling");
        });
        child.kill();
      }
    }, LOOK_EVERY);
    child.once("exit", (code) => {
      clearInterval(stop);
      resolve(code === 0 ? "done" : "failed");
    });
  });
}

/** True once Electron is there. */
export async function fetchElectron(electronDir, say = console.log, help = "") {
  say("Downloading the desktop app it runs on, once (about 120 MB).");
  for (let n = 1; ; n++) {
    const patient = n >= TRIES;
    if (patient) say(`This connection is slow. You can leave it running, or download the app instead: ${help}`);
    const got = await attempt(electronDir, patient, say);
    if (got !== "crawling") return got === "done";
    say("  That connection is crawling, so trying a new one.");
  }
}
