import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Decision } from "@/decisions/model";
import type { Doc } from "@/doc/schema";
import type { Filing } from "@/hub/topics";
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

  it("removes a project with its chats and layout; its sources stay in the organization", async () => {
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
    expect((await store.listSources()).map((s) => [s.id, s.boards])).toEqual([
      ["s1abcdefgh", []],
      ["s2abcdefgh", ["other0000"]],
    ]);
    expect(await store.listSources(board.id)).toEqual([]);
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

describe("sources shared by boards", () => {
  it("puts a source on another board and takes it off, keeping it in the organization", async () => {
    await store.putSource(source("s1abcdefgh", board.id));
    await store.linkSource("s1abcdefgh", "b2abcdefgh", true);
    expect((await store.listSources("b2abcdefgh")).map((s) => s.id)).toEqual(["s1abcdefgh"]);
    expect((await store.getSource("s1abcdefgh"))?.boards).toEqual([board.id, "b2abcdefgh"]);
    await store.linkSource("s1abcdefgh", board.id, false);
    expect(await store.listSources(board.id)).toEqual([]);
    expect((await store.getSource("s1abcdefgh"))?.boards).toEqual(["b2abcdefgh"]);
    // Read again from disk: the boards are in the file.
    expect((await (await OrgStore.open(dir)).getSource("s1abcdefgh"))?.boards).toEqual(["b2abcdefgh"]);
  });

  it("keeps a source's boards when a change doesn't name them, and gives a new one its board's product", async () => {
    await store.putProject({ ...board, product: "pGrocery1" });
    await store.putSource(source("s1abcdefgh", board.id));
    expect((await store.getSource("s1abcdefgh"))?.product).toBe("pGrocery1");
    await store.linkSource("s1abcdefgh", "b2abcdefgh", true);
    const { boards: _b, product: _p, ...older } = (await store.getSource("s1abcdefgh"))!;
    await store.putSource({ ...older, title: "Renamed" });
    expect(await store.getSource("s1abcdefgh")).toMatchObject({ title: "Renamed", boards: [board.id, "b2abcdefgh"], product: "pGrocery1" });
  });
});

describe("products and the organization", () => {
  const grocery = { id: "pGrocery1", name: "Grocery app", audience: "Weekly shoppers.", goals: ["2M AED a month"], context: "", segments: [] };

  it("keeps products as Markdown files, and about.md", async () => {
    await store.putProduct(grocery);
    await store.putAbout({ audience: "Shoppers and riders.", goals: [], context: "Grocery delivery.", segments: [] });
    expect(await readdir(path.join(dir, "products"))).toEqual(["grocery-app.md"]);
    expect(await readFile(path.join(dir, "about.md"), "utf8")).toContain("## What we do\n\nGrocery delivery.");
    const again = await OrgStore.open(dir);
    expect(await again.listProducts()).toEqual([grocery]);
    expect((await again.getAbout()).audience).toBe("Shoppers and riders.");
  });

  it("deleting a product leaves its boards and sources to the whole organization", async () => {
    await store.putProduct(grocery);
    await store.putProject({ ...board, product: grocery.id });
    await store.putSource(source("s1abcdefgh", board.id));
    await store.removeProduct(grocery.id);
    expect(await store.listProducts()).toEqual([]);
    expect(store.getProject(board.id)?.record.product).toBeUndefined();
    expect((await store.getSource("s1abcdefgh"))?.product).toBeNull();
  });

  it("lists every board's outcomes, sub-outcomes with their parent", async () => {
    await store.putProject({ ...board, product: grocery.id });
    const nested = {
      roots: ["o1"],
      nodes: {
        o1: { id: "o1", type: "frame", name: "Reach 2M AED a month", parentId: null, meta: { ost: { kind: "outcome", title: "Reach 2M AED a month", evidence: [], metric: { name: "Orders", unit: "AED", current: 1.4, target: 2 } } } },
        o2: { id: "o2", type: "frame", name: "More weekly reorders", parentId: "o1", meta: { ost: { kind: "outcome", title: "More weekly reorders", evidence: [] } } },
        n1: { id: "n1", type: "frame", name: "Can't find past orders", parentId: "o2", meta: { ost: { kind: "opportunity", title: "Can't find past orders", evidence: [] } } },
      },
    } as unknown as Doc;
    await store.putDoc(board.id, nested);
    expect(await store.listGoals()).toEqual([
      { board: board.id, boardName: "Reorders Q2", product: grocery.id, id: "o1", title: "Reach 2M AED a month", metric: { name: "Orders", unit: "AED", current: 1.4, target: 2 }, parent: null },
      { board: board.id, boardName: "Reorders Q2", product: grocery.id, id: "o2", title: "More weekly reorders", parent: "o1" },
    ]);
  });

  it("renames the organization", async () => {
    await store.rename("  Basket  ");
    expect(store.info.name).toBe("Basket");
    expect(JSON.parse(await readFile(path.join(dir, "org.json"), "utf8")).name).toBe("Basket");
  });
});

describe("the decision log", () => {
  const at = new Date(2026, 9, 27, 15).getTime();
  const decision = (id: string, over: Partial<Decision> = {}): Decision => ({ id, at, kind: "stage", board: board.id, boardName: "Reorders Q2", card: "c1", cardTitle: "Saved baskets", what: "Dropped the solution “Saved baskets”", by: "you", big: true, ...over });

  it("adds decisions to their month's file, once, and lists them newest first", async () => {
    await store.appendDecisions([decision("d1"), decision("d2", { at: at + 1000, card: "c2" })]);
    await store.appendDecisions([decision("d1"), decision("d3", { at: new Date(2026, 10, 2).getTime(), board: "other12345" })]);
    expect((await readdir(path.join(dir, "decisions"))).sort()).toEqual(["2026-10.md", "2026-11.md"]);
    const oct = await readFile(path.join(dir, "decisions", "2026-10.md"), "utf8");
    expect(oct.match(/^## /gm)).toHaveLength(2);
    expect(oct).toContain("## 2026-10-27 · Dropped the solution “Saved baskets” · Reorders Q2");
    expect(await readFile(path.join(dir, ".gitattributes"), "utf8")).toBe("decisions/*.md merge=union\nhub/*.jsonl merge=union\n");
    expect(store.listDecisions().map((d) => d.id)).toEqual(["d3", "d2", "d1"]);
    expect(store.listDecisions({ board: board.id, card: "c1" }).map((d) => d.id)).toEqual(["d1"]);
    expect(events.filter((e) => e.kind === "decision")).toEqual([
      { kind: "decision", ids: ["d1", "d2"], boards: [board.id] },
      { kind: "decision", ids: ["d1", "d3"], boards: [board.id, "other12345"] },
    ]);
  });

  it("writes a why and marks one undone, rewriting only that entry", async () => {
    await store.appendDecisions([decision("d1"), decision("d2", { what: "Parked “Late slots”" })]);
    const file = path.join(dir, "decisions", "2026-10.md");
    const before = await readFile(file, "utf8");
    await store.updateDecision("d1", { why: "Folded into the shelf" });
    await store.updateDecision("d1", { undone: true });
    const after = await readFile(file, "utf8");
    expect(after).toContain("**Why:** Folded into the shelf");
    expect(after).toContain("“Saved baskets” (undone) · Reorders Q2");
    expect(after.slice(after.indexOf("## 2026-10-27 · Parked"))).toBe(before.slice(before.indexOf("## 2026-10-27 · Parked")));
    expect(store.listDecisions().find((d) => d.id === "d1")).toMatchObject({ why: "Folded into the shelf", undone: true });
    await expect(store.updateDecision("nope", { why: "x" })).rejects.toThrow();
  });

  it("reads a why written in the file by hand", async () => {
    await store.appendDecisions([decision("d1")]);
    const file = path.join(dir, "decisions", "2026-10.md");
    await writeFile(file, (await readFile(file, "utf8")).replace("**Why:** —", "**Why:** Nobody used it"));
    events.length = 0;
    await store.reload("decisions/2026-10.md");
    expect(events).toEqual([{ kind: "decision", ids: ["d1"], boards: [board.id] }]);
    expect(store.listDecisions()[0].why).toBe("Nobody used it");
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
    // The folder's own earlier writes can be reported late: wait for the board's.
    const edit = () => events.find((e) => e.kind === "project");
    for (let i = 0; i < 40 && !edit(); i++) await new Promise((r) => setTimeout(r, 50));
    expect(edit()).toMatchObject({ kind: "project", id: board.id, parts: ["record"] });
    expect(store.getProject(board.id)?.record.name).toBe("Renamed in Finder");
  });
});

describe("topic pages", () => {
  const quote = (id: string, text: string) => ({ id, text, span: [0, text.length] as [number, number], kind: "pain" as const, addedBy: "ai" as const, at: 1 });
  const filing = (): Filing => ({
    create: [{ key: "n1", kind: "need", title: "We wait too long for deliveries", products: [] }],
    add: [{ topic: "new:n1", section: "know", text: "Customers waited 50 minutes.", cites: ["hub:quote:q1"], from: ["Call notes"], products: [] }],
    revise: [],
    retire: [],
    dispute: [],
  });

  it("files Qalam AI's lines into a new page's file, and notes the quotes the pages have seen", async () => {
    await store.putSource({ ...source("s1abcdefgh", board.id), quotes: [quote("q1", "We waited 50 minutes.")] });
    events.length = 0;
    const r = await store.fileTopics(filing(), { from: "“Call notes”", filed: { s1abcdefgh: ["q1"] }, tab: "t1" });
    expect(r.counts.added).toBe(1);
    expect(await readdir(path.join(dir, "hub", "topics"))).toEqual(["we-wait-too-long-for-deliveries.md"]);
    const md = await readFile(path.join(dir, "hub", "topics", "we-wait-too-long-for-deliveries.md"), "utf8");
    expect(md).toContain("# We wait too long for deliveries\n\n## We know\n\n- Customers waited 50 minutes. *(Call notes)* <!-- qalam ");
    expect(md).toContain("· Qalam AI started this page from “Call notes”, with 1 line.");
    expect(events).toEqual(expect.arrayContaining([{ kind: "topic", id: r.created[0], tab: "t1" }, { kind: "source", id: "s1abcdefgh", boards: [board.id], tab: "t1" }]));
    expect((await store.getSource("s1abcdefgh"))?.filed).toEqual(["q1"]);
    // A board saving its copy of the source (from before) doesn't forget what was filed.
    await store.putSource({ ...source("s1abcdefgh", board.id), quotes: [quote("q1", "We waited 50 minutes.")] });
    expect((await store.getSource("s1abcdefgh"))?.filed).toEqual(["q1"]);
    const [page] = await store.listTopics();
    expect(page).toMatchObject({ id: r.created[0], title: "We wait too long for deliveries", file: "hub/topics/we-wait-too-long-for-deliveries.md" });
  });

  it("saves people's changes, unless the page changed since", async () => {
    const r = await store.fileTopics(filing(), { from: "“Call notes”" });
    const page = (await store.getTopic(r.created[0]))!;
    const v = await store.putTopic({ ...page, lines: [...page.lines, { id: "p1", section: "open", text: "Is it worse at night?", by: "person", cites: [], from: [], at: 2 }] }, { ifMatch: page.version });
    await expect(store.putTopic(page, { ifMatch: page.version })).rejects.toBeInstanceOf(ConflictError);
    const now = (await store.getTopic(page.id))!;
    expect(now.version).toBe(v);
    expect(now.lines.map((l) => [l.section, l.by, l.text])).toEqual([
      ["know", "qalam", "Customers waited 50 minutes."],
      ["open", "person", "Is it worse at night?"],
    ]);
    await store.removeTopic(page.id);
    expect(await store.listTopics()).toEqual([]);
  });

  it("picks up pages written or edited in the folder", async () => {
    const r = await store.fileTopics(filing(), { from: "“Call notes”" });
    const file = path.join(dir, "hub", "topics", "we-wait-too-long-for-deliveries.md");
    await writeFile(file, (await readFile(file, "utf8")).replace("Customers waited 50 minutes.", "Customers waited almost an hour."));
    events.length = 0;
    await store.reload("hub/topics/we-wait-too-long-for-deliveries.md");
    expect(events).toEqual([{ kind: "topic", id: r.created[0] }]);
    expect((await store.getTopic(r.created[0]))!.lines[0]).toMatchObject({ by: "person", text: "Customers waited almost an hour." });
    await writeFile(path.join(dir, "hub", "topics", "parents.md"), "# Parents of young children\n\n## We believe\n\n- They order on Sunday nights.\n");
    await store.reload("hub/topics/parents.md");
    const hand = (await store.listTopics()).find((t) => t.title === "Parents of young children");
    expect(hand?.lines).toMatchObject([{ section: "believe", by: "person", text: "They order on Sunday nights." }]);
    expect(events.at(-1)).toEqual({ kind: "topic", id: hand!.id });
  });
});

describe("needs a look", () => {
  it("keeps what was dismissed and what a review found, a line per change, merged by Git", async () => {
    const finding = { key: "review:x1", kind: "review" as const, title: "Evening slots", why: "Tickets say lateness.", at: 5, products: [] };
    await store.addFindings([finding]);
    await store.dismissNotice("stale-test:a", true);
    await store.dismissNotice("metric:b", true);
    await store.dismissNotice("metric:b", false);
    const s = await store.noticeState();
    expect([...s.dismissed.keys()]).toEqual(["stale-test:a"]);
    expect(s.found).toEqual([finding]);
    expect(s.reviewedAt).toBeGreaterThan(0);
    expect((await readFile(path.join(dir, "hub", "notices.jsonl"), "utf8")).trim().split("\n")).toHaveLength(5);
    expect(await readFile(path.join(dir, ".gitattributes"), "utf8")).toContain("hub/*.jsonl merge=union");
    expect(events.filter((e) => e.kind === "notice")).toHaveLength(4);
  });

  it("links two cards as the same need, and unlinks them", async () => {
    await store.linkCards("hub:card:b1:n1", "hub:card:b2:n8", true);
    expect(await store.listRelations()).toMatchObject([{ kind: "same-need", a: "hub:card:b1:n1", b: "hub:card:b2:n8", by: "you" }]);
    await store.linkCards("hub:card:b2:n8", "hub:card:b1:n1", false);
    expect(await store.listRelations()).toEqual([]);
  });

  it("remembers this computer's last visit, outside the shared folder", async () => {
    expect(await store.visit()).toBeNull();
    const first = store.lastVisit!;
    expect(await store.visit()).toBe(first);
    expect(JSON.parse(await readFile(path.join(dir, ".qalam", "local", "state.json"), "utf8")).visit).toBeGreaterThanOrEqual(first);
  });
});

describe("what waits on a board", () => {
  it("keeps each board's proposals in its own file, and a source's boards only change by linking", async () => {
    await store.putSource({ ...source("s9abcdefgh", ""), boards: [] });
    const p = { id: "p1", kind: "attach" as const, cardId: "n1", quote: { sourceId: "s9abcdefgh", quoteId: "q1" }, why: "fits" };
    await store.setPlacements("b1abcdefgh", "s9abcdefgh", [p]);
    expect(await store.placementsFor("b1abcdefgh")).toEqual({ s9abcdefgh: [p] });
    expect(await readdir(path.join(dir, "hub", "placements"))).toEqual(["b1abcdefgh.json"]);
    // Accepting links the source; a window then saving its older copy (no boards) doesn't undo that.
    await store.linkSource("s9abcdefgh", "b1abcdefgh", true);
    const stale = (await store.getSource("s9abcdefgh"))!;
    await store.putSource({ ...stale, boards: [] });
    expect((await store.getSource("s9abcdefgh"))!.boards).toEqual(["b1abcdefgh"]);
    await store.setPlacements("b1abcdefgh", "s9abcdefgh", []);
    expect(await store.listPlacements()).toEqual([]);
    expect(await readdir(path.join(dir, "hub", "placements"))).toEqual([]);
  });
});
