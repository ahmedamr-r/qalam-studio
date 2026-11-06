import { isBasis } from "@/discovery/basis";
import type { Ingested } from "@/discovery/ingest/core";
import type { SetupDoc } from "@/org/setup";
import { scanRequest } from "@/scan/session";
import type { StartTurn, Whose } from "./start";

/*
 * What the start page's box hands the new project's canvas (pure): its turns, whose it is, the docs
 * read in the window and the pictures kept as the project's assets. The page that makes the project
 * leaves for its canvas (a full load), so it's kept in the project (.qalam/start.json) and taken once.
 */

export type HandedDoc = Omit<SetupDoc, "span" | "cut"> & { ingested: Ingested };

export interface HandedImage {
  asset: string;
  title: string;
  type: string;
  at?: string;
}

export interface StartHandoff {
  v: 1;
  turns: StartTurn[];
  whose: Whose;
  docs: HandedDoc[];
  images: HandedImage[];
}

export const HANDOFF_LIMITS = { docs: 20, images: 6, said: 100_000 } as const;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);
const ASSET = /^[0-9a-f]{24}$/;
const PICTURE_TYPE = /^image\/(png|jpeg|webp|gif|heic|heif)$/;

function turnOf(raw: unknown): StartTurn | null {
  const t = rec(raw);
  const said = str(t.said, HANDOFF_LIMITS.said);
  if (said === null) return null;
  if (t.mode === "take" || t.mode === "dump") return { mode: t.mode, said };
  if (t.mode !== "scan") return null;
  const target = scanRequest({ target: t.target, country: "us" })?.target;
  return target ? { mode: "scan", said, target } : null;
}

function whoseOf(raw: unknown): Whose {
  const w = rec(raw);
  const ask: Pick<Whose, "ask"> = w.ask === "product" || w.ask === "shape" ? { ask: w.ask } : {};
  return { shape: w.shape === "team" ? "team" : "solo", mine: w.mine === true, sure: w.sure === true, ...ask };
}

function docOf(raw: unknown, ingested: (raw: unknown) => Ingested | null): HandedDoc | null {
  const d = rec(raw);
  const from = str(d.from, 80);
  const title = str(d.title, 160);
  const ing = ingested(d.ingested);
  if (!from || !title || !ing) return null;
  const opt = (k: string, max: number) => (str(d[k], max) ? { [k]: d[k] as string } : {});
  return {
    from,
    title,
    ...opt("origin", 2000),
    ...opt("type", 40),
    ...opt("at", 40),
    ...(typeof d.pages === "number" && d.pages > 0 ? { pages: Math.floor(d.pages) } : {}),
    ...(d.voice === "customers" || d.voice === "own" ? { voice: d.voice } : {}),
    ...(isBasis(d.basis) ? { basis: d.basis } : {}),
    ingested: ing,
  };
}

function imageOf(raw: unknown): HandedImage | null {
  const i = rec(raw);
  const asset = str(i.asset, 24);
  const title = str(i.title, 160);
  const type = str(i.type, 20);
  if (!asset || !ASSET.test(asset) || !title || !type || !PICTURE_TYPE.test(type)) return null;
  return { asset, title, type, ...(str(i.at, 40) ? { at: i.at as string } : {}) };
}

/** A hand-off as it came in, or null. `ingested` checks a doc's words as the capture route does. */
export function handoffOf(raw: unknown, ingested: (raw: unknown) => Ingested | null): StartHandoff | null {
  const h = rec(raw);
  if (h.v !== 1 || !Array.isArray(h.turns)) return null;
  const turns = h.turns.map(turnOf);
  if (!turns.length || turns.some((t) => !t)) return null;
  const docs = (Array.isArray(h.docs) ? h.docs : []).slice(0, HANDOFF_LIMITS.docs).map((d) => docOf(d, ingested));
  const images = (Array.isArray(h.images) ? h.images : []).slice(0, HANDOFF_LIMITS.images).map(imageOf);
  if (docs.some((d) => !d) || images.some((i) => !i)) return null;
  return { v: 1, turns: turns as StartTurn[], whose: whoseOf(h.whose), docs: docs as HandedDoc[], images: images as HandedImage[] };
}
