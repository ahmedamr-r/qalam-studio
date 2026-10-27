import { create } from "zustand";
import { moveInlineImages, useStudio } from "@/doc/store";
import { emptyDoc, type Doc } from "@/doc/schema";
import { forStorage } from "@/doc/pages";
import { ConflictError } from "@/org/client";
import { loadedDocVersion, projectsDb, type ProjectRepo } from "./db";
import { openStores } from "@/ui/idb";
import { frameCount } from "./migrate";
import { newProject, orgHref, projectHref, type Project, type ProjectType } from "./model";

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
  const saved = await r.getDoc(id);
  const opened: Project = { ...p, openedAt: Date.now() };
  useProject.setState({ project: opened });
  // Edits left unsaved when this project's page last closed (a browser tab closed mid-save). They
  // stay in the outbox until they're saved, or the designer takes the other version.
  const left = await peekOutbox(id);
  if (left && sameDoc(left.doc, saved)) void dropOutbox(id);
  if (left && !sameDoc(left.doc, saved)) {
    useStudio.getState().openDoc(left.doc);
    unsaved = true;
    // Saved on top of the same version: it goes in. Otherwise the designer chooses.
    if (left.base !== loadedDocVersion(id)) useSaveConflict.setState({ conflict: { doc: saved, version: loadedDocVersion(id) ?? "" } });
  } else useStudio.getState().openDoc(saved ?? emptyDoc());
  moveInlineImages();
  await r.patch(id, { openedAt: opened.openedAt });
  return opened;
}

// ---------------------------------------------------------------------------
// The outbox: a browser tab can close before its last save reaches the folder. The document is
// kept in the browser as the page hides, and taken up the next time the project opens here.

interface Left {
  doc: Doc;
  /** The version the edits were made on. */
  base: string | null;
  at: number;
}

const outbox = () => (typeof indexedDB === "undefined" ? null : openStores("qalam-outbox", 1, ["docs"])("docs"));

async function peekOutbox(id: string): Promise<Left | null> {
  return (await outbox()?.get<Left>(id).catch(() => undefined)) ?? null;
}

/** Forget the edits kept for this project (they're saved, or the designer took the other version). */
export const dropOutbox = (id: string) => outbox()?.remove(id).catch(() => {}) ?? Promise.resolve();

function sameDoc(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => sameDoc((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Change the open project's record (name, system, thumbnail…) and save it. Only the fields named
 * here are sent, so a field another window changed meanwhile (a handoff, say) isn't overwritten.
 */
export async function updateProject(patch: Partial<Project> | ((p: Project) => Partial<Project>), opts: { touch?: boolean } = {}) {
  const p = currentProject();
  if (!p) return;
  const fields: Partial<Project> = { ...(typeof patch === "function" ? patch(p) : patch), ...(opts.touch === false ? {} : { updatedAt: Date.now() }) };
  useProject.setState({ project: { ...p, ...fields } });
  await repo.patch(p.id, fields).catch(() => {});
}

/** The open project's record changed elsewhere (another window, the folder): take it, keeping nothing stale. */
export function adoptProject(record: Project) {
  const p = currentProject();
  if (p?.id === record.id) useProject.setState({ project: { ...record, openedAt: p.openedAt } });
}

export const renameProject = (name: string) => {
  const n = name.trim().replace(/\s+/g, " ").slice(0, 80);
  if (n) void updateProject({ name: n });
};

// ---------------------------------------------------------------------------
// Saving the document

let flushSaving: ((opts?: { force?: boolean }) => Promise<void>) | null = null;
let stopActive: (() => void) | null = null;

/**
 * The open document changed elsewhere (another window, or its file on disk) after it opened here,
 * so a save would overwrite that change. Saving waits until the designer chooses (src/org/live.ts).
 */
export const useSaveConflict = create<{ conflict: { doc: Doc | null; version: string } | null }>(() => ({ conflict: null }));

/** Whether the open document has edits not yet saved. */
let unsaved = false;
export const hasUnsavedDoc = () => unsaved;

/**
 * Save the open project's document 400ms after edits settle (never mid-gesture), and right away
 * when the tab is hidden or closed. `onSaved` runs after each save (thumbnails).
 */
export function startDocPersistence(onSaved?: (doc: Doc) => void) {
  // Started again (React's dev double effects): one subscriber at a time.
  stopActive?.();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = useStudio.getState().doc;
  const flush = async (opts: { force?: boolean } = {}) => {
    clearTimeout(timer);
    const p = currentProject();
    if (!unsaved || !p) return;
    if (useSaveConflict.getState().conflict && !opts.force) return;
    unsaved = false;
    const doc = useStudio.getState().doc;
    onSaved?.(doc);
    const fields: Partial<Project> = { summary: { frames: frameCount(doc) }, updatedAt: Date.now() };
    useProject.setState({ project: { ...p, ...fields } });
    try {
      // The Components page is drawn from the design system: what's saved is the page it was opened from.
      await repo.putDoc(p.id, forStorage(doc), fields, { force: opts.force });
      if (opts.force) useSaveConflict.setState({ conflict: null });
      void outbox()?.remove(p.id).catch(() => {});
    } catch (e) {
      unsaved = true;
      if (e instanceof ConflictError) useSaveConflict.setState({ conflict: { doc: (e.current as Doc | null) ?? null, version: e.version } });
    }
  };
  const unsub = useStudio.subscribe((s) => {
    if (s.doc === last || s.txBase) return;
    last = s.doc;
    if (skipNext) {
      skipNext = false;
      return;
    }
    unsaved = true;
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), 400);
  });
  const onHide = () => {
    if (document.visibilityState === "hidden") void flush();
  };
  // The page is going: keep the edits in the browser too, in case the save can't finish.
  const onPageHide = () => {
    const p = currentProject();
    if (unsaved && p) void outbox()?.put(p.id, { doc: forStorage(useStudio.getState().doc), base: loadedDocVersion(p.id), at: Date.now() } satisfies Left);
    void flush();
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onPageHide);
  flushSaving = flush;
  // Opened with edits from the outbox: save them now.
  if (unsaved) timer = setTimeout(() => void flush(), 400);
  const stop = () => {
    void flush();
    unsub();
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onPageHide);
    if (flushSaving === flush) flushSaving = null;
    if (stopActive === stop) stopActive = null;
  };
  stopActive = stop;
  return stop;
}

/** Finish any pending save (before leaving the page). `force` saves over a change made elsewhere. */
export const flushDoc = (opts: { force?: boolean } = {}) => flushSaving?.(opts) ?? Promise.resolve();

let skipNext = false;
/** Show a document that came from elsewhere (another window, the folder) without saving it back. */
export function showDocFromElsewhere(doc: Doc) {
  skipNext = true;
  unsaved = false;
  useSaveConflict.setState({ conflict: null });
  const p = currentProject();
  if (p) void dropOutbox(p.id);
  useStudio.getState().openDoc(doc);
}

// ---------------------------------------------------------------------------
// Creating and leaving projects (navigation is a full page load: see the note at the top)

export async function createProject(type: ProjectType, name: string, extra: Partial<Project> = {}, doc?: Doc): Promise<Project> {
  const p = newProject(type, name, extra);
  await projectsDb.put(doc ? { ...p, summary: { frames: frameCount(doc) } } : p);
  if (doc) await projectsDb.putDoc(p.id, doc);
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
  window.location.assign(orgHref());
}
