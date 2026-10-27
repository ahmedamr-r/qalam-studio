#!/usr/bin/env node
// `npx qalam-studio`: opens Qalam as a desktop app, in the Electron that npm installed with it.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const electron = createRequire(import.meta.url)("electron");
const app = fileURLToPath(new URL("..", import.meta.url));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [app, ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
