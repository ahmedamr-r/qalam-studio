import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editBusiness, noteLines } from "@/business/edit";
import { businessFor, companyContext, researchAbout } from "./company";
import { BUSINESS, OrgStore, type OrgEvent } from "./store";

let dir: string;
let store: OrgStore;

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-business-")), "Talabeya");
  store = await OrgStore.create(dir, { id: "org1", name: "Talabeya", createdAt: 1 });
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

let n = 0;
const o = () => ({ now: 5, id: () => `b${++n}` });
const from = [{ flow: "consult", key: "turn1", q: "q1" }];

describe("how the business works, in the organization's folder", () => {
  it("writes a line to business.md at the root, announces it, and reads it back", async () => {
    const heard: OrgEvent[] = [];
    store.events.on("event", (e: OrgEvent) => heard.push(e));
    await store.changeBusiness((b) => editBusiness(b, { op: "add", section: "earns", text: "A cut from each shop and the delivery fee" }, o()), { tab: "tab1" });
    const md = await readFile(path.join(dir, BUSINESS), "utf8");
    expect(BUSINESS).toBe("business.md");
    expect(md).toContain("# How Talabeya works");
    expect(md).toContain("- A cut from each shop and the delivery fee <!-- qalam ");
    expect((await store.getBusiness()).lines).toEqual([expect.objectContaining({ section: "earns", by: "you" })]);
    expect(heard).toContainEqual({ kind: "business", tab: "tab1" });
  });

  it("touches nothing, and announces nothing, when a note is there already", async () => {
    const note = { section: "serves" as const, text: "Families in Nasr City", by: "said" as const, from };
    await store.changeBusiness((b) => noteLines(b, [note], o()).business);
    const heard: OrgEvent[] = [];
    store.events.on("event", (e: OrgEvent) => heard.push(e));
    await store.changeBusiness((b) => noteLines(b, [note], o()).business);
    expect(heard).toEqual([]);
  });

  it("keeps a person's edit made in the file when a line is noted elsewhere", async () => {
    await store.changeBusiness((b) => noteLines(b, [{ section: "numbers", text: "About 300 orders a day", by: "qalam", from }], o()).business);
    const file = path.join(dir, BUSINESS);
    await writeFile(file, (await readFile(file, "utf8")).replace("About 300", "About 280"));
    await store.changeBusiness((b) => noteLines(b, [{ section: "serves", text: "Families in Nasr City", by: "said", from }], o()).business);
    const b = await store.getBusiness();
    expect(b.lines.map((l) => [l.section, l.text, l.by])).toEqual([
      ["serves", "Families in Nasr City", "said"],
      ["numbers", "About 280 orders a day", "you"],
    ]);
  });

  it("is heard by what drafts read about the company, and by a web search only without its figures", async () => {
    await store.changeBusiness((b) => editBusiness(b, { op: "add", section: "earns", text: "A cut from each shop and the delivery fee" }, o()));
    await store.changeBusiness((b) => editBusiness(b, { op: "add", section: "numbers", text: "About 300 orders a day" }, o()));
    await store.changeBusiness((b) => editBusiness(b, { op: "add", section: "costs", text: "Riders are most of it" }, o()));
    const company = await companyContext(store);
    expect(company).toContain("How Talabeya works, as the team tells it");
    expect(company).toContain("- How it earns: A cut from each shop and the delivery fee");
    const search = await researchAbout(store, "A grocery delivery app.");
    expect(search).toContain("A grocery delivery app.");
    expect(search).toContain("How it earns: A cut from each shop and the delivery fee");
    expect(search).not.toMatch(/300|Riders/);
    expect(await businessFor(store, { for: "call", max: 2000 })).toContain("About 300 orders a day");
  });
});
