import type { Hit, HitType } from "./recipes";

/*
 * Google Drive, reached through Drive's own API with Qalam's Google sign-in
 * (server/connectors/google.ts), never through Claude Code: browsing and reading cost no tokens,
 * and the files are read here by code (src/discovery/ingest). Pure: what Qalam reads of a file by
 * its type, a person's words as Drive's structured query (each word a `fullText contains '…'`
 * clause of letters and digits only, so nothing can add to the query), a folder only as an id Drive
 * could have given ('root' is My Drive), and Drive's files as hits.
 */

const FOLDER = "application/vnd.google-apps.folder";

/** What Qalam can read of a file, by its MIME type (anything else shows, greyed, and can't be picked). */
export function driveType(mime: string): HitType {
  if (mime === FOLDER) return "folder";
  if (mime === "application/vnd.google-apps.document" || mime === "application/msword" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || mime === "application/x-vnd.oasis.opendocument.text" || mime === "application/vnd.oasis.opendocument.text") return "doc";
  if (mime === "application/vnd.google-apps.presentation" || mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || mime === "application/vnd.oasis.opendocument.presentation") return "slides";
  if (mime === "application/vnd.google-apps.spreadsheet" || mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || mime === "application/vnd.oasis.opendocument.spreadsheet" || mime === "text/csv" || mime === "text/tab-separated-values") return "sheet";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/plain" || mime === "text/markdown") return "text";
  return "other";
}

/** A person's words as Drive's query: every word must be in the file's title or text. Null when there's no word to look for. */
export function driveWords(words: string): string | null {
  const each = words.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1).slice(0, 6);
  return each.length ? each.map((w) => `fullText contains '${w}'`).join(" and ") : null;
}

/** A folder Drive gave: its id, or My Drive. Anything else isn't a folder id, so it isn't put in a query. */
export const driveFolder = (folder: string | null) => (folder && /^[A-Za-z0-9_-]{1,128}$/.test(folder) ? folder : "root");

/** Drive's files as hits, folders first (Drive's API names them `name` and `webViewLink`). */
export function driveFileHits(files: readonly unknown[]): Hit[] {
  const word = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const hits = files.flatMap((x): Hit[] => {
    const f = (x ?? {}) as Record<string, unknown>;
    const id = word(f.id);
    if (!id) return [];
    const type = driveType(word(f.mimeType) ?? "");
    const title = word(f.name) ?? "Untitled";
    const link = word(f.webViewLink);
    const url = link && /^https:\/\/(docs|drive)\.google\.com\//.test(link) ? link : undefined;
    const at = word(f.modifiedTime);
    return [{ id, title, type, ...(type === "folder" ? { folder: true } : {}), ...(url ? { url } : {}), ...(at ? { at } : {}) }];
  });
  return [...hits.filter((h) => h.folder), ...hits.filter((h) => !h.folder)];
}
