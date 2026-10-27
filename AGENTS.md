# Qalam Studio: notes for coding agents

- **UI:** a React single-page app built with Vite. `index.html` loads `src/main.tsx`, and `src/ui/App.tsx` picks the page from the address (`src/ui/routes.ts`). Moving between pages is a full page load, so there is no client router.
- **Server:** `server/` is a small Hono app (`server/app.ts`). Each route in `server/routes/*.ts` takes a standard `Request` and returns a `Response`; AI routes stream NDJSON. Model calls happen only there.
  - `pnpm dev` runs Vite on 127.0.0.1:3101 with the server mounted at `/api/*` (`server/vite.ts`). An edit to a route or to `src/ai` takes effect on the next request.
  - `pnpm build && pnpm start` serves `dist/` and the server from one Node process (`server/serve.ts`).
  - Requests are checked by `server/guard.ts` (Host must be this machine; writes must come from this origin; optional launch token).
- **Desktop app:** `electron/main.ts` serves the built UI at `qalam://app` and forwards `/api/*` to the core, a background utility process (`server/core.ts`), over a message port (`server/rpc.ts`). No network port is opened. `vite.desktop.config.ts` bundles both into `out/`, so the installed app needs only Electron.
  - `pnpm desktop` builds and opens it; `pnpm desktop:dev` opens the window on the Vite dev server.
  - `bin/qalam-studio.mjs` is the `npx qalam-studio` launcher.
  - The page's security policy is in `electron/assets.ts`. It allows `unsafe-eval` only because the prototype runner evaluates compiled code (`src/ui/prototype/runtime.ts`).
- **Server-only code:** `src/ai/{server,cli,research,connectors}.ts` read secrets or spawn processes. Browser code must never import them; the build fails if it does (`serverOnly()` in `server/vite.ts`).
- **Settings:** the server reads `.env.local`, then `.env` (`server/env.ts`); a variable already in the environment wins.
- **Model output:** the model proposes and code verifies. Quotes are found word for word, numbers only where the source has them, ids only from what was sent. Keep it that way in new features.
- **Checks:** `pnpm typecheck` and `pnpm test`.
