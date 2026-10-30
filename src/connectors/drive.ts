import { cleanText } from "@/discovery/ingest/text";
import type { Hit, HitType, Recipe } from "./recipes";

/*
 * Google Drive through Google's own Drive server, which claude.ai's Google Drive connector is (used
 * through Claude Code), pure. `search_files` takes Drive's structured query, never loose words: each
 * word is a `fullText contains '…'` clause of letters and digits only, so nothing can add to the
 * query, and a folder is `parentId = '<id>'` ('root' is My Drive). It answers
 * {files:[{id,title,mimeType,parentId,viewUrl,modifiedTime}]}; `read_file_content` answers
 * {fileContent,title,viewUrl}, with Docs, Slides, Sheets, PDFs and Office files as text. Checked
 * against a real Drive (October 2026).
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

const LIST = { pageSize: 50, excludeContentSnippets: true };

/** Drive's files as hits, folders first: Google's Drive server names them `title` and `viewUrl`, Drive's API `name` and `webViewLink`. */
export function driveFileHits(files: readonly unknown[]): Hit[] {
  const word = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const hits = files.flatMap((x): Hit[] => {
    const f = (x ?? {}) as Record<string, unknown>;
    const id = word(f.id);
    if (!id) return [];
    const type = driveType(word(f.mimeType) ?? "");
    const title = word(f.title) ?? word(f.name) ?? "Untitled";
    const link = word(f.viewUrl) ?? word(f.webViewLink);
    const url = link && /^https:\/\/(docs|drive)\.google\.com\//.test(link) ? link : undefined;
    const at = word(f.modifiedTime);
    return [{ id, title, type, ...(type === "folder" ? { folder: true } : {}), ...(url ? { url } : {}), ...(at ? { at } : {}) }];
  });
  return [...hits.filter((h) => h.folder), ...hits.filter((h) => !h.folder)];
}

/** search_files' and list_recent_files' answer as hits. */
export function driveHits(result: string): Hit[] {
  try {
    const files = (JSON.parse(result.slice(result.indexOf("{"))) as { files?: unknown } | null)?.files;
    return driveFileHits(Array.isArray(files) ? files : []);
  } catch {
    return [];
  }
}

/** A read file's words as Drive gave them. */
export function driveText(result: string): string {
  try {
    const j = JSON.parse(result.slice(result.indexOf("{"))) as { fileContent?: unknown };
    if (typeof j.fileContent === "string") return cleanText(j.fileContent);
  } catch {
    // Not the shape it was checked with: the answer as it came.
  }
  return cleanText(result);
}

export const DRIVE_RECIPE: Recipe = {
  // No word to look for finds nothing (an empty query would list the whole Drive).
  search: (words) => ({ tool: "search_files", args: { query: driveWords(words) ?? "title = ''", ...LIST } }),
  list: (folder) => ({ tool: "search_files", args: { query: `parentId = '${driveFolder(folder)}'`, ...LIST } }),
  recent: () => ({ tool: "list_recent_files", args: { pageSize: 25, excludeContentSnippets: true } }),
  hits: driveHits,
  fetch: (hit) => ({ tool: "read_file_content", args: { fileId: hit.id } }),
  text: driveText,
};
