import { useSystems } from "@/design-system/registry";
import { projectsDb } from "./db";
import { browserLegacyIO, ensureMigrated, importLegacyChanges, legacyChanged } from "./migrate";
import { sortProjects, type Project } from "./model";

/** What the home does with projects (the open project's own changes go through session.ts). */

export async function listProjects(): Promise<Project[]> {
  await ensureMigrated();
  return sortProjects(await projectsDb.all());
}

export async function renameProjectById(id: string, name: string) {
  const n = name.trim().replace(/\s+/g, " ").slice(0, 80);
  if (n) await projectsDb.patch(id, { name: n, updatedAt: Date.now() });
}

/**
 * Remove a project. The organization's folder drops its file with its chats, AI traces and a
 * board's own sources; optionally the system it saved goes too. Images stay (shared by hash).
 */
export async function deleteProject(p: Project, opts: { removeSystem?: boolean } = {}) {
  await projectsDb.remove(p.id);
  if (opts.removeSystem && p.systemId) useSystems.getState().remove(p.systemId);
  // Looks picked for its screens go with them, unless the designer saved one as a design system.
  for (const s of useSystems.getState().systems) if (s.source === "freeform" && !s.kept && s.projectId === p.id) useSystems.getState().remove(s.id);
}

/** An older tab saved to the pre-projects document after it was moved. */
export const hasLegacyChanges = () => legacyChanged(browserLegacyIO);
export const importLegacy = () => importLegacyChanges(browserLegacyIO, projectsDb);
