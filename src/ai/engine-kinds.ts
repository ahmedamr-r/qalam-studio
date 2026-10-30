/*
 * The engines Qalam AI can run on (pure, browser-safe): the person's own Claude Code ("cli") or a
 * Claude API key ("api"); the person's own Codex, signed in with ChatGPT; a key for OpenAI, Gemini
 * or OpenRouter; or a model on this computer through Ollama or LM Studio. Each engine is reached
 * the way its maker allows: an agent's own binary signed in through its own flow, or a key.
 */

export const ENGINE_KINDS = ["cli", "api", "codex", "openai", "gemini", "openrouter", "ollama", "lmstudio"] as const;
export type EngineKind = (typeof ENGINE_KINDS)[number];

export const isEngineKind = (x: unknown): x is EngineKind => typeof x === "string" && (ENGINE_KINDS as readonly string[]).includes(x);

export const ENGINE_LABEL: Record<EngineKind, string> = {
  cli: "Claude Code",
  api: "Anthropic API key",
  codex: "Codex (ChatGPT)",
  openai: "OpenAI API key",
  gemini: "Gemini API key",
  openrouter: "OpenRouter key",
  ollama: "Ollama",
  lmstudio: "LM Studio",
};

/** Engines that speak OpenAI's chat API: a key, or a server on this computer. */
export const COMPAT_KINDS = ["openai", "gemini", "openrouter", "ollama", "lmstudio"] as const;
export type CompatKind = (typeof COMPAT_KINDS)[number];
export const isCompat = (k: EngineKind): k is CompatKind => (COMPAT_KINDS as readonly string[]).includes(k);

/** A model on this computer: nothing leaves it, and nothing is paid. */
export const isLocal = (k: EngineKind) => k === "ollama" || k === "lmstudio";

/** Engines reached with a key the person pastes (kept in the Keychain). */
export const KEYED_KINDS = ["api", "openai", "gemini", "openrouter"] as const;
export type KeyedKind = (typeof KEYED_KINDS)[number];
export const isKeyed = (k: EngineKind): k is KeyedKind => (KEYED_KINDS as readonly string[]).includes(k);
