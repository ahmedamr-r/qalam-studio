import type { ConnectorDef } from "./catalog";

/*
 * What Claude Code already has (pure): `claude mcp list` read line by line ("claude.ai Notion:
 * https://mcp.notion.com/mcp - ✔ Connected"), the name its tools get in `claude -p`, and which
 * listed server is a catalog connector. Claude Code keeps the sign-ins; Qalam never reads them.
 */

export type ListedStatus = "connected" | "needs-auth" | "failed" | "pending" | "disabled" | "unknown";

export interface ListedServer {
  name: string;
  /** Its address, or the command that starts it. */
  target: string;
  status: ListedStatus;
  /** One of the account's claude.ai connectors (they live there, not in a config file). */
  claudeAi: boolean;
}

const statusOf = (s: string): ListedStatus =>
  /needs? auth|authenticat|sign in/i.test(s) ? "needs-auth" : /fail|error|✘/i.test(s) ? "failed" : /disabled|⊘/i.test(s) ? "disabled" : /pending|starting|⏸/i.test(s) ? "pending" : /connected|✔/i.test(s) ? "connected" : "unknown";

export function parseMcpList(text: string): ListedServer[] {
  const out: ListedServer[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    // "<name>: <target> - <status>"; anything else (the header, a blank line) is skipped.
    const m = /^(.+?):\s+(.+)\s+-\s+(\S.*)$/.exec(line);
    if (!m || /^checking\b/i.test(line)) continue;
    const name = m[1].trim();
    out.push({ name, target: m[2].replace(/\s*\((HTTP|SSE|stdio)\)$/i, "").trim(), status: statusOf(m[3]), claudeAi: /^claude\.ai\s/i.test(name) });
  }
  return out;
}

/** The prefix its tools have in `claude -p` ("claude.ai Notion" → "mcp__claude_ai_Notion__"). */
export const toolPrefix = (server: string) => `mcp__${server.replace(/[^A-Za-z0-9_-]/g, "_")}__`;

/** The listed server that is this connector: a connected one first. */
export function matchClaudeCode(def: Pick<ConnectorDef, "claudeCode">, listed: ListedServer[]): ListedServer | null {
  const all = listed.filter((s) => def.claudeCode.test(s.name));
  return all.find((s) => s.status === "connected") ?? all[0] ?? null;
}
