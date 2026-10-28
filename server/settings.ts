import path from "node:path";
import { atomicWrite, locked, readJson, stableStringify } from "./org/fsx";
import { localDir } from "./paths";

/*
 * This computer's settings (~/Qalam/.qalam/settings.json): which engine Qalam AI runs on, and
 * when the welcome was finished. Secrets never go here (server/secrets.ts keeps them in the
 * Keychain). Every write goes under one lock and reads the file first, so two writers don't lose
 * each other's change.
 */

export interface Settings {
  /** The engine chosen in Connections; unset: the environment decides (src/ai/engine.ts). */
  engine?: "cli" | "api";
  /** When the first-run welcome was finished on this computer. */
  welcomedAt?: number;
  /** How each connector is reached: through Claude Code's server of that name, a token in the Keychain, or Qalam's own sign-in to the service's MCP server at `url` (its tokens in the Keychain). */
  connectors?: Record<string, { via: "claude-code"; server: string } | { via: "token" } | { via: "oauth"; url: string }>;
}

const file = () => path.join(localDir(), "settings.json");

export async function readSettings(): Promise<Settings> {
  return (await readJson<Settings>(file()).catch(() => null)) ?? {};
}

/** Change some settings (undefined removes one); returns them all as written. */
export function writeSettings(patch: Partial<Settings>): Promise<Settings> {
  return locked(file(), async () => {
    const next: Settings = { ...(await readSettings()), ...patch };
    for (const k of Object.keys(next) as (keyof Settings)[]) if (next[k] === undefined) delete next[k];
    await atomicWrite(file(), stableStringify(next));
    return next;
  });
}
