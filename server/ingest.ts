import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DOCX, fromBytes, IngestError, MAX_FILE, type Ingested, type Readers } from "@/discovery/ingest/core";
import { pdfText } from "@/discovery/ingest/pdf";
import { cleanText, htmlText } from "@/discovery/ingest/text";

/*
 * Reading files in the core (the inbox folder, with no window open): the same reading as the
 * browser's (src/discovery/ingest/core.ts), with Node's builds of its readers. pdf.js runs its
 * worker's code in this process (imported up front, so a bundled core needs no file of it at a
 * path); mammoth reads Word files; a web page saved as a file loses its tags here.
 */

const node: Readers = {
  pdf: async (bytes) => {
    // The worker's code, here: pdf.js uses it in this process instead of loading it by path.
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    return pdfText(pdfjs, bytes);
  },
  docx: async (bytes) => {
    const mammoth = await import("mammoth");
    const { value } = await (mammoth.default ?? mammoth).extractRawText({ buffer: Buffer.from(bytes) });
    const text = cleanText(value);
    if (!text) throw new Error("This Word document has no text in it.");
    return { text };
  },
  html: async (text) => htmlText(text),
};

const TYPES: Record<string, string> = { pdf: "application/pdf", docx: DOCX, md: "text/markdown", markdown: "text/markdown", txt: "text/plain", text: "text/plain", csv: "text/csv", tsv: "text/tab-separated-values", vtt: "text/vtt", srt: "application/x-subrip", html: "text/html", htm: "text/html", json: "application/json" };

/** Whether a file is one Qalam reads (by its name). */
export const readable = (name: string) => !!TYPES[name.split(".").pop()?.toLowerCase() ?? ""];

/** A file in the organization's folder as a source's text, named by `name` (its name as it was dropped in, when it has moved since). */
export async function ingestPath(file: string, name = path.basename(file)): Promise<Ingested> {
  const type = TYPES[name.split(".").pop()?.toLowerCase() ?? ""];
  // Only what Qalam reads: anything else in the folder is left alone.
  if (!type) throw new IngestError(`${name}: Qalam reads PDF, Word (.docx), Markdown, web pages, captions and text files.`);
  const st = await stat(file);
  if (st.size > MAX_FILE) throw new IngestError(`${name} is over 40 MB.`);
  const buf = await readFile(file);
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return fromBytes(bytes, type, name, name, node);
}
