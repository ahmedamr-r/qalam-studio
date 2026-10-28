import type { IncomingMessage, ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";
import type { Plugin, ViteDevServer } from "vite";
import { loadEnvFiles } from "./env.ts";
import { checkRequest, factsOf, tokenLanding, type GuardConfig } from "./guard.ts";

/** Modules that read secrets or spawn processes. The browser bundle must never contain them. */
const SERVER_ONLY = /\/src\/ai\/(cli|research|server|connectors|engine|usage)\.ts$/;

/**
 * The core inside the Vite dev server: /api/* goes to the same routes the browser mode and the
 * desktop app serve, on the same origin as the UI. Server code is loaded through Vite, so an edit
 * to a route or to src/ai takes effect on the next request. `<name>.localhost` hosts are allowed,
 * so each test can run on its own origin.
 */
export function qalamCore(): Plugin {
  return {
    name: "qalam-core",
    configureServer(server: ViteDevServer) {
      loadEnvFiles(server.config.root);
      const guard = (): GuardConfig => {
        const a = server.httpServer?.address();
        const port = a && typeof a === "object" ? a.port : (server.config.server.port ?? 3101);
        return { port, subdomains: true, token: process.env.QALAM_TOKEN || undefined };
      };
      // The platform's own Request and Response stay global: the MCP SDK checks `instanceof Response` on what fetch returns.
      const listener = getRequestListener(async (req) => {
        const verdict = checkRequest(factsOf(req), guard());
        if (!verdict.ok) return Response.json({ error: "forbidden", message: verdict.reason }, { status: verdict.status });
        const { createApi } = (await server.ssrLoadModule("/server/app.ts")) as typeof import("./app");
        return createApi().fetch(req);
      }, { overrideGlobalObjects: false });
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.url?.startsWith("/api/")) return void listener(req, res);
        const landing = req.method === "GET" && req.url?.includes("t=") ? tokenLanding(new URL(req.url, "http://localhost"), guard()) : null;
        if (!landing) return next();
        res.writeHead(302, { location: landing.location, "set-cookie": landing.setCookie });
        res.end();
      });
    },
  };
}

/** Fails the browser build (and dev) when a server-only module is imported by browser code. */
export function serverOnly(): Plugin {
  return {
    name: "qalam-server-only",
    enforce: "pre",
    transform(_code, id, options) {
      if (!options?.ssr && SERVER_ONLY.test(id.split("?")[0])) this.error(`${id} is server-only, but browser code imports it.`);
    },
  };
}
