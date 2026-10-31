import type { SourceKind, TextBlock } from "../sources";
import type { TranscriptMeta, TranscriptSegment } from "../transcript";

/*
 * Bringing material in (pure apart from its readers): what comes out is the raw text kept as the
 * source, which quotes are checked against; nothing is summarized or rewritten on the way. A
 * caption file with two or more speakers (Zoom, Teams) becomes an interview: its text is the
 * transcript, turn by turn, with when each part was said and who said it. PDFs, Word files and web
 * pages are read the way the place reading them can: the browser with pdf.js in a worker and its
 * own HTML parser (src/ui/discovery/ingest), the core with Node's builds (server/ingest.ts).
 */

export interface Ingested {
  kind: SourceKind;
  title: string;
  /** A file's name, a page's address. */
  origin?: string;
  text: string;
  pages?: number[];
  /** A PDF's shape: its headings and list items. */
  blocks?: TextBlock[];
  truncated?: boolean;
  /** Interviews. */
  segments?: TranscriptSegment[];
  transcript?: TranscriptMeta;
}

/** Something the builder can fix (a scan, a format Qalam can't read): its message is for them. */
export class IngestError extends Error {}

export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MAX_FILE = 40 * 1024 * 1024;

/** What files the pickers offer (and the inbox reads). */
export const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const ACCEPT = ".pdf,.docx,.xlsx,.md,.markdown,.txt,.text,.csv,.tsv,.vtt,.srt,.html,.htm,application/pdf,text/plain,text/markdown,text/csv,text/html,text/vtt," + DOCX + "," + XLSX;

/** How a place reads what isn't plain text. */
export interface Readers {
  pdf: (bytes: ArrayBuffer) => Promise<{ text: string; pages: number[]; blocks?: TextBlock[]; title?: string }>;
  docx: (bytes: ArrayBuffer) => Promise<{ text: string }>;
  html: (text: string) => Promise<{ title?: string; text: string }>;
}

export const stem = (name: string) => name.replace(/\.[^.]+$/, "").trim() || name;

async function capped(kind: SourceKind, title: string, origin: string | undefined, text: string, pages?: number[], spoken?: Pick<Ingested, "segments" | "transcript">, blocks?: TextBlock[]): Promise<Ingested> {
  const { capText } = await import("./text");
  const c = capText(text);
  if (!c.text.trim()) throw new IngestError(`${title} has no text in it.`);
  let talk = spoken?.segments && spoken.transcript ? { segments: spoken.segments, transcript: spoken.transcript } : undefined;
  if (talk && c.truncated) {
    const { trimTranscript } = await import("../transcript");
    talk = trimTranscript(talk, c.text.length);
  }
  return { kind, title: title.slice(0, 160), ...(origin ? { origin } : {}), text: c.text, ...(pages ? { pages: c.truncated ? pages.filter((p) => p < c.text.length) : pages } : {}), ...(blocks?.length ? { blocks: blocks.filter((b) => b.span[1] <= c.text.length) } : {}), ...(c.truncated ? { truncated: true } : {}), ...talk };
}

/** A caption file: an interview when two or more people speak in it, else its words as plain text. */
async function fromCaptions(text: string, name: string, origin: string | undefined, format: "vtt" | "srt"): Promise<Ingested> {
  const { captionText, parseCaptions, speakerCount } = await import("../captions");
  const raw = parseCaptions(text, format);
  if (!raw.segments.length) throw new IngestError(`${name} has no captions in it.`);
  if (speakerCount(raw) < 2) return capped("text", stem(name), origin, captionText(raw));
  const { buildTranscript } = await import("../transcript");
  const b = buildTranscript(raw);
  return capped("interview", stem(name), origin, b.text, undefined, b);
}

/** Text in the charset its type names (or a page's own <meta charset>), else UTF-8. */
export function decodeText(bytes: ArrayBuffer, contentType: string): string {
  const named = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const sniffed = named ? null : /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder("latin1").decode(bytes.slice(0, 2048)))?.[1];
  for (const label of [named, sniffed, "utf-8"]) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      /* an unknown label: try the next */
    }
  }
  return new TextDecoder().decode(bytes);
}

