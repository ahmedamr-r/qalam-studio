import { create } from "zustand";
import { moveInlineImages, useStudio } from "@/doc/store";
import { emptyDoc, type Doc } from "@/doc/schema";
import { forStorage } from "@/doc/pages";
import { projectsDb, type ProjectRepo } from "./db";
import { frameCount } from "./migrate";
import { newProject, projectHref, type Project, type ProjectType } from "./model";

/**
 * The project open in this page. Opening another project is a full page load, so everything
 * module-level (the document, its undo history, chats, running AI work) belongs to one project.
 */

export const useProject = create<{ project: Project | null }>(() => ({ project: null }));
export const currentProject = () => useProject.getState().project;

let repo: ProjectRepo = projectsDb;

/** Load a project and its document into the studio. Null when there is no such project. */
export async function openProject(id: string, r: ProjectRepo = projectsDb): Promise<Project | null> {
  repo = r;
  const p = await r.get(id);
  if (!p) return null;
  const doc = (await r.getDoc(id)) ?? emptyDoc();
  const opened: Project = { ...p, openedAt: Date.now() };
  useProject.setState({ project: opened });
  useStudio.getState().openDoc(doc);
  moveInlineImages();
  await r.put(opened);
  return opened;
}

/** Change the open project's record (name, system, thumbnail…) and save it. */
export async function updateProject(patch: Partial<Project> | ((p: Project) => Partial<Project>), opts: { touch?: boolean } = {}) {
  const p = currentProject();
  if (!p) return;
  const next: Project = { ...p, ...(typeof patch === "function" ? patch(p) : patch), ...(opts.touch === false ? {} : { updatedAt: Date.now() }) };
  useProject.setState({ project: next });
  await repo.put(next).catch(() => {});
}

export const renameProject = (name: string) => {
  const n = name.trim().replace(/\s+/g, " ").slice(0, 80);
  if (n) void updateProject({ name: n });
};

// ---------------------------------------------------------------------------
// Saving the document

let flushSaving: (() => Promise<void>) | null = null;
let stopActive: (() => void) | null = null;

/**
 * Save the open project's document 400ms after edits settle (never mid-gesture), and right away
 * when the tab is hidden or closed. `onSaved` runs after each save (thumbnails).
 */
export function startDocPersistence(onSaved?: (doc: Doc) => void) {
  // Started again (React's dev double effects): one subscriber at a time.
  stopActive?.();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = useStudio.getState().doc;
  let pending = false;
  const flush = async () => {
    clearTimeout(timer);
    const p = currentProject();
    if (!pending || !p) return;
    pending = false;
    const doc = useStudio.getState().doc;
    onSaved?.(doc);
    // The Components page is drawn from the design system: what's saved is the page it was opened from.
    await Promise.all([repo.putDoc(p.id, forStorage(doc)).catch(() => {}), updateProject({ summary: { frames: frameCount(doc) } })]);
  };
  const unsub = useStudio.subscribe((s) => {
    if (s.doc === last || s.txBase) return;
    last = s.doc;
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), 400);
  });
  const onHide = () => {
    if (document.visibilityState === "hidden") void flush();
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onHide);
  flushSaving = flush;
  const stop = () => {
    void flush();
    unsub();
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onHide);
    if (flushSaving === flush) flushSaving = null;
    if (stopActive === stop) stopActive = null;
  };
  stopActive = stop;
  return stop;
}

/** Finish any pending save (before leaving the page). */
export const flushDoc = () => flushSaving?.() ?? Promise.resolve();

// ---------------------------------------------------------------------------
// Creating and leaving projects (navigation is a full page load: see the note at the top)

export async function createProject(type: ProjectType, name: string, extra: Partial<Project> = {}, doc?: Doc): Promise<Project> {
  const p = newProject(type, name, extra);
  if (doc) await projectsDb.putDoc(p.id, doc);
  await projectsDb.put(doc ? { ...p, summary: { frames: frameCount(doc) } } : p);
  return p;
}

export async function goToProject(p: Pick<Project, "id" | "type">) {
  await flushDoc();
  window.location.assign(projectHref(p));
}

/** Back into a saved system's brand interview (saving there again updates the same system). */
export async function reopenInterview() {
  const p = currentProject();
  if (!p?.interview) return;
  await updateProject({ interview: { ...p.interview, stage: "refine" } });
  await flushDoc();
  window.location.reload();
}

export async function goHome() {
  await flushDoc();
  window.location.assign("/");
}
