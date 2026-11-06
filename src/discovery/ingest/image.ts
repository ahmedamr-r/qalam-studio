import { normalizeForMatch } from "../quotes";
import { IMAGE_SHOWS, type ImageShows, type SourceImage } from "../sources";
import type { ShotRead } from "@/seen/shot";
import { noteLine, onScreen, personal } from "@/seen/words";
import { scanText } from "./pictures";

/*
 * A picture someone added, as code keeps what Qalam AI said of it (pure; server/image.ts reads it).
 * Its text is only the words this Mac read printed on it: that's what quotes are found in. Qalam
 * AI's reading (what it shows, what's in it) is kept beside it as its reading: a quoted word or a
 * number in it stays only where the picture prints it, and a product's name or what someone said
 * only as printed, in the picture's own spelling. Off a Mac nothing can be checked against print, so
 * nothing printed is claimed: the reading is kept as a description, and its text is empty.
 */

export const IMAGE_LIMITS = { reading: 4, line: 300, about: 400, said: 40, words: 1500, who: 80, product: 60, confidence: 0.5, title: 60 } as const;

/** The printed lines this Mac is sure enough of to check anything against. */
export const sureLines = (r: ShotRead | null | undefined): ShotRead | null => (r ? { ...r, lines: r.lines.filter((l) => l.conf >= IMAGE_LIMITS.confidence && l.text.trim()) } : null);

export interface KeptImage {
  shows: ImageShows;
  about?: string;
  reading: string[];
  product?: string;
  said: { who?: string; words: string }[];
  left: { said: string; why: string }[];
}

const one = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown) => (Array.isArray(v) ? v : []);

/**
 * What code keeps of Qalam AI's look at a picture. `read`: the words this Mac read off it (null: no
 * reader here, so nothing printed can be checked and none is claimed).
 */
export function sanitizeImage(raw: unknown, read: ShotRead | null): KeptImage {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const shows = IMAGE_SHOWS.includes(a.shows as ImageShows) ? (a.shows as ImageShows) : "other";
  const left: KeptImage["left"] = [];
  const lineOf = (v: unknown, max: number): string | null => {
    const text = one(v, max);
    if (!text) return null;
    if (personal(text)) return void left.push({ said: text, why: "It carries someone's email address or phone number" }), null;
    // With what's printed to check against, a quoted word or a number must be printed. Without it the
    // description stays, its quote marks taken off: nothing in it is claimed as the picture's own words.
    const kept = read ? noteLine(text, [read], "", max) : text.replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();
    if (!kept) left.push({ said: text, why: "Its quoted words or numbers aren't printed on the picture" });
    return kept || null;
  };
  const about = lineOf(a.about, IMAGE_LIMITS.about);
  const reading = list(a.reading)
    .slice(0, IMAGE_LIMITS.reading)
    .map((l) => lineOf(l, IMAGE_LIMITS.line))
    .filter((l): l is string => !!l);
  const named = one(a.product, IMAGE_LIMITS.product);
  const product = named && read ? onScreen(named, read, IMAGE_LIMITS.product) : null;
  if (named && !product) left.push({ said: named, why: read ? "That name isn't printed on the picture" : "Whether it's printed couldn't be checked here" });
  const said: KeptImage["said"] = [];
  for (const s of list(a.said).slice(0, IMAGE_LIMITS.said)) {
    const r = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const words = one(r.words, IMAGE_LIMITS.words);
    if (!words) continue;
    const printed = read ? onScreen(words, read, IMAGE_LIMITS.words) : null;
    if (!printed || personal(printed)) {
      left.push({ said: words, why: !read ? "Whether it's printed couldn't be checked here" : printed ? "It carries someone's email address or phone number" : "Those words aren't printed on the picture" });
      continue;
    }
    const name = one(r.who, IMAGE_LIMITS.who);
    const who = name && read ? onScreen(name, read, IMAGE_LIMITS.who) : null;
    said.push({ ...(who && !personal(who) ? { who } : {}), words: printed });
  }
  return { shows, ...(about ? { about } : {}), reading, ...(product ? { product } : {}), said, left };
}

