import { normalizeForMatch } from "@/discovery/quotes";
import type { SeenText, Shot } from "./types";

/*
 * What code works out about a batch of screenshots before Qalam AI places them (pure, no tokens):
 * the order they were taken in, the pairs that look like one screen in two states (their pictures
 * close, or most of their words the same), the navigation that repeats across them, and whether
 * they're a phone's, a tablet's or a desktop's. Qalam AI hears these as hints; code holds a grouping
 * to them (src/seen/place.ts).
 */

const pad = (n: string) => n.padStart(2, "0");

/**
 * When a screenshot was taken, from its file's name as phones, Macs and simulators write it
 * ("Screenshot 2026-10-29 at 10.12.33", "Screen Shot 2020-05-01 at 1.02.03 PM", "Simulator
 * Screenshot - iPhone 17 - 2026-10-29 at 10.12.33", "Screenshot_20261029-101233"), as a number
 * that sorts; else its sequence ("IMG_1234"); else null.
 */
export function takenAt(name: string): { at?: number; seq?: number } {
  const mac = /(\d{4})-(\d{2})-(\d{2}) at (\d{1,2})[.:](\d{2})[.:](\d{2})(?:\s*([AP]M))?/i.exec(name);
  if (mac) {
    let h = Number(mac[4]);
    if (mac[7]?.toUpperCase() === "PM" && h < 12) h += 12;
    if (mac[7]?.toUpperCase() === "AM" && h === 12) h = 0;
    return { at: Number(`${mac[1]}${mac[2]}${mac[3]}${pad(String(h))}${mac[5]}${mac[6]}`) };
  }
  const android = /(\d{4})-?(\d{2})-?(\d{2})[-_ ](\d{2})-?(\d{2})-?(\d{2})/.exec(name);
  if (android) return { at: Number(android.slice(1, 7).join("")) };
  const seq = /(?:IMG|Screenshot|Screen Shot|Simulator)[\s_-]*(\d{2,})/i.exec(name);
  return seq ? { seq: Number(seq[1]) } : {};
}

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The screenshots in the order they were taken: by the time in their names, then their sequence, then when their files changed, then their names. */
export function takenOrder(shots: Shot[]): string[] {
  const keyed = shots.map((s, i) => ({ s, i, ...takenAt(s.name) }));
  const cmp = (a: (typeof keyed)[number], b: (typeof keyed)[number]) => {
    if (a.at !== undefined && b.at !== undefined && a.at !== b.at) return a.at - b.at;
    if (a.seq !== undefined && b.seq !== undefined && a.seq !== b.seq) return a.seq - b.seq;
    if (a.s.modified !== undefined && b.s.modified !== undefined && a.s.modified !== b.s.modified) return a.s.modified - b.s.modified;
    return natural.compare(a.s.name, b.s.name) || a.i - b.i;
  };
  return [...keyed].sort(cmp).map((k) => k.s.ref);
}

/** How many of two 64-bit difference hashes' bits differ (64 when either is missing). */
export function hashDistance(a: string | undefined, b: string | undefined): number {
  if (!a || !b || !/^[0-9a-f]{16}$/i.test(a) || !/^[0-9a-f]{16}$/i.test(b)) return 64;
  let d = 0;
  for (let i = 0; i < 16; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    for (; x; x >>= 1) d += x & 1;
  }
  return d;
}

/** A screenshot's words, normalized, three letters or more, once each. */
export function wordsOn(t: SeenText | undefined): Set<string> {
  if (!t) return new Set();
  return new Set(
    normalizeForMatch(t.lines.map((l) => l.text).join(" "))
      .norm.split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3),
  );
}

/** How much two screenshots' words are the same: shared over all (0..1). */
export function wordOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

/** Pictures this close (bits of 64) look like one screen. */
export const NEAR_HASH = 10;
/** Words this much the same look like one screen. */
export const NEAR_WORDS = 0.6;

export interface NearPair {
  a: string;
  b: string;
  /** Bits of the pictures' hashes that differ. */
  distance: number;
  /** How much of their words are the same. */
  overlap: number;
}

/** Whether two screenshots look like one screen, by their pictures or their words. */
export const looksSame = (p: Pick<NearPair, "distance" | "overlap">) => p.distance <= NEAR_HASH || p.overlap >= NEAR_WORDS;

/** Every pair that looks like one screen in two states, closest first. */
export function nearPairs(texts: Map<string, SeenText | undefined>): NearPair[] {
  const refs = [...texts.keys()];
  const words = new Map(refs.map((r) => [r, wordsOn(texts.get(r))]));
  const out: NearPair[] = [];
  for (let i = 0; i < refs.length; i++)
    for (let j = i + 1; j < refs.length; j++) {
      const p = { a: refs[i], b: refs[j], distance: hashDistance(texts.get(refs[i])?.dhash, texts.get(refs[j])?.dhash), overlap: wordOverlap(words.get(refs[i])!, words.get(refs[j])!) };
      if (looksSame(p)) out.push(p);
    }
  return out.sort((x, y) => x.distance - y.distance || y.overlap - x.overlap);
}

/**
 * Navigation that repeats: short lines in the same place (the top or the bottom of the screen) on
 * at least three screenshots and a third of them, as the screens show them.
 */
export function sharedNav(texts: (SeenText | undefined)[]): string[] {
  const read = texts.filter((t): t is SeenText => !!t);
  if (read.length < 3) return [];
  const seen = new Map<string, { label: string; on: Set<number> }>();
  read.forEach((t, i) => {
    for (const l of t.lines) {
      const [, y, , h] = l.box;
      const label = l.text.trim();
      if (!label || label.length > 20 || (y > 0.12 && y + h < 0.88)) continue;
      const key = `${normalizeForMatch(label).norm}|${y < 0.5 ? "top" : "bottom"}`;
      const e = seen.get(key) ?? { label, on: new Set<number>() };
      e.on.add(i);
      seen.set(key, e);
    }
  });
  const need = Math.max(3, Math.ceil(read.length / 3));
  return [...seen.values()].filter((e) => e.on.size >= need).map((e) => e.label);
}

export type Platform = "phone" | "tablet" | "desktop";

/** What a screenshot was taken on, from its shape. */
export function platformOf(w: number, h: number): Platform {
  if (!w || !h) return "phone";
  if (h / w >= 1.6) return "phone";
  if (w / h >= 1.4) return "desktop";
  return "tablet";
}
