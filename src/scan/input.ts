import { postAddress } from "@/discovery/ingest/posts";
import type { ScanRequest, ScanTarget } from "./session";

/*
 * What's typed in the one box, read by code with no tokens (pure): an App Store link, a website, a
 * product's name or an idea. A wrong guess costs one click to correct (`otherReading`).
 */

const WEBSITE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;

export const isAppLink = (text: string) => {
  const t = text.trim();
  return /^https?:\/\/\S+$/i.test(t) && postAddress(t).kind === "appstore";
};

/** A website's name, as a product's: `linear.app` is Linear. */
function nameOfSite(text: string): string {
  const host = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`).hostname.replace(/^www\./i, "");
  const label = host.split(".")[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** A name more than a description: a word or two, capitalized (or one word in any script). */
const readsAsName = (text: string) => {
  const words = text.split(/\s+/);
  return !/[.!?؟]$/.test(text) && (words.length === 1 || (words.length <= 3 && words.every((w) => /^[\p{Lu}\d]/u.test(w))));
};

/** The longest a product's name is taken to be when someone says that's what they typed. */
const NAME_WORDS = 5;

/** What the box holds; null when it says nothing yet. */
export function scanInput(raw: string): ScanTarget | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 2) return null;
  if (isAppLink(text)) return { kind: "product", name: "", app: text };
  if (WEBSITE.test(text)) return { kind: "product", name: nameOfSite(text) };
  if (readsAsName(text)) return { kind: "product", name: text };
  return text.length >= 3 ? { kind: "idea", said: text } : null;
}

/** The same words read the other way: a product's name as an idea, or the other way round. A link has no other reading, and a sentence is no name. */
export function otherReading(t: ScanTarget, said: string): ScanTarget | null {
  const text = said.replace(/\s+/g, " ").trim();
  if (t.kind === "idea") return text.split(" ").length <= NAME_WORDS && !/[.!?؟]$/.test(text) ? { kind: "product", name: text } : null;
  return t.app || text.length < 3 ? null : { kind: "idea", said: text };
}

const clip =(s: string, max: number) => (s.length > max ? `${s.slice(0, max).replace(/\s+\S*$/, "")}` : s);

/**
 * A project's name with nothing else to go on (no engine to ask): a product's name, or an idea said in
 * a few words. A sentence about it isn't a name, so it's "My project" until they call it something
 * (the first read names it when it can, `nameAfterRead`). Theirs to change either way.
 */
export const projectName = (t: ScanTarget): string => {
  if (t.kind === "product") return t.name || "My product";
  const short = t.said.replace(/^(an?|the)\s+/i, "").trim();
  return short && short.split(/\s+/).length <= NAME_WORDS && !/[.!?؟]\s*\S/.test(short) ? clip(short.replace(/^./, (c) => c.toUpperCase()), 48) : "My project";
};

// Countries an idea may name, to look in the right App Store.
const PLACES: [RegExp, string][] = [
  [/\b(saudi|ksa|riyadh|jeddah)\b|السعودية|الرياض|جدة/i, "sa"],
  [/\b(uae|emirates|dubai|abu dhabi)\b|الإمارات|دبي/i, "ae"],
  [/\b(egypt|cairo|alexandria)\b|مصر|القاهرة/i, "eg"],
  [/\b(jordan|amman)\b|الأردن/i, "jo"],
  [/\b(kuwait)\b|الكويت/i, "kw"],
  [/\b(qatar|doha)\b|قطر/i, "qa"],
  [/\b(uk|britain|london)\b/i, "gb"],
  [/\b(india)\b/i, "in"],
  [/\b(canada)\b/i, "ca"],
  [/\b(australia)\b/i, "au"],
  [/\b(germany)\b/i, "de"],
  [/\b(france)\b/i, "fr"],
];

/** Which App Store to look in: the country their words name, else their computer's region, else the US. */
export function scanCountry(said: string, locale = ""): string {
  const named = PLACES.find(([re]) => re.test(said))?.[1];
  if (named) return named;
  const region = /[-_]([a-z]{2})\b/i.exec(locale)?.[1]?.toLowerCase();
  return region ?? "us";
}

/** The request the box's words make. */
export function requestOf(target: ScanTarget, said: string, locale = ""): ScanRequest {
  return { target, country: scanCountry(said, locale) };
}

/** Words that plainly say there's no idea yet: no call needed. */
export const saysNoIdea = (said: string) => /^(?:no idea|none|nothing|idk|dunno|not sure|anything|i (?:don'?t|do not) know|i have no idea|i'?m not sure)(?:\b|$)[\s\S]{0,30}$/i.test(said.trim());

/** How a first answer was read: whether it names anything to read about, a product's own name, and what to call the project. */
export interface FirstRead {
  named: boolean;
  /** A product's own name, as they wrote it. */
  product: string;
  /** What to call the project; empty: nothing to go on. */
  name: string;
}

/** Read with no call: nothing to go on, so it reads as asked. */
export const NOT_READ: FirstRead = { named: true, product: "", name: "" };

/**
 * What code keeps of the small call's reading. Nothing to read about only when it says so, since
 * reading is what they asked for. A product's name only as they wrote it. A name is a label of a few
 * words, never a sentence, with no figure they didn't write; it's theirs to change once it's made.
 */
export function sanitizeFirstRead(raw: unknown, said: string): FirstRead {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const named = r.said !== "none";
  const text = said.toLowerCase();
  const tidy = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").replace(/^["“'‘]+|["”'’.。]+$/g, "").trim() : "");
  const product = tidy(r.product);
  const name = tidy(r.name);
  const figures = (s: string) => s.match(/\p{Nd}+/gu) ?? [];
  const nameHolds = !!name && name.length <= 48 && name.split(" ").length <= NAME_WORDS && !/[.!?؟]\s*\S/.test(name) && figures(name).every((n) => said.includes(n));
  return {
    named,
    product: named && product && product.length <= 60 && text.includes(product.toLowerCase()) ? product : "",
    name: named && nameHolds ? name : "",
  };
}
