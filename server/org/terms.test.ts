import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editTerms } from "@/terms/edit";
import { companyContext } from "./company";
import { OrgStore, TERMS, type OrgEvent } from "./store";

let dir: string;
let store: OrgStore;

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-terms-")), "Basket Co");
  store = await OrgStore.create(dir, { id: "org1", name: "Basket Co", createdAt: 1 });
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

let n = 0;
const o = () => ({ now: 5, id: () => `t${++n}` });

describe("the project's words in the organization's folder", () => {
  it("writes a term to hub/terms.md, announces it, and reads it back", async () => {
    const heard: OrgEvent[] = [];
    store.events.on("event", (e: OrgEvent) => heard.push(e));
    await store.changeTerms((t) => editTerms(t, { op: "add", term: "Basket", means: "The order being built before checkout", avoid: ["cart"] }, o()), { tab: "tab1" });
    const md = await readFile(path.join(dir, TERMS), "utf8");
    expect(md).toContain("- **Basket**: The order being built before checkout. Avoid: cart.");
    expect((await store.getTerms()).terms).toEqual([expect.objectContaining({ term: "Basket", by: "you" })]);
    expect(heard).toContainEqual({ kind: "terms", tab: "tab1" });
  });

  it("keeps a person's edit made in the file when the panel changes another term", async () => {
    await store.changeTerms((t) => editTerms(t, { op: "add", term: "Basket", means: "The order before checkout", by: "qalam" }, o()));
    const file = path.join(dir, TERMS);
    await writeFile(file, (await readFile(file, "utf8")).replace("before checkout", "before paying"));
    await store.changeTerms((t) => editTerms(t, { op: "add", term: "Rider", means: "Someone who delivers" }, o()));
    const t = await store.getTerms();
    expect(t.terms.map((x) => [x.term, x.means, x.by])).toEqual([
      ["Basket", "The order before paying.", "you"],
      ["Rider", "Someone who delivers.", "you"],
    ]);
  });

  it("is heard by what drafts read about the company", async () => {
    await store.changeTerms((t) => editTerms(t, { op: "add", term: "Basket", means: "The order before checkout", avoid: ["cart"] }, o()));
    expect(await companyContext(store)).toContain("- Basket: The order before checkout. Avoid: cart.");
  });
});
