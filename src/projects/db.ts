import type { Doc } from "@/doc/schema";
import { openStores } from "@/ui/idb";
import type { Project } from "./model";

/**
 * Projects live in IndexedDB: the records in "projects", each canvas document in "docs" under
 * its project id. (The single document before projects was in localStorage; see migrate.ts.)
 */

interface DocRecord {
  v: 1;
  doc: Doc;
  savedAt: number;
}

const open = openStores("qalam-projects", 1, ["projects", "docs"]);
const projects = open("projects");
const docs = open("docs");

export interface ProjectRepo {
  all(): Promise<Project[]>;
  get(id: string): Promise<Project | undefined>;
  put(p: Project): Promise<void>;
  remove(id: string): Promise<void>;
  getDoc(id: string): Promise<Doc | null>;
  putDoc(id: string, doc: Doc): Promise<void>;
}

export const projectsDb: ProjectRepo = {
  all: () => projects.getAll<Project>(),
  get: (id) => projects.get<Project>(id),
  put: (p) => projects.put(p.id, p),
  remove: async (id) => {
    await docs.remove(id);
    await projects.remove(id);
  },
  getDoc: async (id) => (await docs.get<DocRecord>(id))?.doc ?? null,
  putDoc: (id, doc) => docs.put(id, { v: 1, doc, savedAt: Date.now() } satisfies DocRecord),
};

/** An in-memory repo, for tests. */
export function memoryRepo(): ProjectRepo & { projects: Map<string, Project>; docs: Map<string, Doc> } {
  const p = new Map<string, Project>();
  const d = new Map<string, Doc>();
  return {
    projects: p,
    docs: d,
    all: async () => [...p.values()],
    get: async (id) => p.get(id),
    put: async (x) => void p.set(x.id, x),
    remove: async (id) => {
      p.delete(id);
      d.delete(id);
    },
    getDoc: async (id) => d.get(id) ?? null,
    putDoc: async (id, doc) => void d.set(id, doc),
  };
}
