import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Doc } from "@/doc/schema";
import type { SourceRecord } from "@/discovery/sources";
import type { Project } from "@/projects/model";
import { ConflictError, OrgStore, type OrgEvent } from "./store";

let dir: string;
let store: OrgStore;
let events: OrgEvent[];

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-org-")), "Personal");
  store = await OrgStore.create(dir, { id: "org1", name: "Personal", createdAt: 1 });
  events = [];
  store.events.on("event", (e: OrgEvent) => events.push(e));
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

const board: Project = { id: "b1abcdefgh", type: "discovery", name: "Reorders Q2", createdAt: 1, updatedAt: 1 };
const doc = (title: string) =>
  ({ roots: ["c1"], nodes: { c1: { id: "c1", type: "frame", name: title, x: 0, y: 0, w: 280, h: 120, meta: { ost: { kind: "outcome", title, evidence: [] } } } } }) as unknown as Doc;

describe("projects", () => {
  it("creates a readable file named after the project, with git ignoring local state", async () => {
    await store.putProject({ ...board, thumbnail: "data:x", openedAt: 9 });
    expect(await readdir(path.join(dir, "boards"))).toEqual(["reorders-q2.json"]);
    expect(await readFile(path.join(dir, ".gitignore"), "utf8")).toBe(".qalam/\nchats/\n");
    const file = JSON.parse(await readFile(path.join(dir, "boards", "reorders-q2.json"), "utf8"));
    expect(file.thumbnail).toBeUndefined();
    expect(store.listProjects()[0]).toMatchObject({ id: board.id, thumbnail: "data:x", openedAt: 9 });
    // Opened again from disk, local state included.
    const again = await OrgStore.open(dir);
    expect(again.getProject(board.id)?.record).toMatchObject({ name: "Reorders Q2", thumbnail: "data:x" });
  });

  it("saves the document, and refuses a save based on an older version", async () => {
    await store.putProject(board);
    const v1 = await store.putDoc(board.id, doc("More reorders"));
    expect((await store.getDoc(board.id))?.doc).toEqual(doc("More reorders"));
    const v2 = await store.putDoc(board.id, doc("Reorders weekly"), { ifMatch: v1 });
    await expect(store.putDoc(board.id, doc("Stale"), { ifMatch: v1 })).rejects.toBeInstanceOf(ConflictError);
    expect((await store.getDoc(board.id))?.version).toBe(v2);
    const file = JSON.parse(await readFile(path.join(dir, "boards", "reorders-q2.json"), "utf8"));
    expect(file.cards.c1.title).toBe("Reorders weekly");
  });

  it("patches fields without touching the document or other fields", async () => {
    await store.putProject({ ...board, handoff: undefined });
    await store.putDoc(board.id, doc("Keep me"));
    const { record } = await store.patchProject(board.id, { name: "Renamed", summary: { frames: 0 }, discovery: null });
    expect(record).toMatchObject({ name: "Renamed", summary: { frames: 0 } });
    expect((await store.getDoc(board.id))?.doc).toEqual(doc("Keep me"));
    // A patch with only local fields doesn't rewrite the project's file.
    const before = await readFile(path.join(dir, "boards", "reorders-q2.json"), "utf8");
    await store.patchProject(board.id, { openedAt: 123 });
    expect(await readFile(path.join(dir, "boards", "reorders-q2.json"), "utf8")).toBe(before);
    expect(store.getProject(board.id)?.record.openedAt).toBe(123);
  });

  it("saves a document and record fields in one write", async () => {
    await store.putProject(board);
    await store.putDoc(board.id, doc("x"), { patch: { updatedAt: 50, summary: { frames: 2 } } });
    expect(store.getProject(board.id)?.record).toMatchObject({ updatedAt: 50, summary: { frames: 2 } });
    expect(events.at(-1)).toMatchObject({ kind: "project", id: board.id, parts: ["record", "doc"] });
  });

  it("removes a project with its chats, layout and own sources", async () => {
    await store.putProject(board);
    await store.putChat({ id: "chat1", projectId: board.id });
    await store.putTrace({ id: "t1", projectId: board.id });
    await store.putLayout(board.id, { positions: {} });
    await store.putSource(source("s1abcdefgh", board.id));
    await store.putSource(source("s2abcdefgh", "other0000"));
    await store.removeProject(board.id);
    expect(store.listProjects()).toEqual([]);
    expect(await store.listChats()).toEqual([]);
    expect(await store.listTraces(board.id)).toEqual([]);
    expect(await store.getLayout(board.id)).toBeNull();
    expect((await store.listSources()).map((s) => s.id)).toEqual(["s2abcdefgh"]);
  });

  it("gives two projects with the same name their own files", async () => {
    await store.putProject(board);
    await store.putProject({ ...board, id: "b2abcdefgh" });
    expect((await readdir(path.join(dir, "boards"))).sort()).toEqual(["reorders-q2-2.json", "reorders-q2.json"]);
  });
});

