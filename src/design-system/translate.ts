import type { Inst, ScreenSpec } from "./builders";
import { CATALOG_BY_NAME, type PropSpec } from "./components";
import { CUSTOM } from "./custom";
import type { ComponentDef } from "./docs";

/*
 * Copy and direction: when a screen switches between left-to-right and right-to-left, its copy
 * should switch language too (English ↔ Arabic). Code decides what needs translating (the script
 * each string is written in) and where every string lives (spec props, text layers); the model
 * only translates. Strings already in the target language never reach it.
 */

export type Lang = "en" | "ar";

export const LANG_NAME: Record<Lang, string> = { en: "English", ar: "Arabic" };

/** The language that goes with a direction. */
export const langForDir = (dir: "ltr" | "rtl"): Lang => (dir === "rtl" ? "ar" : "en");

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LATIN_WORD = /[A-Za-z]{2,}/g;
/** Latin words that stay as they are in Arabic copy too: currency codes. (Units are words in Arabic: "27 min" is "27 دقيقة".) */
const CODES = new Set(["aed", "usd", "sar", "egp", "eur", "gbp", "kwd", "qar", "omr", "bhd", "jod", "pkr", "inr"]);
const URLISH = /^\s*(https?:\/\/|www\.|[\w.+-]+@[\w-]+\.[\w.]+\s*$)/i;

/** Whether a string is written in the other language and needs translating into `to`. */
export function needsTranslation(text: string, to: Lang): boolean {
  // Placeholders ({holder}) are filled in later: only the words around them count.
  const bare = text.replace(/\{[^{}]*\}/g, "");
  if (!bare.trim() || URLISH.test(bare)) return false;
  if (to === "en") return ARABIC.test(bare);
  if (ARABIC.test(bare)) return false;
  return (bare.match(LATIN_WORD) ?? []).some((w) => !CODES.has(w.toLowerCase()));
}

/** Where a string lives, for the model's context ("Button.label") and its length budget. */
export interface CopyPlace {
  where: string;
  maxChars?: number;
}

type MapFn = (text: string, place: CopyPlace) => string;

function mapProp(p: PropSpec | undefined, v: unknown, where: string, fn: MapFn): unknown {
  if (!p) return v;
  if (p.type === "string" && typeof v === "string") return fn(v, { where, maxChars: p.maxChars });
  if (p.type === "strings" && Array.isArray(v)) return v.map((s) => (typeof s === "string" ? fn(s, { where, maxChars: p.maxChars }) : s));
  if (p.type === "items" && Array.isArray(v))
    return v.map((item) => {
      if (!item || typeof item !== "object") return item;
      const out: Record<string, unknown> = { ...(item as Record<string, unknown>) };
      for (const [k, f] of Object.entries(p.fields)) if (k in out) out[k] = mapProp(f, out[k], `${where}.${k}`, fn);
      return out;
    });
  return v;
}

function mapInst(inst: Inst, fn: MapFn, defs: Map<string, ComponentDef>): Inst {
  if (!inst || typeof inst !== "object") return inst;
  const out: Inst = { ...inst };
  if (inst.props) {
    const props: Record<string, unknown> = { ...inst.props };
    if (inst.component === CUSTOM) {
      // A component of the system or of the screen: only the values are copy (not its name or prop names).
      const def = defs.get(String(props.name));
      if (Array.isArray(props.values))
        props.values = props.values.map((v) => {
          if (!v || typeof v !== "object") return v;
          const { prop, value } = v as { prop?: unknown; value?: unknown };
          const decl = def?.props?.find((p) => p.name === prop);
          if (typeof value !== "string" || decl?.kind === "icon") return v;
          return { ...v, value: fn(value, { where: `${String(props.name)}.${String(prop)}`, maxChars: decl?.maxChars }) };
        });
    } else {
      const spec = CATALOG_BY_NAME.get(inst.component);
      for (const [k, v] of Object.entries(props)) props[k] = mapProp(spec?.props[k], v, `${inst.component}.${k}`, fn);
    }
    out.props = props;
  }
  if (inst.children) out.children = inst.children.map((c) => mapInst(c, fn, defs));
  return out;
}

/**
 * The spec with `fn` applied to every string it shows: catalog props by their declared types
 * (not icons, option values, pictures or path data), Custom instances' values, and the copy of the
 * components made for the screen (their compositions and examples).
 */
export function mapSpecCopy(spec: ScreenSpec, fn: MapFn): ScreenSpec {
  const defs = new Map((spec.components ?? []).map((d) => [d.name, d]));
  const out: ScreenSpec = { ...spec };
  for (const region of ["header", "sidebar", "hero", "body", "footer"] as const) {
    const list = spec[region];
    if (Array.isArray(list)) out[region] = list.map((i) => mapInst(i, fn, defs));
  }
  if (spec.components)
    out.components = spec.components.map((d) => ({
      ...d,
      composition: mapInst(d.composition, fn, defs),
      props: d.props?.map((p) => (p.kind === "text" ? { ...p, example: fn(p.example, { where: `${d.name}.${p.name}`, maxChars: p.maxChars }) } : p)),
    }));
  return out;
}

/** Every string a spec shows, with where it lives. */
export function specCopy(spec: ScreenSpec): (CopyPlace & { text: string })[] {
  const out: (CopyPlace & { text: string })[] = [];
  mapSpecCopy(spec, (text, place) => {
    out.push({ text, ...place });
    return text;
  });
  return out;
}

/** One string for the model: the same text used in several places is translated once. */
export interface TranslationUnit {
  id: string;
  text: string;
  /** Where it's used, e.g. "Button.label · Lumen home". */
  where: string;
  maxChars?: number;
  /** A translation the studio measured as too long, sent back to be shortened. */
  previous?: string;
}

/** The strings that need translating into `to`, each once, with the tightest length budget it has. */
export function translationUnits(found: (CopyPlace & { text: string })[], to: Lang): TranslationUnit[] {
  const byText = new Map<string, TranslationUnit>();
  for (const f of found) {
    if (!needsTranslation(f.text, to)) continue;
    const u = byText.get(f.text);
    if (!u) byText.set(f.text, { id: `t${byText.size + 1}`, text: f.text, where: f.where, ...(f.maxChars ? { maxChars: f.maxChars } : {}) });
    else if (f.maxChars && (!u.maxChars || f.maxChars < u.maxChars)) u.maxChars = f.maxChars;
  }
  return [...byText.values()];
}

/** The spec in another language and direction: translated strings swapped in (others kept). */
export function translateSpec(spec: ScreenSpec, map: Map<string, string>, dir: "ltr" | "rtl", lang: Lang): ScreenSpec {
  return { ...mapSpecCopy(spec, (t) => map.get(t) ?? t), dir, lang };
}
