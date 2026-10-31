import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "@/connectors/recipes";
import { resetSecrets } from "../secrets";
import { writeSettings } from "../settings";

// Claude Code's Notion server, answering each planned call from a table.
const runs: ToolCall[][] = [];
const answers = new Map<string, string | null>();
vi.mock("./claude-code", () => ({
  claudeCodeKnown: () => null,
  listClaudeCode: async () => [],
  runTools: async (_server: string, calls: ToolCall[]) => {
    runs.push(calls);
    return calls.map((c) => answers.get(`${c.tool} ${JSON.stringify(c.args)}`) ?? null);
  },
}));

const { browseConnector, readItems } = await import("./index");

const page = (id: string, title: string) => ({ id, title, url: `https://www.notion.so/${id}` });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-browse-"));
  process.env.QALAM_HOME = dir;
  process.env.QALAM_SECRETS = "memory";
  resetSecrets();
  runs.length = 0;
  answers.clear();
  (globalThis as { __qalamBrowse?: unknown }).__qalamBrowse = undefined;
  await writeSettings({ connectors: { notion: { via: "claude-code", server: "claude.ai Notion" }, drive: { via: "claude-code", server: "claude.ai Google Drive" } } });
  answers.set(`notion-search ${JSON.stringify({ query: "meal plans" })}`, JSON.stringify({ results: [page("n1", "Meal plans"), page("n2", "Interview notes")] }));
  answers.set(`notion-fetch ${JSON.stringify({ id: "n2" })}`, JSON.stringify({ text: "Families plan meals on Sunday." }));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("browsing a connector for the chat box", () => {
  it("shows a search as the tool answered", async () => {
    expect((await browseConnector("notion", { query: "meal plans" })).map((h) => h.title)).toEqual(["Meal plans", "Interview notes"]);
    expect(runs.map((r) => r[0].tool)).toEqual(["notion-search"]);
  });

  it("keeps each answer five minutes, so going back doesn't run Claude Code again", async () => {
    await browseConnector("notion", { query: "meal plans" }, { now: 1_000 });
    await browseConnector("notion", { query: "meal plans" }, { now: 1_000 + 4 * 60_000 });
    expect(runs).toHaveLength(1);
    await browseConnector("notion", { query: "meal plans" }, { now: 1_000 + 4 * 60_000, force: true });
    await browseConnector("notion", { query: "meal plans" }, { now: 1_000 + 10 * 60_000 });
    expect(runs).toHaveLength(3);
  });

  it("says so when Claude Code didn't answer", async () => {
    await expect(browseConnector("notion", { query: "nothing like it" })).rejects.toThrow(/Claude Code didn't search it/);
  });

  it("reads the picked items' words without taking them in, and says which gave nothing", async () => {
    const items = await readItems("notion", [{ id: "n2", title: "Interview notes", url: "https://www.notion.so/n2" }, { id: "n9", title: "Gone" }], () => {});
    expect(items).toEqual([
      { id: "n2", title: "Interview notes", ingested: { kind: "connector", title: "Interview notes", origin: "https://www.notion.so/n2", text: "Families plan meals on Sunday." } },
      { id: "n9", title: "Gone", why: "Nothing came back for it." },
    ]);
    // One run reads them all.
    expect(runs).toHaveLength(1);
  });

  it("never reaches Drive through Claude Code, even when a choice from before says to", async () => {
    await expect(browseConnector("drive", {})).rejects.toThrow(/Sign in with Google first/);
    await expect(readItems("drive", [{ id: "d1", title: "Pitch" }], () => {})).rejects.toThrow(/Sign in with Google first/);
    expect(runs).toHaveLength(0);
  });

  it("needs the connector connected first", async () => {
    await expect(browseConnector("confluence", {})).rejects.toThrow(/Connect it first/);
  });
});
