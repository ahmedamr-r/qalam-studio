import type { CompatKind } from "../engine-kinds";

/*
 * The engines that speak OpenAI's chat API (pure): where each answers, whether it needs a key and
 * where that key is kept, and how it takes a call's schema. OpenAI enforces a strict schema; Gemini
 * and a model on this computer take it as a format to follow; OpenRouter passes it on, and only to
 * providers that can enforce it. Whatever comes back is checked by code all the same.
 */

export interface Preset {
  label: string;
  base: string;
  /** Its key's Keychain item and the environment's variables; none: a model on this computer. */
  key: { item: string; env: string[] } | null;
  /** The schema enforced exactly (every field required, nothing else allowed: Qalam's schemas are). */
  strict: boolean;
  /** What else every request carries. */
  extra?: Record<string, unknown>;
  /** The answer's length is asked for as max_completion_tokens (OpenAI's newer models). */
  completionTokens?: boolean;
}

export const PRESETS: Record<CompatKind, Preset> = {
  openai: { label: "OpenAI", base: "https://api.openai.com/v1", key: { item: "openai-api-key", env: ["OPENAI_API_KEY"] }, strict: true, completionTokens: true },
  gemini: { label: "Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", key: { item: "gemini-api-key", env: ["GEMINI_API_KEY", "GOOGLE_API_KEY"] }, strict: false },
  // Only providers that honour the schema, and OpenRouter's own cost in the usage.
  openrouter: { label: "OpenRouter", base: "https://openrouter.ai/api/v1", key: { item: "openrouter-api-key", env: ["OPENROUTER_API_KEY"] }, strict: false, extra: { provider: { require_parameters: true }, usage: { include: true } } },
  ollama: { label: "Ollama", base: "http://127.0.0.1:11434/v1", key: null, strict: false },
  lmstudio: { label: "LM Studio", base: "http://127.0.0.1:1234/v1", key: null, strict: false },
};

/** A model on this computer answers only on this computer: anything else is refused. */
export function loopbackBase(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(u.hostname)) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}
