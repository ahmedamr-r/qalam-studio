import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

/**
 * A small MCP server the core runs for one Claude Code call: the organization's own tools (its
 * search, a piece and its links, its decisions), served over a private socket rather than a
 * network port. Claude Code starts a bridge script that joins its stdin and stdout to the socket
 * (the "stdio" transport, newline-delimited JSON-RPC), so the tools run here, next to the index.
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<string>;
}

export interface McpServing {
  /** The socket (or named pipe) the bridge joins. */
  socket: string;
  /** The MCP config for Claude Code (--mcp-config), as a file. */
  config: string;
  close(): Promise<void>;
}

/** The bridge Claude Code starts: stdin and stdout joined to the core's socket. Plain Node, no imports of ours. */
const BRIDGE = `const net = require("node:net");
const sock = net.connect(process.argv[2]);
process.stdin.pipe(sock);
sock.pipe(process.stdout);
sock.on("error", () => process.exit(1));
sock.on("close", () => process.exit(0));
`;

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

/** Serve `tools` as the MCP server `name` until closed; `onCall` hears each call (for the activity line). */
export async function serveMcp(name: string, tools: McpTool[], onCall?: (tool: string, args: Record<string, unknown>) => void): Promise<McpServing> {
  // A folder only this user can read, for the socket, the bridge and the config.
  const dir = mkdtempSync(path.join(tmpdir(), "qalam-ask-"));
  const socket = process.platform === "win32" ? `\\\\.\\pipe\\qalam-ask-${randomBytes(8).toString("hex")}` : path.join(dir, "s.sock");
  const bridge = path.join(dir, "bridge.cjs");
  writeFileSync(bridge, BRIDGE, { mode: 0o600 });
  // In the desktop app the core runs inside Electron, whose binary runs as plain Node with this set.
  const config = path.join(dir, "mcp.json");
  writeFileSync(config, JSON.stringify({ mcpServers: { [name]: { type: "stdio", command: process.execPath, args: [bridge, socket], env: { ELECTRON_RUN_AS_NODE: "1" } } } }), { mode: 0o600 });

  const conns = new Set<Socket>();
  const server: Server = createServer((conn) => {
    conns.add(conn);
    conn.on("close", () => conns.delete(conn));
    conn.on("error", () => {});
    const reply = (id: Rpc["id"], body: { result?: unknown; error?: { code: number; message: string } }) => {
      if (id === undefined || id === null) return;
      conn.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...body })}\n`);
    };
    createInterface({ input: conn }).on("line", (line) => {
      let m: Rpc;
      try {
        m = JSON.parse(line) as Rpc;
      } catch {
        return;
      }
      void handle(m).then(
        (result) => result !== undefined && reply(m.id, { result }),
        (e: unknown) => reply(m.id, { error: { code: (e as { code?: number }).code ?? -32603, message: e instanceof Error ? e.message : String(e) } }),
      );
    });
    async function handle(m: Rpc): Promise<unknown> {
      switch (m.method) {
        case "initialize":
          return { protocolVersion: typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : "2025-06-18", capabilities: { tools: {} }, serverInfo: { name, version: "1" } };
        case "ping":
          return {};
        case "tools/list":
          return { tools: tools.map(({ name: n, description, inputSchema }) => ({ name: n, description, inputSchema })) };
        case "tools/call": {
          const tool = tools.find((t) => t.name === m.params?.name);
          const args = (m.params?.arguments ?? {}) as Record<string, unknown>;
          if (!tool) return { content: [{ type: "text", text: `No tool named ${String(m.params?.name)}` }], isError: true };
          onCall?.(tool.name, args);
          try {
            return { content: [{ type: "text", text: await tool.run(args) }] };
          } catch (e) {
            return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
          }
        }
        default:
          // Notifications (no id) need no answer; a request for something else gets "not found".
          if (m.id === undefined || m.id === null) return undefined;
          throw Object.assign(new Error(`No method ${String(m.method)}`), { code: -32601 });
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, () => resolve());
  });
  return {
    socket,
    config,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of conns) c.destroy();
        server.close(() => {
          rmSync(dir, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}
