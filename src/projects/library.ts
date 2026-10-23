import { useSystems } from "@/design-system/registry";
import * as chatDb from "@/ui/ai/chatDb";
import { clearDiscoveryData } from "@/discovery/db";
import { clearKnowledgeData } from "@/knowledge/db";
import { projectsDb } from "./db";
import { browserLegacyIO, chatProject, ensureMigrated, importLegacyChanges, legacyChanged, legacyProjectId } from "./migrate";
import { sortProjects, type Project } from "./model";

/** What the home does with projects (the open project's own changes go through session.ts). */

export async function listProjects(): Promise<Project[]> {
  await ensureMigrated();
  return sortProjects(await projectsDb.all());
}

export async function renameProjectById(id: string, name: string) {
  const p = await projectsDb.get(id);
  const n = name.trim().replace(/\s+/g, " ").slice(0, 80);
  if (p && n) await projectsDb.put({ ...p, name: n, updatedAt: Date.now() });
}

/** Remove a project, its document and its chats (a board's sources too); optionally the system it saved. Images stay (shared by hash). */
export async function deleteProject(p: Project, opts: { removeSystem?: boolean } = {}) {
  const legacy = legacyProjectId();
  const chats = await chatDb.loadAll<{ id: string; projectId?: string }>().catch(() => []);
  await Promise.all(chats.filter((c) => chatProject(c, legacy) === p.id).map((c) => chatDb.remove(c.id).catch(() => {})));
  if (p.type === "discovery") await clearDiscoveryData(p.id).catch(() => {});
  await clearKnowledgeData(p.id).catch(() => {});
  await projectsDb.remove(p.id);
  if (opts.removeSystem && p.systemId) useSystems.getState().remove(p.systemId);
  // Looks picked for its screens go with them, unless the designer saved one as a design system.
  for (const s of useSystems.getState().systems) if (s.source === "freeform" && !s.kept && s.projectId === p.id) useSystems.getState().remove(s.id);
}

/** An older tab saved to the pre-projects document after it was moved. */
export const hasLegacyChanges = () => legacyChanged(browserLegacyIO);
export const importLegacy = () => importLegacyChanges(browserLegacyIO, projectsDb);
