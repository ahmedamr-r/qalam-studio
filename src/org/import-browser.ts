import type { Doc } from "@/doc/schema";
import { projectsDb } from "@/projects/db";
import { browserLegacyIO } from "@/projects/migrate";
import type { Project } from "@/projects/model";
import { openStores } from "@/ui/idb";
import { orgFetch, orgJson } from "./client";

/**
 * Projects saved in a browser before Qalam saved to disk, moved into the organization: their
 * documents, chats, AI traces, a board's sources, the images they use, and the browser's design
 * systems and naming memory. A browser keeps one copy per address, so this runs at the address
 * the projects were made at (the dev server or `npx qalam-studio import-browser` can serve it there).
 * Nothing in the browser is deleted, and what the organization already has is skipped, so it's
 * safe to run again.
 */

interface DocRecord {
  doc: Doc;
}

const projectsStore = () => openStores("qalam-projects", 1, ["projects", "docs"]);

/** Whether this browser has Qalam's old storage at all (without creating it by looking). */
async function hasOldStorage(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  if (typeof indexedDB.databases !== "function") return true;
  const dbs = await indexedDB.databases().catch(() => []);
  return dbs.some((d) => d.name === "qalam-projects");
}

/** Projects in this browser that the organization doesn't have yet. */
export async function browserProjectsToMove(): Promise<Project[]> {
  if (!(await hasOldStorage())) return [];
  const [old, have] = await Promise.all([projectsStore()("projects").getAll<Project>().catch(() => [] as Project[]), projectsDb.all().catch(() => [] as Project[])]);
  const ids = new Set(have.map((p) => p.id));
  return old.filter((p) => p && p.id && !ids.has(p.id));
}

export interface MoveResult {
  projects: number;
  images: number;
  systems: number;
}

/** Move this browser's projects (and what goes with them) into the organization. */
export async function moveBrowserProjects(onStep?: (label: string) => void): Promise<MoveResult> {
  const toMove = await browserProjectsToMove();
  const result: MoveResult = { projects: 0, images: 0, systems: 0 };
  const ids = new Set(toMove.map((p) => p.id));

  // Images first: documents point at them.
  onStep?.("Images");
  const blobs = openStores("qalam-assets", 1, ["blobs"])("blobs");
  const keys = await blobKeys();
  for (const key of keys) {
    const rec = await blobs.get<{ type: string; bytes: ArrayBuffer }>(key).catch(() => undefined);
    if (!rec) continue;
    try {
      await orgFetch(`/assets/${key}`, { method: "PUT", body: rec.bytes, headers: { "content-type": rec.type || "application/octet-stream" } });
      result.images++;
    } catch {
      // Not a Qalam image name: skip it.
    }
  }

  // Design systems and naming memory, unless the organization has them already.
  onStep?.("Design systems");
  try {
    const raw = window.localStorage.getItem("ds-studio/systems/v1");
    const systems = raw ? ((JSON.parse(raw) as { systems?: { id: string; source?: string }[] }).systems ?? []) : [];
    const have = new Set((await orgJson<{ id: string }[]>("/systems")).map((s) => s.id));
    for (const s of systems)
      if (s?.id && s.source !== "builtin" && !have.has(s.id)) {
        await orgFetch(`/systems/${s.id}`, { method: "PUT", json: s });
        result.systems++;
      }
    const naming = window.localStorage.getItem("ds-studio/naming-decisions/v1");
    if (naming && !(await orgJson<unknown[]>("/naming")).length) await orgFetch("/naming", { method: "PUT", json: JSON.parse(naming) });
  } catch {
    // Unreadable old settings: the projects still move.
  }

  // Projects with their documents, then what belongs to each.
  const docs = projectsStore()("docs");
  const sources = openStores("qalam-discovery", 1, ["sources", "snapshots"])("sources");
  const knowledge = openStores("qalam-knowledge", 1, ["traces", "layout"]);
  const chats = await openStores("qalam-chats", 1, ["chats"])("chats")
    .getAll<{ id: string; projectId?: string }>()
    .catch(() => []);
  const legacyId = browserLegacyIO.marker()?.projectId ?? null;
  for (const p of toMove) {
    onStep?.(p.name);
    await projectsDb.put(p);
    const doc = (await docs.get<DocRecord>(p.id).catch(() => undefined))?.doc;
    if (doc) await projectsDb.putDoc(p.id, doc, undefined, { force: true });
    for (const s of await sources.getPrefixed<{ id: string }>(`${p.id}:`).catch(() => [])) await orgFetch(`/sources/${s.id}`, { method: "PUT", json: s });
    for (const t of await knowledge("traces")
      .getPrefixed<{ id: string; projectId: string }>(`${p.id}:`)
      .catch(() => []))
      await orgFetch(`/traces/${p.id}/${t.id}`, { method: "PUT", json: t });
    const layout = await knowledge("layout")
      .get(p.id)
      .catch(() => undefined);
    if (layout) await orgFetch(`/layout/${p.id}`, { method: "PUT", json: layout });
    result.projects++;
  }
  // Chats go with their project; ones from before projects belong to the first project.
  for (const c of chats) {
    const projectId = c.projectId ?? legacyId ?? undefined;
    if (projectId && ids.has(projectId)) await orgFetch(`/chats/${c.id}`, { method: "PUT", json: { ...c, projectId } });
  }
  return result;
}

/** The keys of the old image store. */
function blobKeys(): Promise<string[]> {
  return new Promise((resolve) => {
    const req = indexedDB.open("qalam-assets", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("blobs")) req.result.createObjectStore("blobs");
    };
    req.onerror = () => resolve([]);
    req.onsuccess = () => {
      const keys = req.result.transaction("blobs", "readonly").objectStore("blobs").getAllKeys();
      keys.onsuccess = () => resolve((keys.result as IDBValidKey[]).map(String));
      keys.onerror = () => resolve([]);
    };
  });
}
