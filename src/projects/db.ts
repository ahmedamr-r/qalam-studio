import type { Doc } from "@/doc/schema";
import { orgFetch, orgGet, orgJson, orgWrite } from "@/org/client";
import type { Project } from "./model";

/**
 * Projects live in the organization's folder on disk (server/org): one file per project with its
 * record and document. The document's version is remembered when it loads, so a save made on top
 * of a change from another window, or from an edit on disk, is refused instead of overwriting it.
 */

export interface ProjectRepo {
  all(): Promise<Project[]>;
  get(id: string): Promise<Project | undefined>;
  /** Create a project, or replace its record (its document stays). */
  put(p: Project): Promise<void>;
  /** Change some of a project's fields; an undefined value removes the field. Never conflicts. */
  patch(id: string, fields: Partial<Project>): Promise<void>;
  remove(id: string): Promise<void>;
  getDoc(id: string): Promise<Doc | null>;
  /**
   * Save the document, and some record fields in the same write. Throws ConflictError when the
   * document changed elsewhere since it loaded here (`force` saves anyway).
   */
  putDoc(id: string, doc: Doc, fields?: Partial<Project>, opts?: { force?: boolean }): Promise<void>;
}

/** JSON has no undefined: a removed field travels as null. */
const asPatch = (fields: Partial<Project>) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === undefined ? null : v]));

/** The version of each document as it was last loaded or saved here. */
const docVersions = new Map<string, string>();

/** The version the document had when it was last loaded or saved here (what a save is based on). */
export const loadedDocVersion = (id: string) => docVersions.get(id) ?? null;

export const projectsDb: ProjectRepo = {
  all: () => orgJson<Project[]>("/projects"),
  get: async (id) => (await orgGet<Project>(`/projects/${id}`))?.value,
  put: async (p) => {
    await orgFetch(`/projects/${p.id}`, { method: "PUT", json: p });
  },
  patch: async (id, fields) => {
    await orgFetch(`/projects/${id}`, { method: "PATCH", json: asPatch(fields) });
  },
  remove: async (id) => {
    await orgFetch(`/projects/${id}`, { method: "DELETE" });
    docVersions.delete(id);
  },
  getDoc: async (id) => {
    const got = await orgGet<{ doc: Doc | null }>(`/projects/${id}/doc`);
    if (got?.version) docVersions.set(id, got.version);
    return got?.value.doc ?? null;
  },
  putDoc: async (id, doc, fields, opts = {}) => {
    const v = await orgWrite(`/projects/${id}/doc`, { method: "PUT", json: { doc, patch: fields ? asPatch(fields) : undefined }, ifMatch: opts.force ? null : (docVersions.get(id) ?? null) });
    if (v) docVersions.set(id, v);
  },
};

/** An in-memory repo, for tests. */
export function memoryRepo(): ProjectRepo & { projects: Map<string, Project>; docs: Map<string, Doc> } {
  const p = new Map<string, Project>();
  const d = new Map<string, Doc>();
  const merge = (id: string, fields: Partial<Project>) => {
    const cur = p.get(id);
    if (!cur) return;
    const next = { ...cur } as Record<string, unknown>;
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    p.set(id, next as unknown as Project);
  };
  return {
    projects: p,
    docs: d,
    all: async () => [...p.values()],
    get: async (id) => p.get(id),
    put: async (x) => void p.set(x.id, x),
    patch: async (id, fields) => merge(id, fields),
    remove: async (id) => {
      p.delete(id);
      d.delete(id);
    },
    getDoc: async (id) => d.get(id) ?? null,
    putDoc: async (id, doc, fields) => {
      d.set(id, doc);
      if (fields) merge(id, fields);
    },
  };
}
