import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { qalamCore, serverOnly } from "./server/vite.ts";

/**
 * The UI is a single-page app; the core's API is mounted on the same dev server at /api/*
 * (server/vite.ts). `pnpm dev` serves both on 127.0.0.1:3101.
 */
export default defineConfig(({ mode }) => ({
  plugins: [serverOnly(), react(), tailwindcss(), qalamCore()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // Browser code reads only NODE_ENV (dev-only hooks); everything else in process.env is the server's.
  define: { "process.env.NODE_ENV": JSON.stringify(mode === "production" ? "production" : "development") },
  server: { host: "127.0.0.1", port: 3101, strictPort: true },
  preview: { host: "127.0.0.1", port: 3101, strictPort: true },
  worker: { format: "es" },
  // Pre-bundled up front: found later, it would reload the page in the middle of the first run.
  optimizeDeps: { include: ["@assistant-ui/react"] },
  // The app is read from this computer (localhost or the desktop bundle), so big chunks cost little.
  build: { target: "es2022", outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
}));
