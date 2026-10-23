/**
 * What the designer told Qalam AI to forget or always keep (pure). Stored in the document by ref,
 * with when it was chosen; read back from storage defensively, like the brief.
 */
import type { KnowledgeControls } from "./types";

const MAX = 2000;

function stamps(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, t] of Object.entries(v as Record<string, unknown>).slice(0, MAX)) if (typeof k === "string" && k.length < 300 && typeof t === "number") out[k] = t;
  return out;
}

/** Validate controls read from storage or an opened file; nothing chosen becomes undefined. */
export function normalizeControls(x: unknown): KnowledgeControls | undefined {
  if (!x || typeof x !== "object") return undefined;
  const o = x as Record<string, unknown>;
  const forgotten = stamps(o.forgotten);
  const pinned = stamps(o.pinned);
  return Object.keys(forgotten).length || Object.keys(pinned).length ? { v: 1, forgotten, pinned } : undefined;
}

/** Controls for one system moved to its copy (a built-in system's first edit makes one), so forgotten rules stay forgotten. */
export function remapSystem(c: KnowledgeControls, from: string, to: string): KnowledgeControls {
  const move = (m: Record<string, number>) => {
    const out = { ...m };
    for (const [k, t] of Object.entries(m)) if (k.startsWith(`ds:${from}:`)) out[`ds:${to}:${k.slice(from.length + 4)}`] ??= t;
    return out;
  };
  return { ...c, forgotten: move(c.forgotten), pinned: move(c.pinned) };
}

/** A fact's ref changed (an edited rule's words make a new key): its choice follows it. */
export function remapRef(c: KnowledgeControls, from: string, to: string): KnowledgeControls {
  const move = (m: Record<string, number>) => {
    if (!(from in m)) return m;
    const { [from]: t, ...rest } = m;
    return { ...rest, [to]: t };
  };
  return { ...c, forgotten: move(c.forgotten), pinned: move(c.pinned) };
}
