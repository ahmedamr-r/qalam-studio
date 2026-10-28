import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrgStore } from "./org/store";
import { captureName, captureText, quickCapture } from "./quick";

let dir: string;
const store = () => ({ dir }) as unknown as OrgStore;
const at = new Date(2026, 9, 28, 9, 5);

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-quick-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("quick capture", () => {
  it("names the file by when, then its first words, safe for any folder", () => {
    expect(captureName({ kind: "note", text: "Parents want a fee breakdown: before checkout / not after" }, at)).toBe("2026-10-28 0905 Parents want a fee breakdown before checkout not");
    expect(captureName({ kind: "link", text: "", url: "https://example.com/post" }, at)).toBe("2026-10-28 0905 example.com");
  });

  it("writes a quote as a quote, with who said it", () => {
    expect(captureText({ kind: "quote", text: "Every Sunday I rebuild it.\nIt's the same list.", speaker: "Sara" })).toBe("> Every Sunday I rebuild it.\n> It's the same list.\n\n— Sara\n");
    expect(captureText({ kind: "note", text: "Fees again" })).toBe("Fees again\n");
  });

  it("drops it into the inbox folder, never over another file", async () => {
    const a = await quickCapture(store(), { kind: "note", text: "Fees again" }, at);
    const b = await quickCapture(store(), { kind: "note", text: "Fees again" }, at);
    expect([a.file, b.file]).toEqual(["2026-10-28 0905 Fees again.md", "2026-10-28 0905 Fees again 2.md"]);
    expect((await readdir(path.join(dir, "inbox"))).sort()).toEqual([a.file, b.file].sort());
    expect(await readFile(path.join(dir, "inbox", a.file), "utf8")).toBe("Fees again\n");
  });

  it("keeps a link it can't read from here as the link and the words", async () => {
    const r = await quickCapture(store(), { kind: "link", text: "Their pricing page", url: "http://127.0.0.1:9/private" }, at);
    expect(r.file.endsWith(".md")).toBe(true);
    expect(await readFile(path.join(dir, "inbox", r.file), "utf8")).toBe("http://127.0.0.1:9/private\n\nTheir pricing page\n");
  });
});
