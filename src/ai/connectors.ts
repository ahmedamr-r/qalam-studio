import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EngineKind } from "./engine-kinds";
import { webVia } from "./abilities";
import { tavilyKey } from "./engine";
import type { ConnectorInfo } from "./research-shared";

/**
 * The connectors this deployment offers, from the environment:
 * - "web": the model's built-in web search and page fetch (off with WEB_SEARCH=off).
 * - "tavily": Tavily search through Tavily's hosted MCP server (TAVILY_API_KEY).
 * - "mcp:<name>": remote MCP servers listed in MCP_SERVERS, and in local dev on the CLI backend,
 *   servers you already connected in Claude Code, by name (CLI_MCP_SERVERS=mobbin,tavily-mcp).
 * Remote servers work on both backends (the API's MCP connector, or the CLI); Claude Code servers
 * need the CLI, which also holds their logins.
 */

export interface McpServerDef {
  /** Connector id. */
  id: string;
  /** MCP server name, the prefix of its tools. */
  name: string;
  label: string;
  /** Remote server URL and optional bearer token. */
  url?: string;
  token?: string;
  /** A server entry from the Claude Code config (stdio or http), for the CLI backend only. */
  cli?: Record<string, unknown>;
}

const LABELS: Record<string, string> = { mobbin: "Mobbin", "tavily-mcp": "Tavily", tavily: "Tavily", figma: "Figma", notion: "Notion" };
const HINTS: Record<string, string> = { mobbin: "Screens and flows from real apps", tavily: "Tavily web search", "tavily-mcp": "Tavily web search" };
const labelFor = (name: string) => LABELS[name] ?? name.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const validName = (n: unknown): n is string => typeof n === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(n);

export const webSearchEnabled = () => process.env.WEB_SEARCH !== "off";

function remoteServers(): McpServerDef[] {
  const out: McpServerDef[] = [];
  const tavily = process.env.TAVILY_API_KEY?.trim();
  // Tavily's hosted MCP server takes the key as a query parameter.
  if (tavily) out.push({ id: "tavily", name: "tavily", label: "Tavily", url: `https://mcp.tavily.com/mcp/?tavilyApiKey=${encodeURIComponent(tavily)}` });
  const raw = process.env.MCP_SERVERS?.trim();
  if (raw) {
    try {
      for (const s of JSON.parse(raw) as { name?: unknown; url?: unknown; token?: unknown; label?: unknown }[]) {
        if (!validName(s.name) || typeof s.url !== "string" || !/^https:\/\//.test(s.url)) continue;
        out.push({ id: `mcp:${s.name}`, name: s.name, label: typeof s.label === "string" ? s.label : labelFor(s.name), url: s.url, token: typeof s.token === "string" ? s.token : undefined });
      }
    } catch {
      console.warn("MCP_SERVERS is not valid JSON; ignoring it.");
    }
  }
  return out;
}

let claudeConfig: Record<string, Record<string, unknown>> | null = null;
/** User-scope MCP servers from Claude Code's config file. */
function claudeCodeServers(): Record<string, Record<string, unknown>> {
  if (claudeConfig) return claudeConfig;
  const file = join(process.env.CLAUDE_CONFIG_DIR || homedir(), ".claude.json");
  try {
    claudeConfig = (JSON.parse(readFileSync(file, "utf8")).mcpServers ?? {}) as Record<string, Record<string, unknown>>;
  } catch {
    claudeConfig = {};
  }
  return claudeConfig;
}

function cliServers(): McpServerDef[] {
  const names = (process.env.CLI_MCP_SERVERS ?? "").split(",").map((s) => s.trim()).filter(validName);
  if (!names.length) return [];
  const all = claudeCodeServers();
  return names.filter((n) => all[n]).map((n) => ({ id: `mcp:${n}`, name: n, label: labelFor(n), cli: all[n] }));
}

/** MCP servers usable on this backend. A remote server wins over a Claude Code one with the same id. */
export function mcpServers(backend: EngineKind): McpServerDef[] {
  if (backend !== "api" && backend !== "cli") return [];
  const remote = remoteServers();
  const local = backend === "cli" ? cliServers().filter((s) => !remote.some((r) => r.id === s.id || (r.id === "tavily" && s.name.startsWith("tavily")))) : [];
  return [...remote, ...local];
}

const webEnabledVia = (backend: EngineKind) => (webSearchEnabled() ? webVia(backend, !!tavilyKey()) : null);

export function listConnectors(backend: EngineKind): ConnectorInfo[] {
  // Another engine: its own web search, or Tavily's for a model on this computer (src/ai/engines/search.ts).
  if (backend !== "api" && backend !== "cli") {
    const via = webEnabledVia(backend);
    return via ? [{ id: "web", label: "Web search", kind: "web", hint: via === "tavily" ? "Through Tavily" : "The engine's own search" }] : [];
  }
  const list: ConnectorInfo[] = [];
  if (webSearchEnabled()) list.push({ id: "web", label: "Web search", kind: "web", hint: "Built-in search and page reading" });
  for (const s of mcpServers(backend))
    list.push({
      id: s.id,
      label: s.label,
      kind: s.id === "tavily" || s.name.startsWith("tavily") ? "tavily" : "mcp",
      hint: `${HINTS[s.name] ?? "MCP server"} · ${s.cli ? "from your Claude Code setup" : s.id === "tavily" ? "TAVILY_API_KEY" : new URL(s.url!).hostname}`,
    });
  return list;
}

/** The requested connectors this backend actually has. */
export function resolveConnectors(ids: string[], backend: EngineKind): { web: boolean; servers: McpServerDef[] } {
  // Another engine looks things up on the web its own way, and has no MCP servers here.
  if (backend !== "api" && backend !== "cli") return { web: ids.includes("web") && webSearchEnabled() && !!webVia(backend, !!tavilyKey()), servers: [] };
  const want = new Set(ids);
  return { web: want.has("web") && webSearchEnabled(), servers: mcpServers(backend).filter((s) => want.has(s.id)) };
}
