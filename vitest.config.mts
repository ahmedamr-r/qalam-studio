import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // The bench's own pure parts (its measures) are tested too; its runs aren't tests and spend tokens.
  test: { include: ["src/**/*.test.ts", "server/**/*.test.ts", "electron/**/*.test.ts", "eval/**/*.test.ts"], setupFiles: ["./vitest.setup.ts"] },
});
