import { existsSync } from "node:fs";
import path from "node:path";

/**
 * The core's settings come from `.env.local`, then `.env`, in the folder Qalam runs from. A variable
 * already set in the environment wins over both (process.loadEnvFile never overrides), and
 * `.env.local` wins over `.env` because it is read first.
 */
export function loadEnvFiles(root: string) {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
