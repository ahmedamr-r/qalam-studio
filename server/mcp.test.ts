import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { describe, expect, it } from "vitest";
import { serveMcp } from "./mcp";

describe("the organization's tools for Claude Code", () => {
  it("answers MCP over the bridge Claude Code starts, and cleans up after", async () => {
    const calls: string[] = [];
    const mcp = await serveMcp("qalam", [{ name: "search", description: "Search", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }, run: async (a) => `found ${String(a.query)}` }], (tool, args) => calls.push(`${tool}:${String(args.query)}`));
    const { mcpServers } = JSON.parse(readFileSync(mcp.config, "utf8")) as { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> };
    const def = mcpServers.qalam;
    expect(def.command).toBe(process.execPath);
    // As Claude Code would: start the bridge, speak JSON-RPC on its stdin, read its stdout.
    const child = spawn(def.command, def.args, { env: { ...process.env, ...def.env }, stdio: ["pipe", "pipe", "inherit"] });
    const lines = createInterface({ input: child.stdout! });
    const replies: unknown[] = [];
    const next = () => new Promise<unknown>((resolve) => lines.once("line", (l) => resolve(JSON.parse(l))));
    const send = async (o: unknown) => {
      child.stdin!.write(`${JSON.stringify(o)}\n`);
      if ((o as { id?: number }).id !== undefined) replies.push(await next());
    };
    await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    await send({ jsonrpc: "2.0", method: "notifications/initialized" });
    await send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    await send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search", arguments: { query: "late deliveries" } } });
    await send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope", arguments: {} } });
    await send({ jsonrpc: "2.0", id: 5, method: "resources/list" });
    expect(replies).toEqual([
      { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "qalam", version: "1" } } },
      { jsonrpc: "2.0", id: 2, result: { tools: [{ name: "search", description: "Search", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }] } },
      { jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "found late deliveries" }] } },
      { jsonrpc: "2.0", id: 4, result: { content: [{ type: "text", text: "No tool named nope" }], isError: true } },
      { jsonrpc: "2.0", id: 5, error: { code: -32601, message: "No method resources/list" } },
    ]);
    expect(calls).toEqual(["search:late deliveries"]);
    child.stdin!.end();
    await mcp.close();
    await new Promise((r) => child.once("exit", r));
    expect(existsSync(mcp.config)).toBe(false);
  });
});
