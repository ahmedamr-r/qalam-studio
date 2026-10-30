import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "@/connectors/recipes";
import { resetSecrets } from "../secrets";
import { writeSettings } from "../settings";

// Claude Code's Drive server, answering each planned call from a table.
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

const file = (id: string, title: string, mimeType: string) => ({ id, title, mimeType, viewUrl: `https://drive.google.com/file/d/${id}/view` });
const LIST = { pageSize: 50, excludeContentSnippets: true };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-browse-"));
  process.env.QALAM_HOME = dir;
  process.env.QALAM_SECRETS = "memory";
  resetSecrets();
  runs.length = 0;
  answers.clear();
  (globalThis as { __qalamBrowse?: unknown }).__qalamBrowse = undefined;
  await writeSettings({ connectors: { drive: { via: "claude-code", server: "claude.ai Google Drive" } } });
  answers.set(`list_recent_files ${JSON.stringify({ pageSize: 25, excludeContentSnippets: true })}`, JSON.stringify({ files: [file("d1", "Pitch deck.pdf", "application/pdf")] }));
  answers.set(`search_files ${JSON.stringify({ query: "parentId = 'root'", ...LIST })}`, JSON.stringify({ files: [file("f1", "Research", "application/vnd.google-apps.folder"), file("d2", "Notes", "application/vnd.google-apps.document")] }));
  answers.set(`search_files ${JSON.stringify({ query: "fullText contains 'meal' and fullText contains 'plans'", ...LIST })}`, JSON.stringify({ files: [file("d3", "Meal plans", "application/vnd.google-apps.document")] }));
  answers.set(`read_file_content ${JSON.stringify({ fileId: "d2" })}`, JSON.stringify({ fileContent: "Families plan meals on Sunday.", title: "Notes" }));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("browsing a connector for the chat box", () => {
  it("shows what was opened lately, a folder's items or a search, as Drive answered", async () => {
    expect((await browseConnector("drive", {})).map((h) => h.title)).toEqual(["Pitch deck.pdf"]);
    expect(await browseConnector("drive", { folder: null })).toMatchObject([{ id: "f1", folder: true }, { id: "d2", type: "doc" }]);
    expect((await browseConnector("drive", { query: "meal plans" })).map((h) => h.id)).toEqual(["d3"]);
    expect(runs.map((r) => r[0].tool)).toEqual(["list_recent_files", "search_files", "search_files"]);
  });

  it("keeps each answer five minutes, so going back doesn't run Claude Code again", async () => {
    await browseConnector("drive", { folder: null }, { now: 1_000 });
    await browseConnector("drive", { folder: null }, { now: 1_000 + 4 * 60_000 });
    expect(runs).toHaveLength(1);
    await browseConnector("drive", { folder: null }, { now: 1_000 + 4 * 60_000, force: true });
    await browseConnector("drive", { folder: null }, { now: 1_000 + 10 * 60_000 });
    expect(runs).toHaveLength(3);
  });

  it("says so when Claude Code didn't answer", async () => {
    await expect(browseConnector("drive", { folder: "f1" })).rejects.toThrow(/Claude Code didn't answer/);
  });

  it("reads the picked files' words without taking them in, and says which gave nothing", async () => {
    const items = await readItems("drive", [{ id: "d2", title: "Notes", url: "https://drive.google.com/file/d/d2/view" }, { id: "d9", title: "Gone" }], () => {});
    expect(items).toEqual([
      { id: "d2", title: "Notes", ingested: { kind: "connector", title: "Notes", origin: "https://drive.google.com/file/d/d2/view", text: "Families plan meals on Sunday." } },
      { id: "d9", title: "Gone", why: "Nothing came back for it." },
    ]);
    // One run reads them all.
    expect(runs).toHaveLength(1);
  });

  it("needs the connector connected first", async () => {
    await expect(browseConnector("confluence", {})).rejects.toThrow(/Connect it first/);
  });
});
