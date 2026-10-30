import path from "node:path";
import { atomicWrite, locked, readJson, stableStringify } from "./org/fsx";
import { localDir } from "./paths";
import type { VoiceChoice } from "@/voice/model";
import type { EngineKind } from "@/ai/engine-kinds";

/*
 * This computer's settings (~/Qalam/.qalam/settings.json): which engine Qalam AI runs on and on
 * which models, and when the welcome was finished. Secrets never go here (server/secrets.ts keeps
 * them in the Keychain). Every write goes under one lock and reads the file first, so two writers
 * don't lose each other's change.
 */

export interface Settings {
  /** The engine chosen in Connections; unset: the environment decides (src/ai/engine.ts). */
  engine?: EngineKind;
  /** "balanced": Sonnet reads, Opus decides; "best": Opus, and Sonnet for the reads that hold there. Unset: "best" (src/ai/models.ts). */
  models?: "balanced" | "best";
  /** Engines that aren't Claude: the models picked for each tier, and where a model on this computer answers (a local address only). */
  engines?: Partial<Record<EngineKind, { models?: Partial<Record<"decide" | "read" | "fetch", string>>; baseUrl?: string }>>;
  /** When the first-run welcome was finished on this computer. */
  welcomedAt?: number;
  /** Who's on this computer, as they gave it in the first run (their position is per organization, in its `.qalam/local`). */
  you?: { name: string };
  /** Talking instead of typing: the engine they chose, their own dictation app, or none (unset: Apple's engine where the Mac has it, src/voice/model.ts). */
  voice?: { use: VoiceChoice };
  /** How each connector is reached: through Claude Code's server of that name, a token in the Keychain, Qalam's own sign-in to the service's MCP server at `url`, or Qalam's own Google sign-in to Drive's API (tokens in the Keychain). */
  connectors?: Record<string, { via: "claude-code"; server: string } | { via: "token" } | { via: "oauth"; url: string } | { via: "google" }>;
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
