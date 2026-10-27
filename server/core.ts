import type {} from "electron";
import { loadEnvFiles } from "./env";
import { serveRequests, type ToCore } from "./rpc";

/**
 * The core in the desktop app: a background process (Electron utility process) that answers the
 * window's /api/* requests. The main process hands it a message port; requests and streamed
 * answers travel over it (server/rpc.ts). No network port is opened.
 */

loadEnvFiles(process.env.QALAM_APP_DIR ?? process.cwd());
// The desktop app runs Qalam AI on the user's own Claude Code unless they set an API key.
if (!process.env.AI_BACKEND && !process.env.ANTHROPIC_API_KEY) process.env.AI_BACKEND = "cli";
// The routes read their settings when they load (src/ai/server.ts), so they load after the env.
const { createApi } = await import("./app");
const api = createApi();

process.parentPort.once("message", (e) => {
  const [port] = e.ports;
  serveRequests(
    (cb) => port.on("message", (m) => cb(m.data as ToCore)),
    (m) => port.postMessage(m),
    (req) => api.fetch(req),
  );
  port.start();
});
