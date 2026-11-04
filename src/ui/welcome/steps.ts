import { isKeyed, type EngineKind } from "@/ai/engine-kinds";

/* What the welcome and the boot decide (pure): which welcome this is, how long to wait for the core, and when an engine gives way. */

/** first: no organization yet · new: another one (from the organization menu). */
export type WelcomeMode = "first" | "new";

export const welcomeMode = (search: string): WelcomeMode => (new URLSearchParams(search).get("new") === "1" ? "new" : "first");

const RETRY_MS = [250, 500, 1000, 1500, 2000, 3000, 3000, 3000];

/** How long to wait before asking the core again while it starts (about 15 s in all); null: say it can't be reached. */
export const bootRetryDelay = (attempt: number): number | null => RETRY_MS[attempt] ?? null;

/**
 * Whether the live engine can't run, so the welcome looks for one that can: one that takes a key and
 * has none, or Claude Code or Codex that isn't here or is signed out. One whose sign-in can't be told
 * stays, as does a model on this computer that isn't running: someone chose that.
 */
export function engineGivesWay(v: { kind: EngineKind; key: unknown; claude: { found: boolean; signedIn: boolean | null }; codex?: { found: boolean; signedIn: boolean | null } }): boolean {
  if (isKeyed(v.kind)) return !v.key;
  const agent = v.kind === "cli" ? v.claude : v.kind === "codex" ? v.codex : null;
  return !!agent && (!agent.found || agent.signedIn === false);
}
