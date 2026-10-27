/**
 * Decision traces (pure): what a request was given, and the facts the model says it relied on.
 * The model proposes, code checks: an id the request didn't send is dropped, so the hub never
 * shows a reason that wasn't really there.
 */
import { ASSUMED_TOPICS, MAX_ASSUMED, MAX_RELIED } from "@/ai/reliance";
import type { DsFact } from "./facts";
import { factHash, ref } from "./refs";
import type { DecisionTrace, ReliedOn } from "./types";

/** One fact a request sent, under the id the prompt showed it with. */
export interface ManifestEntry {
  short: string;
  ref: string;
  hash: string;
  text: string;
}

export interface Manifest {
  entries: ManifestEntry[];
  byShort: Map<string, ManifestEntry>;
}

export function mergeManifest(...parts: (ManifestEntry[] | undefined)[]): Manifest {
  const entries: ManifestEntry[] = [];
  const byShort = new Map<string, ManifestEntry>();
  for (const part of parts)
    for (const e of part ?? []) {
      if (byShort.has(e.short)) continue;
      byShort.set(e.short, e);
      entries.push(e);
    }
  return { entries, byShort };
}

export const entry = (short: string, r: string, text: string): ManifestEntry => ({ short, ref: r, hash: factHash(text), text: text.slice(0, 600) });

/** A system's facts that went into the prompt. */
export const dsEntries = (systemId: string, facts: DsFact[]): ManifestEntry[] => facts.filter((f) => f.sent && f.short).map((f) => entry(f.short!, ref.ds(systemId, f.key), f.text));

/** Research notes handed to the model ([r1]). */
export const researchEntries = (turnId: string, notes: string | undefined): ManifestEntry[] => (notes?.trim() ? [entry("r1", ref.research(turnId), notes)] : []);

const ID = /^\[?\s*([a-z])\s*(\d{1,4})\s*\]?$/i;
const IDS_IN_TEXT = /\s*\[(?:[dbqcrpk]\d{1,4})(?:\s*,\s*[dbqcrpk]?\d{1,4})*\]/gi;

/** Take the ids a model might have written into prose out again ("Keep it calm [d12]" → "Keep it calm"). */
export const stripFactIds = (s: string) => s.replace(IDS_IN_TEXT, "").replace(/\s{2,}/g, " ").trim();

/** The relied-on list as checked: known ids only, each once, a short reason each, at most eight. */
export function sanitizeReliance(raw: unknown, m: Manifest, max = MAX_RELIED): ReliedOn[] {
  if (!Array.isArray(raw)) return [];
  const out: ReliedOn[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { id, why } = item as { id?: unknown; why?: unknown };
    const mm = typeof id === "string" ? ID.exec(id.trim()) : null;
    if (!mm) continue;
    const e = m.byShort.get(`${mm[1].toLowerCase()}${Number(mm[2])}`);
    if (!e || seen.has(e.ref)) continue;
    seen.add(e.ref);
    out.push({ ref: e.ref, why: stripFactIds(typeof why === "string" ? why : "").slice(0, 200), text: e.text });
    if (out.length >= max) break;
  }
  return out;
}

/** The model's guesses as kept: known topics, one short sentence each, no ids, at most four. */
export function sanitizeAssumed(raw: unknown): { topic: string; guess: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { topic: string; guess: string }[] = [];
  for (const item of raw) {
    const { topic, guess } = (item ?? {}) as { topic?: unknown; guess?: unknown };
    if (typeof topic !== "string" || !(ASSUMED_TOPICS as readonly string[]).includes(topic) || typeof guess !== "string") continue;
    const g = stripFactIds(guess).slice(0, 200);
    if (g && !out.some((o) => o.guess === g)) out.push({ topic, guess: g });
    if (out.length >= MAX_ASSUMED) break;
  }
  return out;
}

/** What a trace stores of the manifest: each fact once, by ref, with the hash of what was sent. */
export const givenOf = (m: Manifest): [string, string][] => {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const e of m.entries) {
    if (seen.has(e.ref)) continue;
    seen.add(e.ref);
    out.push([e.ref, e.hash]);
  }
  return out;
};

/** A critique session's next call: everything given so far, and the latest reason for each fact. */
export function mergeTrace(a: Pick<DecisionTrace, "given" | "reliedOn">, b: Pick<DecisionTrace, "given" | "reliedOn">): Pick<DecisionTrace, "given" | "reliedOn"> {
  const given = new Map(a.given);
  for (const [r, h] of b.given) given.set(r, h);
  const relied = new Map(a.reliedOn.map((x) => [x.ref, x]));
  for (const x of b.reliedOn) relied.set(x.ref, x);
  return { given: [...given.entries()], reliedOn: [...relied.values()].slice(0, MAX_RELIED * 2) };
}
