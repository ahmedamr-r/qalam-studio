// `pnpm desktop:dev`: the desktop window on the Vite dev server, so the UI and the API hot-reload.
// PORT picks another port when 3101 is taken.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "vite";

const server = await createServer(process.env.PORT ? { server: { port: Number(process.env.PORT) } } : {});
await server.listen();
const url = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:3101/";
const electron = createRequire(import.meta.url)("electron");
const child = spawn(electron, ["."], { stdio: "inherit", env: { ...process.env, QALAM_DEV_URL: url } });
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
