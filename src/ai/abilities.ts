import type { EngineKind } from "./engine-kinds";

/*
 * What Qalam AI can do on each engine (pure, browser-safe). Every engine answers the structured
 * calls. Looking things up on the web is each engine's own way: Claude's web search, Codex's,
 * OpenAI's (the Responses API), OpenRouter's web plugin, Gemini's Google Search grounding; a model
 * on this computer has none, so it searches through Tavily when a Tavily key is kept here.
 * Whatever the engine, the connector tool-runner, Figma frames, PostHog numbers and Claude Code's
 * own MCP servers run through Claude Code on this computer (server/connectors/).
 */

export type WebVia = "built-in" | "tavily" | null;

/** What a lookup says when the engine can't search the web here. */
export const NO_WEB = "Web search isn't on here. A model on this computer looks things up through Tavily: add a Tavily key in Connections.";

/** How this engine looks things up on the web; null: it can't here. */
export function webVia(kind: EngineKind, tavily: boolean): WebVia {
  if (kind === "ollama" || kind === "lmstudio") return tavily ? "tavily" : null;
  return "built-in";
}