/** A file's (or a page's) bytes as a source's text, by what it is. */
export async function fromBytes(bytes: ArrayBuffer, type: string, name: string, origin: string | undefined, readers: Readers): Promise<Ingested> {
  const head = new Uint8Array(bytes.slice(0, 5));
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const web = !!origin && /^https?:/i.test(origin);
  if (type === "application/pdf" || ext === "pdf" || String.fromCharCode(...head) === "%PDF-") {
    const r = await readers.pdf(bytes).catch((e) => {
      throw new IngestError(e instanceof Error && /no text/.test(e.message) ? e.message : `${name} couldn't be read as a PDF.`);
    });
    // A file goes by its name; a PDF at an address by its own title, when it has one.
    return capped("pdf", (web && r.title) || stem(name), origin, r.text, r.pages, undefined, r.blocks);
  }
  if (type === DOCX || ext === "docx") {
    const r = await readers.docx(bytes).catch(() => {
      throw new IngestError(`${name} couldn't be read as a Word document.`);
    });
    return capped("docx", stem(name), origin, r.text);
  }
  if (ext === "doc") throw new IngestError(`${name} is an old Word file (.doc). Save it as .docx, then add it.`);
  // A spreadsheet of people's answers: each row one voice (./rows.ts).
  if (type === XLSX || ext === "xlsx") {
    const rows = await xlsxRows(bytes).catch(() => {
      throw new IngestError(`${name} couldn't be read as a spreadsheet.`);
    });
    const { rowsText } = await import("./rows");
    const said = rowsText(rows);
    return capped("text", stem(name), origin, said ?? rows.map((r) => r.join(" · ")).join("\n"));
  }
  const text = decodeText(bytes, type);
  if (type === "text/csv" || type === "text/tab-separated-values" || ext === "csv" || ext === "tsv") {
    const { parseDelimited, rowsText } = await import("./rows");
    const said = rowsText(parseDelimited(text, ext === "tsv" || type === "text/tab-separated-values" ? "\t" : ","));
    if (said) return capped("text", stem(name), origin, said);
  }
  if (type === "text/vtt" || ext === "vtt" || /^﻿?WEBVTT/.test(text)) return fromCaptions(text, name, origin, "vtt");
  if (ext === "srt" || type === "application/x-subrip") return fromCaptions(text, name, origin, "srt");
  if (type === "text/html" || type === "application/xhtml+xml" || ext === "html" || ext === "htm" || (!type && /^\s*<(!doctype|html)/i.test(text))) {
    const r = await readers.html(text);
    return capped(web ? "url" : "text", r.title || stem(name), origin, r.text);
  }
  if (type === "text/markdown" || ext === "md" || ext === "markdown" || ext === "mdx") {
    const { markdownToText } = await import("./markdown");
    return capped("markdown", stem(name), origin, markdownToText(text));
  }
  if (type.startsWith("text/") || type === "application/json" || ["txt", "text", "csv", "tsv", "log", "json"].includes(ext) || !type) {
    const { cleanText } = await import("./text");
    return capped("text", stem(name), origin, cleanText(text));
  }
  throw new IngestError(`${name}: Qalam reads PDF, Word (.docx), spreadsheets (.xlsx, .csv), Markdown, web pages and text files.`);
}

/** An XLSX's first sheet as rows (the workbook is a zip of XML). */
async function xlsxRows(bytes: ArrayBuffer): Promise<string[][]> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const sheet = zip.file("xl/worksheets/sheet1.xml") ?? zip.file(/^xl\/worksheets\/sheet\d+\.xml$/)[0];
  if (!sheet) throw new Error("no sheet");
  const { xlsxSheetRows } = await import("./rows");
  return xlsxSheetRows(await sheet.async("string"), (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? null);
}

/** Pasted text: its first line names it. */
export async function fromPaste(text: string, title?: string): Promise<Ingested> {
  const { cleanText } = await import("./text");
  const clean = cleanText(text);
  const first = clean.split("\n").find((l) => l.trim())?.trim() ?? "";
  const name = title?.trim() || (first.length > 60 ? `${first.slice(0, 57).trim()}…` : first) || "Pasted text";
  return capped("paste", name, undefined, clean);
}
