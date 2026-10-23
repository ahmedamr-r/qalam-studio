import type { Doc } from "@/doc/schema";
import { wholeDoc } from "@/doc/pages";
import { newProject, type Project } from "./model";
import { projectsDb, type ProjectRepo } from "./db";

/**
 * Before projects, the studio kept one document in localStorage. On first run it becomes the first
 * Screens project. The old key is never deleted: a marker records which project it became and a
 * hash of what was copied, so a tab still running the old version can't lose work (its later
 * changes show up as "newer changes" the designer can import as another project).
 */

export const LEGACY_DOC_KEY = "ds-studio/doc/v1";
export const MARKER_KEY = "ds-studio/migrated/v1";

export interface Marker {
  /** The project the old document became, or null when there was nothing to move. */
  projectId: string | null;
  hash: string;
}

export interface LegacyIO {
  readLegacyDoc(): string | null;
  marker(): Marker | null;
  setMarker(m: Marker): void;
}

/** FNV-1a over the text, plus its length: enough to notice that the old document changed. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}-${s.length}`;
}

function parseDoc(raw: string | null): Doc | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Doc;
    return d && d.nodes && typeof d.nodes === "object" && Array.isArray(d.roots) ? d : null;
  } catch {
    return null;
  }
}

const hasContent = (d: Doc) => d.roots.length > 0 || !!d.brief;

/** A Screens project made from the old document. */
async function importLegacy(doc: Doc, repo: Pick<ProjectRepo, "put" | "putDoc">, name: string, now: number): Promise<Project> {
  const p = newProject("screens", name, { legacy: true, summary: { frames: frameCount(doc) } }, now);
  await repo.putDoc(p.id, doc);
  await repo.put(p);
  return p;
}

/** Frames on every page (the project's count on the home). */
export const frameCount = (doc: Doc) => {
  const d = wholeDoc(doc);
  return d.roots.filter((id) => d.nodes[id]?.type === "frame").length;
};

/** Run once: the old document becomes "My first project". Returns it, or null when nothing moved. */
export async function migrateLegacy(io: LegacyIO, repo: Pick<ProjectRepo, "put" | "putDoc">, now = Date.now()): Promise<Project | null> {
  if (io.marker()) return null;
  const raw = io.readLegacyDoc();
  const doc = parseDoc(raw);
  if (!doc || !hasContent(doc)) {
    io.setMarker({ projectId: null, hash: raw ? hashText(raw) : "" });
    return null;
  }
  const p = await importLegacy(doc, repo, "My first project", now);
  io.setMarker({ projectId: p.id, hash: hashText(raw!) });
  return p;
}

/** The old document changed after it was moved (an older tab kept writing to it). */
export function legacyChanged(io: LegacyIO): boolean {
  const m = io.marker();
  const raw = io.readLegacyDoc();
  if (!m || !raw) return false;
  const doc = parseDoc(raw);
  return !!doc && hasContent(doc) && hashText(raw) !== m.hash;
}

/** Copy those newer changes into a project of their own. */
export async function importLegacyChanges(io: LegacyIO, repo: Pick<ProjectRepo, "put" | "putDoc">, now = Date.now()): Promise<Project | null> {
  const raw = io.readLegacyDoc();
  const doc = parseDoc(raw);
  const m = io.marker();
  if (!doc || !m) return null;
  const p = await importLegacy(doc, repo, "Recovered changes", now);
  io.setMarker({ projectId: m.projectId, hash: hashText(raw!) });
  return p;
}

/** Chats saved before projects belong to the project the old document became. */
export const chatProject = (c: { projectId?: string }, legacyId: string | null): string | null => c.projectId ?? legacyId;

// ---------------------------------------------------------------------------
// Browser

export const browserLegacyIO: LegacyIO = {
  readLegacyDoc: () => {
    try {
      return window.localStorage.getItem(LEGACY_DOC_KEY);
    } catch {
      return null;
    }
  },
  marker: () => {
    try {
      const raw = window.localStorage.getItem(MARKER_KEY);
      return raw ? (JSON.parse(raw) as Marker) : null;
    } catch {
      return null;
    }
  },
  setMarker: (m) => {
    try {
      window.localStorage.setItem(MARKER_KEY, JSON.stringify(m));
    } catch {
      /* storage unavailable: the move runs again next time, which only re-copies */
    }
  },
};

let migrated: Promise<void> | null = null;

/** Every page runs this before reading projects (once; two tabs never move the document twice). */
export function ensureMigrated(): Promise<void> {
  if (migrated) return migrated;
  const run = async (): Promise<void> => {
    await migrateLegacy(browserLegacyIO, projectsDb);
  };
  const locked = typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request("qalam-migrate", run) : run();
  return (migrated = Promise.resolve(locked).catch(() => undefined));
}

/** The project the old document became (its chats have no project of their own). */
export const legacyProjectId = (): string | null => browserLegacyIO.marker()?.projectId ?? null;
