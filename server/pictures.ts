import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { seesPictures } from "@/ai/abilities";
import { backend } from "@/ai/engine";
import { picturesCall, type PictureSent } from "@/ai/pictures";
import type { ShotImage } from "@/ai/seen";
import { aiConfigured, structured } from "@/ai/server";
import { NO_TEXT, pdfText, type PdfRead } from "@/discovery/ingest/pdf";
import { freshLines, joinPictures, pagesToSend, PICTURE_LIMITS, pickPage, printedOf, regionsOf, sanitizeFigures, scanText, type PageAddition, type PageFacts, type PageReading, type PickWhy, type Printed } from "@/discovery/ingest/pictures";
import type { PictureUnreadWhy, SourcePictures, TextBlock } from "@/discovery/sources";
import type { ShotLine, ShotRead } from "@/seen/shot";
import { labOn } from "./lab";
import { assetHash, atomicWrite, readJson } from "./org/fsx";
import type { OrgStore } from "./org/store";
import { drawPdfPages, prepShot, readRegions, readShots, seeAvailable } from "./see";

/*
 * Reading what's inside a PDF's pictures, in the core (lab: pictures; pure parts in
 * src/discovery/ingest/pictures.ts). Pages with pictures are found with pdf.js, drawn and read on
 * this Mac (native/see: nothing leaves it, no tokens), then the ones worth it go to Qalam AI with the
 * words printed on them, and code keeps what those words back. Off a Mac there's no reader: nothing
 * in a picture can be checked, so nothing in one is read, and the source says which weren't. What's
 * read is kept by the PDF's content in `.qalam/pictures/`, so adding a file twice costs nothing.
 */

/** Bump when reading changes: what was kept before is read again. */
const PICTURES_VERSION = 1;

/** A scan where there's no reader: said in the words the file reader passes on (it looks for "no text"). */
export const NO_READER = "This PDF has no text to read, only scanned pages, and Qalam reads those only on a Mac. Export it with text, or paste what it says.";

export interface PdfPictures extends Pick<PdfRead, "text" | "pages" | "title"> {
  blocks?: TextBlock[];
  pictures?: SourcePictures;
}

/** What it reaches for: replaced in tests. */
export interface PictureDeps {
  /** Whether there's a reader here. */
  reader: () => Promise<boolean>;
  /** Whether the engine can see pictures now. */
  sees: () => boolean;
  draw: typeof drawPdfPages;
  words: (orgDir: string, shots: { hash: string; file: string }[]) => Promise<Map<string, ShotRead | null>>;
  regions: (file: string, boxes: readonly (readonly [number, number, number, number])[]) => Promise<ShotLine[][]>;
  prep: typeof prepShot;
  call: (opts: ReturnType<typeof picturesCall>, signal?: AbortSignal) => Promise<{ data: unknown; model?: string }>;
}

const coreDeps: PictureDeps = {
  reader: seeAvailable,
  sees: () => aiConfigured() && seesPictures(backend()),
  draw: drawPdfPages,
  words: readShots,
  regions: readRegions,
  prep: prepShot,
  call: (opts, signal) => structured<unknown>(opts, signal),
};

export const picturesOn = async () => {
  const on = await labOn();
  return on === true || on.includes("pictures");
};

