#!/usr/bin/env node
// `npx qalam-studio`: opens Qalam as a desktop app, in the Electron that npm installed with it.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const RELEASES = "https://github.com/ahmedamr-r/qalam-studio/releases/latest";

// Electron's package fetches and finds its binary with this Node, and on an older one fails with a stack trace.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Qalam Studio needs Node 22.12 or newer to start this way, and this is Node ${process.versions.node}.\nUpdate Node (https://nodejs.org), or download the app instead: ${RELEASES}`);
  process.exit(1);
}

let electron;
try {
  // The first time, this downloads Electron (about 100 MB) and says so.
  electron = createRequire(import.meta.url)("electron");
} catch (e) {
  console.error(`Qalam Studio couldn't fetch Electron, which it runs on. Check your connection and try again, or download the app instead: ${RELEASES}\n\n${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

const app = fileURLToPath(new URL("..", import.meta.url));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// It stays in the menu bar when its window closes, so nothing here would say why this hasn't ended.
console.log("Opening Qalam Studio. Press Ctrl+C here to quit it.");

const child = spawn(electron, [app, ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
