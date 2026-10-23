import { describe, expect, it } from "vitest";
import type { Doc } from "@/doc/schema";
import { useStudio } from "@/doc/store";
import { memoryRepo } from "./db";
import { chatProject, hashText, importLegacyChanges, legacyChanged, migrateLegacy, type LegacyIO, type Marker } from "./migrate";
import { isProjectId, newProject, projectHref, sortProjects, statusOf, type Project } from "./model";
import { currentProject, openProject, updateProject } from "./session";

const frame = (id: string) => ({ id, type: "frame", name: id, x: 0, y: 0, w: 390, h: 844, children: [], meta: {} });

function legacyDoc(roots = ["a", "b"]): Doc {
  const nodes = Object.fromEntries(roots.map((id) => [id, frame(id)]));
  return { nodes, roots } as unknown as Doc;
}

function io(raw: string | null): LegacyIO & { m: Marker | null; raw: string | null } {
  const o = {
    raw,
    m: null as Marker | null,
    readLegacyDoc: () => o.raw,
    marker: () => o.m,
    setMarker: (m: Marker) => void (o.m = m),
  };
  return o;
}

describe("migrating the pre-projects document", () => {
  it("turns it into exactly one Screens project with the same document", async () => {
    const raw = JSON.stringify(legacyDoc());
    const store = io(raw);
    const repo = memoryRepo();
    const p = await migrateLegacy(store, repo, 1000);
    expect(p).not.toBeNull();
    expect(p!.type).toBe("screens");
    expect(p!.legacy).toBe(true);
    expect(p!.name).toBe("My first project");
    expect(p!.summary).toEqual({ frames: 2 });
    expect(repo.projects.size).toBe(1);
    expect(JSON.stringify(repo.docs.get(p!.id))).toBe(raw);
    expect(store.m).toEqual({ projectId: p!.id, hash: hashText(raw) });
    // The old key is left as it was.
    expect(store.raw).toBe(raw);
  });

  it("runs once", async () => {
    const store = io(JSON.stringify(legacyDoc()));
    const repo = memoryRepo();
    await migrateLegacy(store, repo);
    expect(await migrateLegacy(store, repo)).toBeNull();
    expect(repo.projects.size).toBe(1);
  });

  it("moves nothing when there is no document, or an empty or broken one", async () => {
    for (const raw of [null, JSON.stringify(legacyDoc([])), "{not json", JSON.stringify({ hello: 1 })]) {
      const store = io(raw);
      const repo = memoryRepo();
      expect(await migrateLegacy(store, repo)).toBeNull();
      expect(repo.projects.size).toBe(0);
      expect(store.m?.projectId).toBeNull();
    }
  });

  it("notices when an older tab kept writing to the old document, and imports it once", async () => {
    const store = io(JSON.stringify(legacyDoc()));
    const repo = memoryRepo();
    const first = await migrateLegacy(store, repo);
    expect(legacyChanged(store)).toBe(false);
    store.raw = JSON.stringify(legacyDoc(["a", "b", "c"]));
    expect(legacyChanged(store)).toBe(true);
    const recovered = await importLegacyChanges(store, repo);
    expect(recovered?.summary).toEqual({ frames: 3 });
    expect(store.m?.projectId).toBe(first!.id);
    expect(legacyChanged(store)).toBe(false);
    expect(repo.projects.size).toBe(2);
  });

  it("gives chats saved before projects to the first project", () => {
    expect(chatProject({}, "legacy1")).toBe("legacy1");
    expect(chatProject({ projectId: "p2" }, "legacy1")).toBe("p2");
    expect(chatProject({}, null)).toBeNull();
  });
});

describe("project records", () => {
  it("describes each project's state", () => {
    const sys = newProject("system", "Lumen");
    expect(sys.interview?.stage).toBe("brief");
    expect(statusOf(sys)).toBe("Interview · Brief");
    expect(statusOf({ ...sys, interview: { v: 1, stage: "directions" } })).toBe("Interview · Directions");
    expect(statusOf({ ...sys, interview: { v: 1, stage: "saved" } })).toBe("Design system");
    const screens = newProject("screens", "Wallet");
    expect(screens.interview).toBeUndefined();
    expect(statusOf(screens)).toBe("Empty");
    expect(statusOf({ ...screens, summary: { frames: 1 } })).toBe("1 frame");
    expect(statusOf({ ...screens, summary: { frames: 12 } })).toBe("12 frames");
  });

  it("describes a Discovery board by its stage, then by what its tree holds", () => {
    const board = newProject("discovery", "Reorders");
    expect(board.discovery).toEqual({ v: 1, stage: "start" });
    expect(statusOf(board)).toBe("New");
    expect(statusOf({ ...board, discovery: { v: 1, stage: "interview" } })).toBe("Interview");
    expect(statusOf({ ...board, discovery: { v: 1, stage: "drafting" } })).toBe("Drafting");
    expect(statusOf({ ...board, discovery: { v: 1, stage: "ready" } })).toBe("Empty board");
    const counts = { opportunities: 6, solutions: 1, tests: 0, assumed: 2 };
    expect(statusOf({ ...board, discovery: { v: 1, stage: "ready", counts } })).toBe("6 opportunities · 1 solution");
    expect(projectHref(board)).toBe(`/d/${board.id}`);
  });

  it("routes and validates ids", () => {
    const p = newProject("system", "x");
    expect(isProjectId(p.id)).toBe(true);
    expect(isProjectId("../etc")).toBe(false);
    expect(projectHref(p)).toBe(`/s/${p.id}`);
    expect(projectHref({ id: "abcdef", type: "screens" })).toBe("/p/abcdef");
  });

  it("sorts by last opened, then last changed", () => {
    const at = (id: string, updatedAt: number, openedAt?: number) => ({ ...newProject("screens", id), id, updatedAt, openedAt }) as Project;
    expect(sortProjects([at("a", 1), at("b", 5), at("c", 2, 9)]).map((p) => p.id)).toEqual(["c", "b", "a"]);
  });
});

describe("opening a project", () => {
  it("loads its document with fresh history, and saves record changes", async () => {
    const repo = memoryRepo();
    const p = newProject("screens", "Wallet");
    await repo.put(p);
    await repo.putDoc(p.id, legacyDoc(["x"]));
    useStudio.setState({ past: [legacyDoc(["old"])] });
    const opened = await openProject(p.id, repo);
    expect(opened?.openedAt).toBeGreaterThan(0);
    expect(useStudio.getState().doc.roots).toEqual(["x"]);
    expect(useStudio.getState().past).toEqual([]);
    await updateProject({ name: "Wallet v2" });
    expect(currentProject()?.name).toBe("Wallet v2");
    expect(repo.projects.get(p.id)?.name).toBe("Wallet v2");
  });

  it("returns null for a project that isn't there", async () => {
    expect(await openProject("missing123", memoryRepo())).toBeNull();
  });
});
