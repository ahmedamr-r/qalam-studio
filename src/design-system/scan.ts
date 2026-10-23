import type { ScanCandidate, ScanComponent, ScanFetch, ScanQuestion, ScanResult } from "@/ai/ds-schemas";
import { COMPONENT_NAMES } from "./components";
import { MAX_PATTERNS, sameName } from "./extract-options";

/**
 * The first look at the screenshots, checked by code before the designer sees it: the model
 * names what it sees; the studio keeps only catalog names, merges duplicates, clamps numbers,
 * drops "new components" that are really catalog ones and questions that can't be answered.
 */

/** Catalog components the first look can report (Stack and Text are on every screen). */
export const SCAN_COMPONENTS = COMPONENT_NAMES.filter((n) => n !== "Stack" && n !== "Text");
export const MAX_SCAN_QUESTIONS = 2;
const FETCH: ScanFetch[] = ["tokens", "components", "extended"];

const text = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

function imageList(v: unknown, images: number): number[] {
  const out = (Array.isArray(v) ? v : [])
    .map((n) => Math.round(Number(n)))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= images);
  return [...new Set(out)].sort((a, b) => a - b);
}

const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);

export interface ScanContext {
  /** How many screenshots were sent. */
  images: number;
  /** What the studio read from each capture's size. */
  kinds: ("phone" | "desktop")[];
}

export function sanitizeScan(raw: unknown, ctx: ScanContext): ScanResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = Math.max(1, ctx.images);

  const byName = new Map<string, ScanComponent>();
  for (const c of arr(r.components)) {
    const name = SCAN_COMPONENTS.find((x) => x.toLowerCase() === text(c.name, 40).toLowerCase());
    if (!name) continue;
    const count = Math.min(99, Math.max(1, Math.round(Number(c.count)) || 1));
    const images = imageList(c.images, n);
    const prev = byName.get(name);
    if (prev) {
      prev.count = Math.max(prev.count, count);
      prev.images = [...new Set([...prev.images, ...images])].sort((a, b) => a - b);
      if (!prev.evidence) prev.evidence = text(c.evidence, 140);
    } else byName.set(name, { name, images, count, evidence: text(c.evidence, 140) });
  }
  // Catalog order, so the list reads the same way every time.
  const components = SCAN_COMPONENTS.filter((c) => byName.has(c)).map((c) => byName.get(c)!);

  const candidates: ScanCandidate[] = [];
  for (const c of arr(r.candidates)) {
    const name = text(c.name, 40);
    if (!name || COMPONENT_NAMES.some((x) => sameName(x, name)) || candidates.some((x) => sameName(x.name, name))) continue;
    candidates.push({ name, description: text(c.description, 160), images: imageList(c.images, n) });
    if (candidates.length >= MAX_PATTERNS) break;
  }

  const questions: ScanQuestion[] = [];
  for (const q of arr(r.questions)) {
    const t = text(q.text, 200);
    const options: string[] = [];
    for (const o of Array.isArray(q.options) ? q.options : []) {
      const t = text(o, 60);
      if (t && !options.some((x) => x.toLowerCase() === t.toLowerCase())) options.push(t);
    }
    options.splice(4);
    if (!t || options.length < 2) continue;
    const rec = text(q.recommended, 60);
    questions.push({ id: `ai-${questions.length + 1}`, text: t, why: text(q.why, 200), options, recommended: options.includes(rec) ? rec : "" });
    if (questions.length >= MAX_SCAN_QUESTIONS) break;
  }

  const rec = (r.recommendation && typeof r.recommendation === "object" ? r.recommendation : {}) as Record<string, unknown>;
  let fetch: ScanFetch = FETCH.includes(rec.fetch as ScanFetch) ? (rec.fetch as ScanFetch) : components.length ? "components" : "tokens";
  if (!components.length) fetch = "tokens";

  // Measured beats named: phone captures are mobile; a desktop capture isn't.
  const said = r.platform === "web" || r.platform === "dashboard" || r.platform === "app" ? r.platform : "mobile";
  const phones = ctx.kinds.length > 0 && ctx.kinds.every((k) => k === "phone");
  const desktops = ctx.kinds.length > 0 && ctx.kinds.every((k) => k === "desktop");
  const platform = phones ? "mobile" : desktops && said === "mobile" ? "web" : said;

  return {
    product: text(r.product, 60),
    platform,
    look: text(r.look, 280),
    components,
    candidates,
    recommendation: { fetch, why: text(rec.why, 240) },
    questions,
  };
}
