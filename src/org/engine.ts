import type { ModelMix, Tier } from "@/ai/models";
import type { UsageSummary } from "@/ai/usage-shared";
import type { HealthRow } from "@/health/doctor";
import { resetAIStatus } from "@/ai/client";

/*
 * Connections in the window: the engine Qalam AI runs on (server/engine.ts), what it used, and This
 * Mac's health (server/health.ts). The shapes are declared here, where the window can read them;
 * the server imports them.
 */

export type EngineKind = "cli" | "api";

export interface ClaudeAccount {
  email?: string;
  org?: string;
  /** "max", "pro", "team"… */
  plan?: string;
  /** "claude.ai" (a subscription) or an API key's. */
  method?: string;
  /** A key in the environment that would be used instead of the sign-in. */
  apiKeySource?: string;
}

export interface EngineTest {
  ok: boolean;
  /** One word for the card: Ready, Signed out, Key rejected… */
  word: string;
  /** What to do about it. */
  detail?: string;
  model?: string;
  ms: number;
  at: number;
}

export interface EngineView {
  kind: EngineKind;
  /** The decide tier's model. */
  model: string;
  /** "balanced": Sonnet reads, Opus decides; "best": Opus for everything. */
  models: ModelMix;
  /** What each tier runs on now, on this engine. */
  tiers: Record<Tier, string>;
  /** Claude Code on this Mac: there, signed in, and whose account pays. */
  claude: { found: boolean; signedIn: boolean | null; account?: ClaudeAccount };
  /** The API key in use: its last four characters, and where it's kept. */
  key: { last4: string; from: "keychain" | "environment" } | null;
  /** A key can be kept on this computer (the Keychain). */
  canStore: boolean;
  /** The live engine's last test, if there was one since Qalam started. */
  test: EngineTest | null;
  /** The live engine can take a call now, as far as Qalam knows. */
  ready: boolean;
  /** Its state in a word, and what to do. */
  word: string;
  detail?: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Qalam couldn't answer (${res.status})`);
  return (await res.json()) as T;
}

const send = (path: string, method: string, body?: unknown) => fetch(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/** After a change, features ask again whether Qalam AI is set up. */
const changed = <T>(v: T) => {
  resetAIStatus();
  return v;
};

export const engineDb = {
  view: () => fetch("/api/engine").then((r) => json<EngineView>(r)),
  choose: (kind: EngineKind) => send("/api/engine", "PUT", { kind }).then((r) => json<EngineView>(r)).then(changed),
  models: (models: ModelMix) => send("/api/engine/models", "PUT", { models }).then((r) => json<EngineView>(r)),
  test: (kind?: EngineKind) => send("/api/engine/test", "POST", { kind }).then((r) => json<EngineTest>(r)),
  /** Tested first; kept in the Keychain only when it works. */
  saveKey: (key: string) => send("/api/engine/key", "PUT", { key }).then((r) => json<EngineView>(r)).then(changed),
  forgetKey: () => send("/api/engine/key", "DELETE").then((r) => json<EngineView>(r)).then(changed),
  usage: (days = 7) => fetch(`/api/engine/usage?days=${days}`).then((r) => json<UsageSummary>(r)),
};

export const healthDb = {
  now: (org?: string | null) => fetch(`/api/health${org ? `?org=${encodeURIComponent(org)}` : ""}`).then((r) => json<{ rows: HealthRow[] }>(r)),
  fix: (id: string, org?: string | null) => send("/api/health/fix", "POST", { id, org }).then((r) => json<{ rows: HealthRow[] }>(r)),
};