/**
 * The picture's text: what people said in it, paired as Qalam AI read it ("Who: words"), then the
 * printed lines no one's words cover, shaped as a scanned page's are. Empty with nothing printed.
 */
export function imageText(read: ShotRead | null, kept: Pick<KeptImage, "said">): string {
  if (!read?.lines.length) return "";
  const said = kept.said.map((s) => (s.who ? `${s.who}: ${s.words}` : s.words));
  const covered = kept.said.map((s) => normalizeForMatch(s.words).norm);
  const rest = read.lines.filter((l) => {
    const n = normalizeForMatch(l.text).norm;
    return !covered.some((c) => c.includes(n)) && !kept.said.some((s) => s.who && normalizeForMatch(s.who).norm === n);
  });
  const printed = rest.length ? scanText({ ...read, lines: rest }).text : "";
  return [said.join("\n"), printed].filter((x) => x.trim()).join("\n\n");
}

/** A camera's or a screenshot tool's name says nothing: such a picture takes its name from what it shows. */
const GENERIC = /^(img|image|photo|pxl|dsc|screenshot|screen shot|capture|cleanshot|scr)[\s_-]?[\d\s._:at-]*$|^[\d\s._-]+$/i;

export function imageTitle(name: string, kept: Pick<KeptImage, "about" | "product" | "shows">): string {
  const stem = name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_]+/g, " ").trim();
  if (stem && !GENERIC.test(stem)) return stem.slice(0, 160);
  const first = kept.about?.split(/(?<=[.!?])\s/)[0]?.replace(/[.!?]$/, "") ?? "";
  if (first) return first.length > IMAGE_LIMITS.title ? `${first.slice(0, IMAGE_LIMITS.title).replace(/\s+\S*$/, "")}…` : first;
  return kept.product ? `${kept.product} picture` : "Picture";
}

/** A picture's record as it came in from a window (the capture route), or null. */
export function imageFrom(raw: unknown): SourceImage | null {
  const i = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!i || typeof i.asset !== "string" || !/^[0-9a-f]{24}$/.test(i.asset) || typeof i.type !== "string" || !/^image\/(png|jpeg|webp|gif|heic|heif)$/.test(i.type)) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined);
  const lines = (v: unknown, max: number, count: number) =>
    list(v)
      .map((x) => one(x, max))
      .filter(Boolean)
      .slice(0, count);
  const unread = list(i.unread).filter((u): u is "no-reader" | "no-vision" | "failed" => u === "no-reader" || u === "no-vision" || u === "failed");
  const left = list(i.left)
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .map((x) => ({ said: one(x.said, IMAGE_LIMITS.words), why: one(x.why, 200) }))
    .filter((x) => x.said && x.why)
    .slice(0, 40);
  const w = n(i.w);
  const h = n(i.h);
  const product = one(i.product, IMAGE_LIMITS.product);
  return {
    asset: i.asset,
    type: i.type,
    ...(w ? { w } : {}),
    ...(h ? { h } : {}),
    shows: IMAGE_SHOWS.includes(i.shows as ImageShows) ? (i.shows as ImageShows) : "other",
    reading: lines(i.reading, IMAGE_LIMITS.line, IMAGE_LIMITS.reading),
    ...(product ? { product } : {}),
    ...(i.paired === true ? { paired: true } : {}),
    ...(unread.length ? { unread } : {}),
    ...(left.length ? { left } : {}),
  };
}

/** What a picture's reader says above its words, about what it is and what couldn't be read. */
export function imageUnreadLine(img: Pick<SourceImage, "unread">, hasText: boolean): string | null {
  const u = img.unread ?? [];
  if (u.includes("no-reader")) return "No words in it could be checked on this computer, so nothing in it can back a card. Qalam AI's reading is a description.";
  if (u.includes("no-vision")) return "The engine here can't look at pictures, so only its printed words were read.";
  if (u.includes("failed")) return "Qalam AI couldn't look at it this time, so only its printed words were read.";
  return hasText ? null : "Nothing printed on it could be read, so nothing in it can back a card.";
}
