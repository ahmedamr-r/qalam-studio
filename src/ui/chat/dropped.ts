import type { DragEvent } from "react";

/** Files from a drop, folders opened (one level is enough for a batch of screenshots). */
export async function droppedFiles(e: DragEvent): Promise<File[]> {
  const items = [...e.dataTransfer.items];
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
  if (!entries.some((x) => x.isDirectory)) return [...e.dataTransfer.files];
  const out: File[] = [];
  const fileOf = (f: FileSystemFileEntry) => new Promise<File>((ok, no) => f.file(ok, no));
  for (const entry of entries) {
    if (entry.isFile) out.push(await fileOf(entry as FileSystemFileEntry));
    else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const all: FileSystemEntry[] = [];
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, no) => reader.readEntries(ok, no));
        if (!batch.length) break;
        all.push(...batch);
      }
      for (const f of all.filter((x) => x.isFile && !x.name.startsWith("."))) out.push(await fileOf(f as FileSystemFileEntry));
    }
  }
  return out;
}

const PICTURE = /^image\/(png|jpeg|webp|gif|heic|heif)$/;
const PICTURE_NAME = /\.(png|jpe?g|webp|gif|heic|heif)$/i;

/** A picture Qalam reads as a screenshot: PNG, JPEG, WebP, GIF, or HEIC (read on a Mac), by its type or, where the browser gives none, its name. */
export const isScreenshotFile = (f: File) => PICTURE.test(f.type) || (!f.type && PICTURE_NAME.test(f.name));
