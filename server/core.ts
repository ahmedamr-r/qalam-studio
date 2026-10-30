import type {} from "electron";
import { loadEnvFiles } from "./env";
import { serveRequests, type ToCore } from "./rpc";
import { useSealedSecrets } from "./secrets";

/**
 * The core in the desktop app: a background process (Electron utility process) that answers the
 * window's /api/* requests. The main process hands it a message port; requests and streamed
 * answers travel over it (server/rpc.ts). No network port is opened.
 */

loadEnvFiles(process.env.QALAM_APP_DIR ?? process.cwd());

// With no Keychain (Windows), the main process keeps the secrets sealed (electron/secrets.ts): ask it.
const asked = new Map<number, { resolve: (v: string | null) => void; reject: (e: Error) => void }>();
let asks = 0;
if (process.env.QALAM_SECRETS === "electron")
  useSealedSecrets(
    (op, name, value) =>
      new Promise((resolve, reject) => {
        const id = ++asks;
        asked.set(id, { resolve, reject });
        process.parentPort.postMessage({ t: "secret", id, op, name, value });
      }),
  );
// The desktop app runs Qalam AI on the user's own Claude Code unless they set an API key.
if (!process.env.AI_BACKEND && !process.env.ANTHROPIC_API_KEY) process.env.AI_BACKEND = "cli";
// The routes read their settings when they load (src/ai/server.ts), so they load after the env.
const { createApi, openLastOrg } = await import("./app");
const api = createApi();
// Its inbox is read from the start, whatever the window shows (server/inbox.ts).
void openLastOrg();

process.parentPort.on("message", (e) => {
  const m = e.data as { t?: string; id?: number; value?: string | null; error?: string } | undefined;
  if (m?.t === "secret") {
    const waiting = asked.get(m.id ?? -1);
    asked.delete(m.id ?? -1);
    if (m.error) waiting?.reject(new Error(m.error));
    else waiting?.resolve(m.value ?? null);
    return;
  }
  const [port] = e.ports;
  if (!port) return;
  serveRequests(
    (cb) => port.on("message", (m) => cb(m.data as ToCore)),
    (m) => port.postMessage(m),
    (req) => api.fetch(req),
  );
  port.start();
});
