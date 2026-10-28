/*
 * Which model each Qalam AI call runs on, by its job. Calls that lift facts out of material, which
 * code then checks word for word, read; calls that propose, ask, push back or judge decide; the
 * connector tool-runner only fetches. Routed per call, never mid-conversation. "best" (the default
 * until the tier eval says otherwise, eval/tiers/run.ts) runs reads on the decide model too.
 * Pure and browser-safe: the shared call descriptors and the Claude card import it.
 */

export type Tier = "decide" | "read" | "fetch";
export type ModelMix = "balanced" | "best";
export const DEFAULT_MIX: ModelMix = "best";

/** Every kind of call Qalam AI makes, and the tier its job needs. */
export const TIER_OF = {
  // Reading: facts out of material, every quote and number checked by code.
  extract: "read",
  topics: "read",
  "setup-shape": "read",
  claims: "read",
  reader: "read",
  research: "read",
  // Deciding: proposing, asking, pushing back, judging.
  synthesize: "decide",
  draft: "decide",
  followups: "decide",
  "dump-read": "decide",
  "dump-followup": "decide",
  "dump-place": "decide",
  "setup-read": "decide",
  "setup-followup": "decide",
  "setup-place": "decide",
  review: "decide",
  bearings: "decide",
  jobs: "decide",
  breakdown: "decide",
  ask: "decide",
  // Fetching: the tool-runner makes the calls code planned.
  connector: "fetch",
  numbers: "fetch",
} as const satisfies Record<string, Tier>;

export type CallKind = keyof typeof TIER_OF;

export const isCallKind = (k: unknown): k is CallKind => typeof k === "string" && Object.hasOwn(TIER_OF, k);

/** A call with no kind (the design side) decides. */
export const tierOf = (kind: CallKind | undefined): Tier => (kind ? TIER_OF[kind] : "decide");

// Claude Code takes its own aliases for the cheaper tiers (2.1.284 warns on claude-haiku-5-5).
const DEFAULTS: Record<"api" | "cli", Record<Tier, string>> = {
  api: { decide: "claude-opus-5-5", read: "claude-sonnet-5-5", fetch: "claude-haiku-5-5" },
  cli: { decide: "claude-opus-5-5", read: "sonnet", fetch: "haiku" },
};

type Env = Record<string, string | undefined>;

/**
 * The model for a tier: the environment first (QALAM_MODEL_DECIDE/_READ/_FETCH; the older
 * DISCOVERY_MODEL, GENERATE_MODEL and CLAUDE_MODEL still set decide, CONNECTOR_MODEL fetch), then
 * the mix ("best" reads on the decide model; fetch stays where it is), then the engine's defaults.
 */
export function modelFor(tier: Tier, o: { backend: "api" | "cli"; mix: ModelMix; env: Env }): string {
  const e = o.env;
  const decide = e.QALAM_MODEL_DECIDE || e.DISCOVERY_MODEL || e.GENERATE_MODEL || e.CLAUDE_MODEL || DEFAULTS[o.backend].decide;
  if (tier === "decide") return decide;
  if (tier === "fetch") return e.QALAM_MODEL_FETCH || e.CONNECTOR_MODEL || DEFAULTS[o.backend].fetch;
  return e.QALAM_MODEL_READ || (o.mix === "best" ? decide : DEFAULTS[o.backend].read);
}

/** Models the API's server-side fallback on refusals is offered for (the "default" form; never Haiku). */
export const supportsFallback = (model: string) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);

/** "Opus", "Sonnet", "Haiku": a model's family, for people (an id or a Claude Code alias). */
export function modelFamily(model: string): string {
  const m = /opus|sonnet|haiku|fable|mythos/i.exec(model)?.[0].toLowerCase();
  return m ? m[0].toUpperCase() + m.slice(1) : model;
}
