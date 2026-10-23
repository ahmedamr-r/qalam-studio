/**
 * Editing a design-system fact from the hub (pure): find the list item or slot a fact key names,
 * and write new words there. A list item's key is a hash of its text, so the edited item gets a
 * new key; the caller records `editedFrom` so old decisions still find it.
 */
import type { DesignDocs } from "@/design-system/docs";
import { listKeys } from "./refs";

const LISTS = {
  "lang.dos": (d: DesignDocs) => (d.language.dos ??= []),
  "lang.donts": (d: DesignDocs) => (d.language.donts ??= []),
  "layout.rules": (d: DesignDocs) => (d.layout.rules ??= []),
} as const;
type ListPrefix = keyof typeof LISTS;

const LANG_SLOTS = new Set(["summary", "color", "typography", "shape", "depth", "density", "iconography", "imagery", "voice"]);
const LAYOUT_SLOTS = new Set(["summary", "grid", "rhythm", "navigation", "hierarchy"]);

/** A list item (by prefix and position) or a slot (by section and field), or null when the key isn't editable here. */
export function locateDsFact(docs: DesignDocs, key: string): { prefix: ListPrefix; index: number } | { section: "language" | "layout"; field: string } | null {
  const hash = key.indexOf("#");
  if (hash > 0) {
    const prefix = key.slice(0, hash) as ListPrefix;
    if (!(prefix in LISTS)) return null;
    const items = LISTS[prefix](structuredClone(docs)).map((t) => (typeof t === "string" ? t.slice(0, 200) : ""));
    const index = listKeys(prefix, items).indexOf(key);
    return index < 0 ? null : { prefix, index };
  }
  const [section, field] = key.split(".");
  if (section === "lang" && LANG_SLOTS.has(field)) return { section: "language", field };
  if (section === "layout" && LAYOUT_SLOTS.has(field)) return { section: "layout", field };
  return null;
}

/** Docs with the fact's words replaced, and the key the fact has afterwards. */
export function replaceDsFact(docs: DesignDocs, key: string, text: string): { docs: DesignDocs; key: string } | { error: string } {
  const at = locateDsFact(docs, key);
  if (!at) return { error: "This fact can't be edited here." };
  const next = structuredClone(docs);
  const words = text.trim();
  if (!words) return { error: "Write something, or forget the fact instead." };
  if ("prefix" in at) {
    const list = LISTS[at.prefix](next);
    list[at.index] = words;
    const keys = listKeys(at.prefix, list.map((t) => t.slice(0, 200)));
    return { docs: next, key: keys[at.index] };
  }
  (next[at.section] as unknown as Record<string, string>)[at.field] = words;
  return { docs: next, key };
}
