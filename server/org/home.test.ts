import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOrg, currentOrg, listOrgs, onStoreOpen, openFolder, openLastOrg, rememberOrg, storeFor } from "./home";
import { OrgStore } from "./store";

let base: string;
let home: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "qalam-home-"));
  home = path.join(base, "Qalam");
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("organizations", () => {
  it("has none the first time (the welcome names it), and opens the one opened last", async () => {
    expect(await currentOrg(home)).toBeNull();
    expect((await readdir(home).catch(() => [])).filter((n) => !n.startsWith("."))).toEqual([]);
    const first = (await currentOrg(home, { create: true }))!;
    expect(first.name).toBe("Personal");
    expect((await readdir(home)).filter((n) => !n.startsWith("."))).toEqual(["Personal"]);
    const basket = await createOrg("Basket", home);
    expect((await currentOrg(home))!.id).toBe(first.id);
    await rememberOrg(basket.id, home);
    expect((await currentOrg(home))!.id).toBe(basket.id);
    expect((await listOrgs(home)).map((o) => o.name)).toEqual(["Basket", "Personal"]);
  });

  it("names folders after organizations, in any script, without clashing", async () => {
    await createOrg("Basket", home);
    await createOrg("Basket", home);
    await createOrg("سلة / Basket?", home);
    expect((await readdir(home)).filter((n) => !n.startsWith(".")).sort()).toEqual(["Basket", "Basket 2", "سلة Basket"].sort());
  });

  it("keeps who it's for in org.json, so it travels with the folder; one from before says nothing", async () => {
    const solo = await createOrg("Meal planner", home, "solo");
    const team = await createOrg("Basket", home);
    expect(solo.shape).toBe("solo");
    expect(JSON.parse(await readFile(path.join(solo.dir, "org.json"), "utf8"))).toMatchObject({ name: "Meal planner", shape: "solo" });
    expect((await listOrgs(home)).map((o) => [o.name, o.shape ?? null])).toEqual([
      ["Basket", null],
      ["Meal planner", "solo"],
    ]);
    // Turning it into a team is one switch, and every goal stops being theirs by default.
    const store = (await storeFor(solo.id))!;
    expect(store.firstRun.picked).toBe(true);
    await store.setShape("team");
    expect(JSON.parse(await readFile(path.join(solo.dir, "org.json"), "utf8")).shape).toBe("team");
    expect(store.firstRun.picked).toBe(false);
    expect((await storeFor(team.id))!.info.shape).toBeUndefined();
  });

  it("opens any folder as an organization, keeping its files, and lists it after", async () => {
    const repo = path.join(base, "projects", "basket-research");
    await mkdir(repo, { recursive: true });
    const org = await openFolder(repo, home);
    expect(org).toMatchObject({ name: "basket-research", dir: repo });
    expect(JSON.parse(await readFile(path.join(repo, "org.json"), "utf8")).id).toBe(org.id);
    expect((await listOrgs(home)).map((o) => o.id)).toContain(org.id);
    // Opening it again finds the same organization.
    expect((await openFolder(repo, home)).id).toBe(org.id);
  });

  it("adds to a folder's .gitignore instead of replacing it", async () => {
    const repo = path.join(base, "repo");
    await mkdir(repo, { recursive: true });
    await writeFile(path.join(repo, ".gitignore"), "node_modules\ndist");
    await openFolder(repo, home);
    expect(await readFile(path.join(repo, ".gitignore"), "utf8")).toBe("node_modules\ndist\n.qalam/\nchats/\n");
    // Opening it again changes nothing.
    await openFolder(repo, home);
    expect(await readFile(path.join(repo, ".gitignore"), "utf8")).toBe("node_modules\ndist\n.qalam/\nchats/\n");
  });

  it("opens one store per organization, however many ask at once", async () => {
    const was = process.env.QALAM_HOME;
    process.env.QALAM_HOME = home;
    try {
      // Organizations on disk that this Qalam hasn't opened yet.
      for (const [id, name] of [["personal", "Personal"], ["basket", "Basket"]]) (await OrgStore.create(path.join(home, name), { id, name, createdAt: 1 })).dispose();
      await rememberOrg("basket", home);
      const seen: OrgStore[] = [];
      onStoreOpen((s) => seen.push(s));
      // Qalam starting (it opens the organization opened last) and a window's first requests, together.
      const [last, a, b] = await Promise.all([openLastOrg(), storeFor("basket"), storeFor("basket")]);
      expect(a?.dir).toBe(path.join(home, "Basket"));
      expect(b).toBe(a);
      expect(last).toBe(a);
      expect(seen).toEqual([a]);
      expect(await storeFor("no-such-org")).toBeNull();
      a!.dispose();
    } finally {
      process.env.QALAM_HOME = was;
    }
  });

  it("refuses folders that can't be an organization", async () => {
    await expect(openFolder("/", home)).rejects.toThrow();
    await expect(openFolder("/System/Library", home)).rejects.toThrow("system folder");
    await expect(openFolder(path.join(base, "missing"), home)).rejects.toThrow("doesn't exist");
    await expect(openFolder(home, home)).rejects.toThrow();
  });
});
