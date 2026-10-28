import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ingested } from "@/discovery/ingest/core";
import type { OrgStore } from "../org/store";
import { resetSecrets, secrets } from "../secrets";

const captured: Ingested[] = [];
vi.mock("../capture", () => ({ captureSource: async (_s: unknown, ing: Ingested) => void captured.push(ing) }));

const { connectorsView, forgetConnector, importItems, saveToken } = await import("./index");

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-connectors-"));
  process.env.QALAM_HOME = dir;
  process.env.QALAM_SECRETS = "memory";
  resetSecrets();
  captured.length = 0;
  (globalThis as { __qalamMcpList?: unknown }).__qalamMcpList = undefined;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

/** A stand-in for Notion's API: who the secret is, one page, its blocks. */
const notion = (accept = true) =>
  vi.fn(async (url: string) => {
    if (!accept) return new Response("{}", { status: 401 });
    if (url.endsWith("/users/me")) return Response.json({ bot: { workspace_name: "Basket" } });
    if (url.endsWith("/search")) return Response.json({ results: [{ object: "page", id: "p1", url: "https://n/p1", properties: { Name: { type: "title", title: [{ plain_text: "Sara call" }] } } }] });
    if (url.includes("/blocks/p1/children")) return Response.json({ results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "Every Sunday I rebuild my basket." }] } }], has_more: false });
    return new Response("{}", { status: 404 });
  });

const card = async (id: string) => (await connectorsView()).connectors.find((c) => c.id === id)!;

describe("connectors on this computer", () => {
  it("keeps a token only when the service takes it, and says it's connected", async () => {
    await expect(saveToken("notion", "secret_bad_0000000000", notion(false) as unknown as typeof fetch)).rejects.toThrow(/didn't accept/);
    expect(await secrets().get("connector:notion")).toBeNull();
    expect(await saveToken("notion", "secret_good_000000abcd", notion() as unknown as typeof fetch)).toBe("Basket");
    expect(await card("notion")).toMatchObject({ via: "token", word: "Connected", tone: "ok", token: { last4: "abcd" } });
    await forgetConnector("notion");
    expect(await card("notion")).toMatchObject({ via: null, token: null });
  });

  it("says what Claude Code already has, and what comes next", async () => {
    (globalThis as { __qalamMcpList?: unknown }).__qalamMcpList = {
      at: Date.now(),
      list: [
        { name: "claude.ai Notion", target: "https://mcp.notion.com/mcp", status: "connected", claudeAi: true },
        { name: "plugin:posthog:posthog", target: "https://mcp.posthog.com/mcp", status: "needs-auth", claudeAi: false },
      ],
    };
    expect(await card("notion")).toMatchObject({ claudeCode: { server: "claude.ai Notion", status: "connected" }, word: "In Claude Code" });
    expect(await card("posthog")).toMatchObject({ word: "Sign in in Claude Code" });
    expect(await card("mixpanel")).toMatchObject({ word: "Coming next", claudeCode: null });
    expect(await card("github")).toMatchObject({ status: "public", word: "Public repositories" });
    expect(await card("linear")).toMatchObject({ status: "token", canToken: true, word: "Not connected" });
    expect(await card("posthog")).toMatchObject({ numbers: true });
  });

  it("takes in the picked pages with their words as Notion gave them, and skips what's already here", async () => {
    const f = notion();
    await saveToken("notion", "secret_good_000000abcd", f as unknown as typeof fetch);
    vi.stubGlobal("fetch", f);
    const store = { listSources: async () => [] } as unknown as OrgStore;
    const hit = { id: "p1", title: "Sara call", url: "https://n/p1" };
    const first = await importItems(store, "notion", [hit], () => {});
    expect(first).toEqual({ added: ["Sara call"], skipped: [], failed: [] });
    expect(captured).toEqual([{ kind: "connector", title: "Sara call", origin: "https://n/p1", text: "Every Sunday I rebuild my basket." }]);

    const again = { listSources: async () => [{ origin: "https://n/p1", text: "Every Sunday I rebuild my basket." }] } as unknown as OrgStore;
    expect(await importItems(again, "notion", [hit], () => {})).toEqual({ added: [], skipped: ["Sara call"], failed: [] });
    expect(captured).toHaveLength(1);
  });
});