async function nodePdfJs() {
  // The worker's code, here: pdf.js uses it in this process instead of loading it by path.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

const pageText = (r: Pick<PdfRead, "text" | "pages">, page: number) => r.text.slice(r.pages[page - 1], page < r.pages.length ? r.pages[page] - 2 : r.text.length);

const isStop = (e: unknown, signal?: AbortSignal) => !!signal?.aborted || (e as Error)?.name === "AbortError";

type Store = Pick<OrgStore, "dir" | "putAsset" | "putTrace">;

/**
 * A PDF's text, with what's in its pictures as far as it can be read and checked here. A failed
 * call leaves that page's printed words, and doesn't stop the document.
 */
export async function readPdfPictures(store: Store, bytes: ArrayBuffer, o: { emit?: (label: string) => void; signal?: AbortSignal } = {}, deps: PictureDeps = coreDeps): Promise<PdfPictures> {
  // pdf.js takes the bytes over.
  const file = Buffer.from(bytes);
  const hash = assetHash(new Uint8Array(file));
  const base = await pdfText(await nodePdfJs(), file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, { facts: true });
  const { facts = [], ...read } = base;
  const hasText = !!read.text.replace(/\s+/g, "");
  const picks = facts.flatMap((f): { f: PageFacts; why: PickWhy }[] => {
    const why = pickPage(f);
    return why ? [{ f, why }] : [];
  });
  if (!picks.length) {
    if (!hasText) throw new Error(NO_TEXT);
    return read;
  }
  if (!(await deps.reader())) {
    if (!hasText) throw new Error(NO_READER);
    return { ...read, pictures: { read: [], unread: [{ pages: picks.map((p) => p.f.page), why: "no-reader" }] } };
  }
  const keptAt = path.join(store.dir, ".qalam", "pictures", `${hash}.json`);
  const kept = await readJson<PdfPictures & { v?: number }>(keptAt);
  if (kept?.v === PICTURES_VERSION) {
    const { v: _v, ...reading } = kept;
    return reading;
  }

  await mkdir(path.dirname(keptAt), { recursive: true });
  const tmp = await mkdtemp(path.join(path.dirname(keptAt), ".drawing-"));
  try {
    const reading = picks.slice(0, PICTURE_LIMITS.readPages);
    const unread: { pages: number[]; why: PictureUnreadWhy }[] = [];
    const note = (pages: number[], why: PictureUnreadWhy) => {
      if (pages.length) unread.push({ pages, why });
    };
    note(picks.slice(PICTURE_LIMITS.readPages).map((p) => p.f.page), "limit");

    o.emit?.(`Reading the pictures on ${reading.length === 1 ? "1 page" : `${reading.length} pages`}`);
    const pdf = path.join(tmp, "doc.pdf");
    await writeFile(pdf, file);
    const drawn = await deps.draw(pdf, tmp, PICTURE_LIMITS.readSide, reading.map((p) => p.f.page));
    const shots = await Promise.all([...drawn].map(async ([page, d]) => ({ page, file: d.file, hash: assetHash(new Uint8Array(await readFile(d.file))) })));
    const words = await deps.words(store.dir, shots);
    const shotOf = new Map(shots.map((s) => [s.page, s]));
    const printed: Printed[] = [];
    for (const { f, why } of reading) {
      const s = shotOf.get(f.page);
      const r = s ? words.get(s.hash) : null;
      if (s && r) printed.push(printedOf(f, why, r, pageText(read, f.page), await deps.regions(s.file, regionsOf(f, why))));
    }
    note(reading.map((p) => p.f.page).filter((p) => !printed.some((x) => x.page === p)), "failed");

    const { send, over } = pagesToSend(printed);
    note(over.map((p) => p.page), "limit");
    const readings = new Map<number, PageReading>();
    const imageOf = async (page: number, side: number): Promise<{ image: ShotImage; bytes: Uint8Array } | null> => {
      const s = shotOf.get(page);
      if (!s) return null;
      const copy = await deps.prep(store.dir, s.hash, s.file, side, "jpeg");
      const raw = await readFile(copy.file);
      return { image: { mediaType: copy.type as ShotImage["mediaType"], data: raw.toString("base64") }, bytes: new Uint8Array(raw) };
    };

    if (send.length && !deps.sees()) note(send.map((p) => p.page), "no-vision");
    else {
      for (let i = 0; i < send.length; i += PICTURE_LIMITS.perCall) {
        if (o.signal?.aborted) throw Object.assign(new Error("Stopped."), { name: "AbortError" });
        const batch = send.slice(i, i + PICTURE_LIMITS.perCall);
        const sent: (PictureSent & { p: Printed })[] = [];
        for (const p of batch) {
          const im = await imageOf(p.page, PICTURE_LIMITS.sendSide);
          if (im) sent.push({ p, ref: `p${sent.length + 1}`, page: p.page, image: im.image, words: printedList(p) });
        }
        if (!sent.length) continue;
        o.emit?.(`Reading what's printed in the pictures (pages ${sent[0].page}–${sent[sent.length - 1].page})`);
        try {
          const { data, model } = await deps.call(picturesCall(sent), o.signal);
          const pages = (data as { pages?: { id?: unknown }[] } | null)?.pages;
          for (const s of sent) readings.set(s.page, sanitizeFigures((Array.isArray(pages) ? pages : []).find((x) => x?.id === s.ref) ?? null, s.p, s.p.why === "scan" ? [] : undefined));
          void store.putTrace({ id: nanoid(10), projectId: "pictures", kind: "pdf-pictures", at: Date.now(), ...(model ? { model } : {}), pdf: hash, pages: sent.map((s) => ({ ref: s.ref, page: s.page, why: s.p.why })), answer: data, kept: sent.map((s) => ({ page: s.page, ...readings.get(s.page)! })) } as { id: string; projectId: string }).catch(() => {});
        } catch (e) {
          if (isStop(e, o.signal)) throw e;
          console.warn(`[pictures] couldn't read pages ${sent.map((s) => s.page).join(", ")}: ${(e as Error).message}`);
          // An engine that turns pictures away does so for the rest too.
          const refused = (e as { code?: string }).code === "no_vision" || /can't read pictures/i.test((e as Error).message);
          note(refused ? send.slice(i).map((p) => p.page) : sent.map((s) => s.page), refused ? "no-vision" : "failed");
          if (refused) break;
        }
      }
    }

    const adds: PageAddition[] = [];
    for (const p of printed) {
      const r = readings.get(p.page);
      const add: PageAddition = { page: p.page };
      if (p.why === "scan") add.scan = scanText(p);
      if (r) {
        if (r.figures.length) add.figures = r.figures;
        if (r.rest.length) add.rest = r.rest;
        if (r.left.length) add.left = r.left;
      } else if (p.why === "picture") {
        // Nothing paired its words: what it prints is still printed.
        const fresh = freshLines(p).map((l) => l.text.trim());
        if (fresh.length) add.words = fresh;
      }
      // Only what's in the source keeps a picture, for a reader to compare it with.
      if (add.scan?.text || add.figures || add.rest || add.words || add.left) {
        const im = await imageOf(p.page, PICTURE_LIMITS.sendSide);
        if (im) {
          const asset = assetHash(im.bytes);
          await store.putAsset(asset, im.bytes, im.image.mediaType);
          add.asset = asset;
        }
        adds.push(add);
      }
    }
    const out: PdfPictures = joinPictures(read, adds, unread);
    if (!out.text.replace(/\s+/g, "")) throw new Error(hasText ? NO_TEXT : NO_READER.replace(", and Qalam reads those only on a Mac", ", and nothing could be read off them"));
    // What couldn't be read now may be another time: only a whole reading is kept.
    if (!unread.some((u) => u.why !== "limit")) await atomicWrite(keptAt, `${JSON.stringify({ v: PICTURES_VERSION, ...out })}\n`).catch(() => {});
    return out;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** The words a call is sent: what this Mac read, then the page's own text when it has some. */
function printedList(p: Printed): string {
  const lines = p.lines.map((l) => l.text.trim()).join("\n");
  return (p.layer && p.why !== "scan" ? `${lines}\n\nThe page's text:\n${p.layer}` : lines).slice(0, PICTURE_LIMITS.words);
}
