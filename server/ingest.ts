import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DOCX, fromBytes, IngestError, MAX_FILE, type Ingested, type Readers } from "@/discovery/ingest/core";
import { pdfText } from "@/discovery/ingest/pdf";
import { cleanText } from "@/discovery/ingest/text";

/*
 * Reading files in the core (the inbox folder, with no window open): the same reading as the
 * browser's (src/discovery/ingest/core.ts), with Node's builds of its readers. pdf.js runs its
 * worker's code in this process (imported up front, so a bundled core needs no file of it at a
 * path); mammoth reads Word files; a web page saved as a file loses its tags here.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** A web page as text, without a parser: what can't be read (scripts, styles, menus, forms) goes, blocks become paragraphs. */
export function htmlText(html: string): { title?: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const body = (/<main[\s>][\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<body[\s>][\s\S]*<\/body>/i.exec(html)?.[0] ?? html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg|canvas|iframe|object|form|nav|aside|footer|header|button|select|textarea)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|pre|dd|dt|figure|figcaption)\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return { ...(title ? { title: decode(title).replace(/\s+/g, " ").trim() } : {}), text: cleanText(decode(body).replace(/[ \t]+/g, " ")) };
}

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

/** Bytes fetched or exported (a feed's page) as a source's text, read by their type. */
export const ingestBytes = (bytes: ArrayBuffer, type: string, name: string, origin: string) => fromBytes(bytes, type, name, origin, node);

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
