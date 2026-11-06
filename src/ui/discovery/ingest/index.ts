import { fromBytes, fromPaste, IngestError, MAX_FILE, type Ingested, type Readers } from "@/discovery/ingest/core";
import { lab } from "@/lab";

/*
 * Bringing material in, in the browser (src/discovery/ingest/core.ts): its readers load only when
 * their format comes in (pdf.js, in a worker, and mammoth are large; web pages go through the
 * browser's own parser, where nothing in them runs or loads).
 */

export { ACCEPT, IngestError, type Ingested } from "@/discovery/ingest/core";

/** What a read can be told: how it's going, and to stop. */
export interface IngestOpts {
  onStep?: (step: string) => void;
  signal?: AbortSignal;
}

/**
 * A PDF read in the core, which can draw its pages and check what's in its pictures (lab: pictures),
 * saying how it's going: a long report takes minutes. Null when no organization or no core answers,
 * for the window to read it. What the core says of the file itself (a scan with nothing to read it
 * here) stands, and a read that was stopped stays stopped.
 */
async function pdfInCore(bytes: ArrayBuffer, o: IngestOpts): Promise<Awaited<ReturnType<Readers["pdf"]>> | null> {
  try {
    const { orgPath } = await import("@/org/client");
    const res = await fetch(await orgPath("/pdf"), { method: "POST", headers: { "content-type": "application/pdf" }, body: bytes, signal: o.signal });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;
      buf += dec.decode(value, { stream: true });
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as { type: string; label?: string; data?: unknown; message?: string };
        if (msg.type === "activity" && msg.label) o.onStep?.(msg.label);
        else if (msg.type === "result") return msg.data as Awaited<ReturnType<Readers["pdf"]>>;
        else if (msg.type === "error") {
          if (/no text/.test(msg.message ?? "")) throw new IngestError(msg.message!);
          return null;
        }
      }
    }
  } catch (e) {
    if (e instanceof IngestError || (e as Error).name === "AbortError") throw e;
    return null;
  }
}

/** The core's NDJSON answer: its steps heard, its result returned, its error thrown in words. */
async function streamedIngest(res: Response, o: IngestOpts): Promise<Ingested> {
  if (!res.ok && !res.headers.get("content-type")?.includes("ndjson")) {
    const j = (await res.json().catch(() => ({}))) as { message?: string };
    throw new IngestError(j.message ?? `It couldn't be read (${res.status}).`);
  }
  if (!res.body) throw new IngestError("Nothing came back for it.");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new IngestError("It stopped before it was read.");
    buf += dec.decode(value, { stream: true });
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as { type: string; label?: string; data?: unknown; message?: string };
      if (msg.type === "activity" && msg.label) o.onStep?.(msg.label);
      else if (msg.type === "result") return msg.data as Ingested;
      else if (msg.type === "error") throw new IngestError(msg.message ?? "It couldn't be read.");
    }
  }
}

/**
 * A picture, read in the core: the words printed in it, checked on this Mac, and what Qalam AI
 * understands it to be (server/image.ts). It needs a project to keep the picture in.
 */
async function imageInCore(bytes: ArrayBuffer, type: string, name: string, o: IngestOpts): Promise<Ingested> {
  const { orgPath } = await import("@/org/client");
  const res = await fetch(await orgPath("/image"), { method: "POST", headers: { "content-type": type || "application/octet-stream", "x-qalam-title": encodeURIComponent(name) }, body: bytes, signal: o.signal });
  return streamedIngest(res, o);
}

/** A picture already kept in the project (the start page's box held it), read as one dropped here is. */
export async function readHeldImage(asset: string, title: string, o: IngestOpts = {}): Promise<Ingested> {
  const { orgPath } = await import("@/org/client");
  const res = await fetch(await orgPath("/image"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ asset, title }), signal: o.signal });
  return streamedIngest(res, o);
}

const browser = (o: IngestOpts = {}): Readers => ({
  image: (bytes, type, name) => imageInCore(bytes, type, name, o),
  pdf: async (bytes) => (lab("pictures") && (await pdfInCore(bytes, o))) || (await import("./pdf")).readPdf(bytes),
  docx: async (bytes) => (await import("./docx")).readDocx(bytes),
  html: async (text) => (await import("./html")).htmlToText(text),
});

export async function ingestFile(file: File, o: IngestOpts = {}): Promise<Ingested> {
  if (file.size > MAX_FILE) throw new IngestError(`${file.name} is over 40 MB.`);
  return fromBytes(await file.arrayBuffer(), file.type.toLowerCase(), file.name, file.name, browser(o));
}

/** A web page (or a PDF or Word file at an address), read through the server (/api/fetch-url). */
export async function ingestUrl(raw: string, signal?: AbortSignal, onStep?: IngestOpts["onStep"]): Promise<Ingested> {
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
  const r = await fromBytes(await res.arrayBuffer(), type.split(";")[0].trim(), name, raw.trim(), browser({ signal, onStep }));
  // Whatever it was (a page, a PDF), it came from an address.
  return { ...r, kind: r.kind === "pdf" || r.kind === "docx" ? r.kind : "url", ...(res.headers.get("x-truncated") ? { truncated: true } : {}) };
}

/** Pasted text: its first line names it. */
export const ingestPaste = (text: string, title?: string) => fromPaste(text, title);
