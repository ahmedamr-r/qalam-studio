import type { SourceKind } from "@/discovery/sources";
import type { TranscriptMeta, TranscriptSegment } from "@/discovery/transcript";

/*
 * Bringing material onto a board, in the browser: each format's reader loads only when that format
 * comes in (pdf.js and mammoth are large). What comes out is the raw text the board keeps as the
 * source, which quotes are checked against; nothing is summarized or rewritten on the way. A
 * caption file with two or more speakers (Zoom, Teams) becomes an interview: its text is the
 * transcript, turn by turn, with when each part was said and who said it.
 */

export interface Ingested {
  kind: SourceKind;
  title: string;
  /** A file's name, a page's address. */
  origin?: string;
  text: string;
  pages?: number[];
  truncated?: boolean;
  /** Interviews. */
  segments?: TranscriptSegment[];
  transcript?: TranscriptMeta;
}

/** Something the builder can fix (a scan, a format Qalam can't read): its message is for them. */
export class IngestError extends Error {}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_FILE = 40 * 1024 * 1024;

/** What files the pickers offer. */
export const ACCEPT = ".pdf,.docx,.md,.markdown,.txt,.text,.csv,.tsv,.vtt,.srt,.html,.htm,application/pdf,text/plain,text/markdown,text/csv,text/html,text/vtt," + DOCX;

const stem = (name: string) => name.replace(/\.[^.]+$/, "").trim() || name;

async function capped(kind: SourceKind, title: string, origin: string | undefined, text: string, pages?: number[], spoken?: Pick<Ingested, "segments" | "transcript">): Promise<Ingested> {
  const { capText } = await import("./text");
  const c = capText(text);
  if (!c.text.trim()) throw new IngestError(`${title} has no text in it.`);
  let talk = spoken?.segments && spoken.transcript ? { segments: spoken.segments, transcript: spoken.transcript } : undefined;
  if (talk && c.truncated) {
    const { trimTranscript } = await import("@/discovery/transcript");
    talk = trimTranscript(talk, c.text.length);
  }
  return { kind, title: title.slice(0, 160), ...(origin ? { origin } : {}), text: c.text, ...(pages ? { pages: c.truncated ? pages.filter((p) => p < c.text.length) : pages } : {}), ...(c.truncated ? { truncated: true } : {}), ...talk };
}

/** A caption file: an interview when two or more people speak in it, else its words as plain text. */
async function fromCaptions(text: string, name: string, origin: string | undefined, format: "vtt" | "srt"): Promise<Ingested> {
  const { captionText, parseCaptions, speakerCount } = await import("@/discovery/captions");
  const raw = parseCaptions(text, format);
  if (!raw.segments.length) throw new IngestError(`${name} has no captions in it.`);
  if (speakerCount(raw) < 2) return capped("text", stem(name), origin, captionText(raw));
  const { buildTranscript } = await import("@/discovery/transcript");
  const b = buildTranscript(raw);
  return capped("interview", stem(name), origin, b.text, undefined, b);
}

async function fromBytes(bytes: ArrayBuffer, type: string, name: string, origin?: string): Promise<Ingested> {
  const head = new Uint8Array(bytes.slice(0, 5));
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const web = !!origin && /^https?:/i.test(origin);
  if (type === "application/pdf" || ext === "pdf" || String.fromCharCode(...head) === "%PDF-") {
    const { readPdf } = await import("./pdf");
    const r = await readPdf(bytes).catch((e) => {
      throw new IngestError(e instanceof Error && /no text/.test(e.message) ? e.message : `${name} couldn't be read as a PDF.`);
    });
    // A file goes by its name; a PDF at an address by its own title, when it has one.
    return capped("pdf", (web && r.title) || stem(name), origin, r.text, r.pages);
  }
  if (type === DOCX || ext === "docx") {
    const { readDocx } = await import("./docx");
    const r = await readDocx(bytes).catch(() => {
      throw new IngestError(`${name} couldn't be read as a Word document.`);
    });
    return capped("docx", stem(name), origin, r.text);
  }
  if (ext === "doc") throw new IngestError(`${name} is an old Word file (.doc). Save it as .docx, then add it.`);
  const text = decodeText(bytes, type);
  if (type === "text/vtt" || ext === "vtt" || /^﻿?WEBVTT/.test(text)) return fromCaptions(text, name, origin, "vtt");
  if (ext === "srt" || type === "application/x-subrip") return fromCaptions(text, name, origin, "srt");
  if (type === "text/html" || type === "application/xhtml+xml" || ext === "html" || ext === "htm" || (!type && /^\s*<(!doctype|html)/i.test(text))) {
    const { htmlToText } = await import("./html");
    const r = htmlToText(text);
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
  throw new IngestError(`${name}: Qalam reads PDF, Word (.docx), Markdown, web pages and text files.`);
}

/** Text in the charset its type names (or a page's own <meta charset>), else UTF-8. */
function decodeText(bytes: ArrayBuffer, contentType: string): string {
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

export async function ingestFile(file: File): Promise<Ingested> {
  if (file.size > MAX_FILE) throw new IngestError(`${file.name} is over 40 MB.`);
  return fromBytes(await file.arrayBuffer(), file.type.toLowerCase(), file.name, file.name);
}

/** A web page (or a PDF or Word file at an address), read through the server (/api/fetch-url). */
export async function ingestUrl(raw: string, signal?: AbortSignal): Promise<Ingested> {
  let res: Response;
  try {
    res = await fetch("/api/fetch-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: raw.trim() }), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new IngestError("Couldn't reach the studio's server to read that page.");
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new IngestError(j?.message ?? `Couldn't read that page (${res.status}).`);
  }
  const type = (res.headers.get("x-source-type") ?? "").toLowerCase();
  const final = res.headers.get("x-final-url") ?? raw;
  let name = raw;
  try {
    const u = new URL(final);
    name = `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : decodeURIComponent(u.pathname)}`;
  } catch {
    /* keep the address as given */
  }
  const r = await fromBytes(await res.arrayBuffer(), type.split(";")[0].trim(), name, raw.trim());
  // Whatever it was (a page, a PDF), it came from an address.
  return { ...r, kind: r.kind === "pdf" || r.kind === "docx" ? r.kind : "url", ...(res.headers.get("x-truncated") ? { truncated: true } : {}) };
}

/** Pasted text: its first line names it. */
export async function ingestPaste(text: string, title?: string): Promise<Ingested> {
  const { cleanText } = await import("./text");
  const clean = cleanText(text);
  const first = clean.split("\n").find((l) => l.trim())?.trim() ?? "";
  const name = title?.trim() || (first.length > 60 ? `${first.slice(0, 57).trim()}…` : first) || "Pasted text";
  return capped("paste", name, undefined, clean);
}
