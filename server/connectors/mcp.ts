import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { resultText } from "@/ai/research-shared";
import type { ToolSchemas } from "@/connectors/analytics";
import type { ToolCall } from "@/connectors/recipes";

/*
 * One connection to a service's MCP server (Streamable HTTP) for the length of `fn`, signed in with
 * what Qalam keeps for it (server/connectors/oauth.ts). A call's answer is its text as the server
 * gave it, or null when the tool says it failed. Calls go one at a time, so an expired token is
 * refreshed once, not once per call.
 */

export type McpCall = (call: ToolCall) => Promise<string | null>;

export async function withMcp<T>(url: string, authProvider: OAuthClientProvider, fn: (call: McpCall, tools: () => Promise<string[]>, schemas: () => Promise<ToolSchemas>) => Promise<T>, fetchFn?: FetchLike): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(url), { authProvider, ...(fetchFn ? { fetch: fetchFn } : {}) });
  const client = new Client({ name: "Qalam Studio", version: "1" });
  await client.connect(transport);
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <R>(run: () => Promise<R>): Promise<R> => {
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  };
  const listed = async () => {
    const schemas: Record<string, { properties?: Record<string, unknown> }> = {};
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = await client.listTools(cursor ? { cursor } : undefined);
      for (const t of r.tools) schemas[t.name] = t.inputSchema as { properties?: Record<string, unknown> };
      if (!(cursor = r.nextCursor)) break;
    }
    return schemas;
  };
  try {
    return await fn(
      (c) =>
        inTurn(async () => {
          const r = await client.callTool({ name: c.tool, arguments: c.args });
          if (!r.isError) return resultText(r.content);
          // The caller says it didn't answer; why is the tool's own word, for whoever's looking.
          console.warn(`[connector] ${c.tool} said: ${resultText(r.content).slice(0, 500)}`);
          return null;
        }),
      () => inTurn(async () => Object.keys(await listed())),
      () => inTurn(listed),
    );
  } finally {
    await transport.terminateSession().catch(() => {});
    await client.close().catch(() => {});
  }
}
