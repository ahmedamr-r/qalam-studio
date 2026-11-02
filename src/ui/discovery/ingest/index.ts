import { fromBytes, fromPaste, IngestError, MAX_FILE, type Ingested, type Readers } from "@/discovery/ingest/core";
import { lab } from "@/lab";

/*
 * Bringing material in, in the browser (src/discovery/ingest/core.ts): its readers load only when
 * their format comes in (pdf.js, in a worker, and mammoth are large; web pages go through the
 * browser's own parser, where nothing in them runs or loads).
 */

export { ACCEPT, IngestError, type Ingested } from "@/discovery/ingest/core";

/**
 * A PDF read in the core, which can draw its pages and check what's in its pictures (lab: pictures):
 * null when no organization or no core answers, for the window to read it. What the core says of
 * the file itself (a scan with nothing to read it here) stands.
 */
async function pdfInCore(bytes: ArrayBuffer): Promise<Awaited<ReturnType<Readers["pdf"]>> | null> {
  try {
    const { orgPath } = await import("@/org/client");
    const res = await fetch(await orgPath("/pdf"), { method: "POST", headers: { "content-type": "application/pdf" }, body: bytes });
    if (res.ok) return (await res.json()) as Awaited<ReturnType<Readers["pdf"]>>;
    if (res.status !== 422) return null;
    throw new IngestError(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? "This PDF couldn't be read.");
  } catch (e) {
    if (e instanceof IngestError) throw e;
    return null;
  }
}

const browser: Readers = {
  pdf: async (bytes) => (lab("pictures") && (await pdfInCore(bytes))) || (await import("./pdf")).readPdf(bytes),
  docx: async (bytes) => (await import("./docx")).readDocx(bytes),
  html: async (text) => (await import("./html")).htmlToText(text),
};

export async function ingestFile(file: File): Promise<Ingested> {
  if (file.size > MAX_FILE) throw new IngestError(`${file.name} is over 40 MB.`);
  return fromBytes(await file.arrayBuffer(), file.type.toLowerCase(), file.name, file.name, browser);
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
  const r = await fromBytes(await res.arrayBuffer(), type.split(";")[0].trim(), name, raw.trim(), browser);
  // Whatever it was (a page, a PDF), it came from an address.
  return { ...r, kind: r.kind === "pdf" || r.kind === "docx" ? r.kind : "url", ...(res.headers.get("x-truncated") ? { truncated: true } : {}) };
}

/** Pasted text: its first line names it. */
export const ingestPaste = (text: string, title?: string) => fromPaste(text, title);
