import { Hono } from "hono";
import { orgRoutes } from "./org/routes";
import * as audit from "./routes/audit";
import * as component from "./routes/component";
import * as critique from "./routes/critique";
import * as critiqueFix from "./routes/critique-fix";
import * as devImport from "./routes/dev-import";
import * as discovery from "./routes/discovery";
import * as extract from "./routes/extract";
import * as extractDs from "./routes/extract-ds";
import * as fetchUrl from "./routes/fetch-url";
import * as fonts from "./routes/fonts";
import * as generate from "./routes/generate";
import * as generateSection from "./routes/generate-section";
import * as interview from "./routes/interview";
import * as plan from "./routes/plan";
import * as prototype from "./routes/prototype";
import * as repair from "./routes/repair";
import * as restyle from "./routes/restyle";
import * as status from "./routes/status";
import * as translate from "./routes/translate";
import * as tuneSystem from "./routes/tune-system";

type Handler = (req: Request) => Response | Promise<Response>;

/** Each route takes a standard Request and answers a standard Response (AI routes stream NDJSON). */
const ROUTES: Record<string, { GET?: Handler; POST?: Handler }> = {
  audit,
  component,
  critique,
  "critique-fix": critiqueFix,
  "dev-import": devImport,
  discovery,
  extract,
  "extract-ds": extractDs,
  "fetch-url": fetchUrl,
  fonts,
  generate,
  "generate-section": generateSection,
  interview,
  plan,
  prototype,
  repair,
  restyle,
  status,
  translate,
  "tune-system": tuneSystem,
};

/**
 * The core's API, served at /api/* by the dev server, the browser mode and (soon) the desktop app.
 * It knows nothing about how it is reached: whoever mounts it checks the request first.
 */
export function createApi(): Hono {
  const api = new Hono();
  for (const [name, route] of Object.entries(ROUTES)) {
    if (route.GET) api.get(`/api/${name}`, (c) => route.GET!(c.req.raw));
    if (route.POST) api.post(`/api/${name}`, (c) => route.POST!(c.req.raw));
  }
  // The organization's files (projects, sources, chats, images…): server/org.
  api.route("/", orgRoutes());
  api.all("/api/*", (c) => c.json({ error: "not_found", message: `No ${c.req.method} ${new URL(c.req.url).pathname}` }, 404));
  return api;
}
