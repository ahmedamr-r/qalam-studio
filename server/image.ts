import { readFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { seesPictures } from "@/ai/abilities";
import { backend } from "@/ai/engine";
import { imageCall } from "@/ai/image";
import type { ShotImage } from "@/ai/seen";
import { aiConfigured, structured } from "@/ai/server";
import type { Ingested } from "@/discovery/ingest/core";
import { imageText, imageTitle, sanitizeImage, sureLines, type KeptImage } from "@/discovery/ingest/image";
import type { SourceImage } from "@/discovery/sources";
import type { ShotRead } from "@/seen/shot";
import { assetHash, atomicWrite, readJson } from "./org/fsx";
import type { OrgStore } from "./org/store";
import { prepShot, readShots, seeAvailable } from "./see";

/*
 * A picture someone added, read in the core (pure parts in src/discovery/ingest/image.ts): kept as
 * the project's asset, its printed words read on this Mac (native/see, no tokens), then one look by
 * Qalam AI at what it is and what's in it, where the engine can see pictures. Code keeps only what
 * the print bears out. A whole reading is kept by the picture's content in `.qalam/images/`, so the
 * same picture added again costs nothing.
 */

/** Bump when reading changes: what was kept before is read again. */
const IMAGE_VERSION = 1;
/** The longest side Qalam AI is sent. */
const SEND_SIDE = 1568;
/** The most a picture kept as an asset may weigh (the asset route's own limit). */
export const IMAGE_MAX = 16 * 1024 * 1024;

export const NO_IMAGE_READER = "Qalam can't read pictures on this computer: there's no way to check the words in it here, and the engine can't look at pictures. Paste what it says instead.";

/** What a picture is by its first bytes; HEIC by its brand. */
export function sniffPicture(b: Uint8Array): string | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  if (b.length > 12 && String.fromCharCode(...b.slice(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...b.slice(8, 12));
    if (/^(heic|heix|hevc|heim|heis|hevm|hevs)$/.test(brand)) return "image/heic";
    if (/^(mif1|msf1)$/.test(brand)) return "image/heif";
  }
  return null;
}

/** What it reaches for: replaced in tests. */
export interface ImageDeps {
  /** Whether this Mac can read printed words. */
  reader: () => Promise<boolean>;
  /** Whether the engine can see pictures now. */
  sees: () => boolean;
  words: (orgDir: string, shots: { hash: string; file: string }[]) => Promise<Map<string, ShotRead | null>>;
  prep: typeof prepShot;
  call: (opts: ReturnType<typeof imageCall>, signal?: AbortSignal) => Promise<{ data: unknown; model?: string }>;
}

const coreDeps: ImageDeps = {
  reader: seeAvailable,
  sees: () => aiConfigured() && seesPictures(backend()),
  words: (dir, shots) => readShots(dir, shots),
  prep: prepShot,
  call: (opts, signal) => structured<unknown>(opts, signal),
};

/** The picture: its bytes as they came (kept as an asset first), or one the project keeps already. */
export type ImageInput = { bytes: Uint8Array; type: string; name: string } | { asset: string; name: string };

interface KeptReading {
  v: number;
  w?: number;
  h?: number;
  kept: KeptImage;
  text: string;
  unread?: SourceImage["unread"];
}

const isStop = (e: unknown, signal?: AbortSignal) => signal?.aborted || (e as Error)?.name === "AbortError";

/** A picture as a source's material. Throws, in words, what stops it being read. */
export async function readImage(store: OrgStore, input: ImageInput, o: { emit?: (label: string) => void; signal?: AbortSignal } = {}, deps: ImageDeps = coreDeps): Promise<Ingested> {
  let hash: string;
  if ("bytes" in input) {
    if (input.bytes.byteLength > IMAGE_MAX) throw new Error(`${input.name} is over 16 MB.`);
    const type = sniffPicture(input.bytes);
    if (!type) throw new Error(`${input.name} isn't a picture Qalam reads (PNG, JPEG, WebP, GIF or HEIC).`);
    hash = assetHash(input.bytes);
    await store.putAsset(hash, input.bytes, type);
  } else hash = input.asset;
  const asset = store.getAsset(hash);
  if (!asset) throw new Error("The picture isn't in the project any more.");
  const type = sniffPicture(new Uint8Array(await readFile(asset.file))) ?? asset.type;
  const keptAt = path.join(store.dir, ".qalam", "images", `${hash}.json`);
  const kept = await readJson<KeptReading>(keptAt);
  const reading = kept?.v === IMAGE_VERSION ? kept : await look(store, hash, asset.file, input.name, o, deps);
  if (reading !== kept && !reading.unread?.some((u) => u === "failed")) await atomicWrite(keptAt, `${JSON.stringify(reading)}\n`).catch(() => {});
  const k = reading.kept;
  const image: SourceImage = {
    asset: hash,
    type,
    ...(reading.w ? { w: reading.w } : {}),
    ...(reading.h ? { h: reading.h } : {}),
    shows: k.shows,
    reading: k.reading,
    ...(k.product ? { product: k.product } : {}),
    ...(k.said.some((s) => s.who) ? { paired: true as const } : {}),
    ...(reading.unread?.length ? { unread: reading.unread } : {}),
    ...(k.left.length ? { left: k.left } : {}),
  };
  return { kind: "image", title: imageTitle(input.name, k), origin: input.name, text: reading.text, ...(k.about ? { about: k.about } : {}), image };
}

async function look(store: OrgStore, hash: string, file: string, name: string, o: { emit?: (label: string) => void; signal?: AbortSignal }, deps: ImageDeps): Promise<KeptReading> {
  const reader = await deps.reader();
  const sees = deps.sees();
  if (!reader && !sees) throw new Error(NO_IMAGE_READER);
  const unread: NonNullable<SourceImage["unread"]> = [];
  let read: ShotRead | null = null;
  if (reader) {
    o.emit?.("Reading the words in it");
    read = sureLines((await deps.words(store.dir, [{ hash, file }])).get(hash));
  } else unread.push("no-reader");
  let answer: unknown = null;
  if (!sees) unread.push("no-vision");
  else {
    o.emit?.("Qalam AI is looking at it");
    try {
      const copy = await deps.prep(store.dir, hash, file, SEND_SIDE, "jpeg");
      const raw = await readFile(copy.file);
      const image: ShotImage = { mediaType: (/^image\/(png|jpeg|webp|gif)$/.test(copy.type) ? copy.type : "image/jpeg") as ShotImage["mediaType"], data: raw.toString("base64") };
      const { data, model } = await deps.call(imageCall({ name, image, words: read?.lines.map((l) => l.text).join("\n") ?? "" }), o.signal);
      answer = data;
      void store.putTrace({ id: nanoid(10), projectId: "images", kind: "image-read", at: Date.now(), ...(model ? { model } : {}), asset: hash, words: read?.lines.length ?? 0, answer: data } as { id: string; projectId: string }).catch(() => {});
    } catch (e) {
      if (isStop(e, o.signal)) throw e;
      console.warn(`[image] couldn't look at ${hash}: ${(e as Error).message}`);
      unread.push((e as { code?: string }).code === "no_vision" || /can't read pictures/i.test((e as Error).message) ? "no-vision" : "failed");
    }
  }
  const kept = sanitizeImage(answer, read);
  const text = imageText(read, kept);
  if (!text.trim() && !kept.about && !kept.reading.length) throw new Error(read ? "Nothing in it could be read or understood." : "Nothing printed on it could be read, and Qalam AI couldn't look at it.");
  return { v: IMAGE_VERSION, ...(read ? { w: read.w, h: read.h } : {}), kept, text, ...(unread.length ? { unread } : {}) };
}