const source = (id: string, board: string): SourceRecord => ({ v: 1, id, projectId: board, kind: "paste", title: "Call notes", text: "We waited 50 minutes.", addedAt: Date.UTC(2026, 9, 12), read: [], quotes: [], needs: [] });

describe("sources, images, systems", () => {
  it("lists a board's sources", async () => {
    await store.putSource(source("s1abcdefgh", board.id));
    await store.putSource(source("s2abcdefgh", "other0000"));
    expect((await store.listSources(board.id)).map((s) => s.id)).toEqual(["s1abcdefgh"]);
    expect((await readdir(path.join(dir, "sources"))).sort()).toEqual(["2026-10-12-call-notes-2.json", "2026-10-12-call-notes-2.md", "2026-10-12-call-notes.json", "2026-10-12-call-notes.md"]);
  });

  it("keeps an image once, by its content, and refuses one that doesn't match its name", async () => {
    const bytes = new TextEncoder().encode("png bytes");
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
    await store.putAsset(hash, bytes, "image/png");
    await store.putAsset(hash, bytes, "image/png");
    expect(await readdir(path.join(dir, "assets"))).toEqual([`${hash}.png`]);
    expect(store.getAsset(hash)?.type).toBe("image/png");
    await expect(store.putAsset("0".repeat(24), bytes, "image/png")).rejects.toThrow();
  });

  it("keeps design systems and naming memory beside each other", async () => {
    await store.putSystem({ id: "ds-abc", name: "Basket Green" });
    await store.putNaming([{ value: "#fff", final: "surface" }]);
    expect(await readdir(path.join(dir, "design-systems"))).toEqual(["basket-green.json", "naming.json"]);
    expect(await store.listSystems()).toEqual([{ id: "ds-abc", name: "Basket Green" }]);
    expect(await store.getNaming()).toEqual([{ value: "#fff", final: "surface" }]);
  });
});

describe("changes made outside Qalam", () => {
  it("ignores its own writes and picks up an edit, a new file and a deletion", async () => {
    await store.putProject(board);
    await store.putDoc(board.id, doc("Before"));
    events.length = 0;
    await store.reload("boards/reorders-q2.json");
    expect(events).toEqual([]);

    const file = path.join(dir, "boards", "reorders-q2.json");
    const edited = JSON.parse(await readFile(file, "utf8"));
    edited.cards.c1.title = "Edited in an editor";
    await writeFile(file, JSON.stringify(edited));
    await store.reload("boards/reorders-q2.json");
    expect(events).toEqual([{ kind: "project", id: board.id, parts: ["doc"] }]);
    expect(((await store.getDoc(board.id))?.doc?.nodes.c1 as unknown as { meta: { ost: { title: string } } }).meta.ost.title).toBe("Edited in an editor");

    await rm(file);
    await store.reload("boards/reorders-q2.json");
    expect(events.at(-1)).toEqual({ kind: "project", id: board.id, parts: ["record", "doc"], removed: true });
    expect(store.listProjects()).toEqual([]);
  });

  it("notices edits through the folder watcher", async () => {
    await store.putProject(board);
    store.watch();
    events.length = 0;
    const file = path.join(dir, "boards", "reorders-q2.json");
    const edited = JSON.parse(await readFile(file, "utf8"));
    edited.name = "Renamed in Finder";
    await new Promise((r) => setTimeout(r, 100));
    await writeFile(file, JSON.stringify(edited));
    for (let i = 0; i < 40 && !events.length; i++) await new Promise((r) => setTimeout(r, 50));
    expect(events[0]).toMatchObject({ kind: "project", id: board.id, parts: ["record"] });
    expect(store.getProject(board.id)?.record.name).toBe("Renamed in Finder");
  });
});
