import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

/**
 * The desktop app's two Node entries: the Electron main process and the core (a background
 * process). Everything they use is bundled in, so the installed app needs only Electron.
 * The UI itself is built by vite.config.ts into dist/.
 */
export default defineConfig({
  // public/ belongs to the UI build (dist/), not here.
  publicDir: false,
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  ssr: { noExternal: true, external: ["electron"] },
  // The preload is plain CommonJS (a sandboxed page's preload can't be a module): copied as it is.
  plugins: [
    {
      name: "qalam-preload",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "preload.cjs", source: readFileSync(path.resolve(import.meta.dirname, "electron/preload.cjs"), "utf8") });
      },
    },
  ],
  build: {
    ssr: true,
    outDir: "out",
    emptyOutDir: true,
    target: "node24",
    sourcemap: true,
    minify: false,
    rolldownOptions: {
      input: { main: "electron/main.ts", core: "server/core.ts" },
      output: { format: "es", entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js" },
    },
  },
});
