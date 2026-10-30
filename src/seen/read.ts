import { takenAt, platformOf } from "./measure";
import { SCREEN_KINDS, SEEN_LIMITS, type ScreenCan, type ScreenKind, type SeenText, type Shot, type ShotNote } from "./types";
import { noteLine, onScreen } from "./words";

/*
 * Reading a batch of screenshots (pure): what the call is sent around each picture (its id, file,
 * when it was taken, its size and the words this Mac read off it), and what code keeps of what
 * Qalam AI read: a name, a kind from the list, what the screen is for and what's on it, its controls
 * and navigation as the screen shows them (word for word, or they go), the state it shows and how
 * it's laid out. Every quoted word and number in a note is on the screen; no note keeps an email
 * address or a phone number.
 */

export interface ReadShot {
  ref: string;
  name: string;
  text?: SeenText;
}

export interface ReadSent {
  /** By call id (s1…). */
  shots: Map<string, ReadShot>;
  /** Around each picture, in order: what's said before it, and its words after it. */
  blocks: { id: string; ref: string; head: string; words: string }[];
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();

/** When a screenshot was taken, in words, from its name or its file. */
function takenWords(s: Shot): string | null {
  const t = takenAt(s.name);
  if (t.at) {
    const d = String(t.at);
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)} ${d.slice(8, 10)}:${d.slice(10, 12)}:${d.slice(12, 14)}`;
  }
  return s.modified ? new Date(s.modified).toISOString().slice(0, 19).replace("T", " ") : null;
}

/** A screenshot's lines for the call: top to bottom, the top and bottom bands marked (where navigation sits). */
function linesFor(t: SeenText): string {
  return t.lines
    .map((l) => {
      const [, y, , h] = l.box;
      const band = y + h <= 0.12 ? "(top) " : y >= 0.88 ? "(bottom) " : "";
      return `${band}${one(l.text)}`;
    })
    .filter((l) => l.trim())
    .join("\n");
}

/** What a batch's call is sent, its screenshots named s1… in order. */
export function readMaterial(shots: Shot[], texts: ReadonlyMap<string, SeenText | undefined>): ReadSent {
  const sent = new Map<string, ReadShot>();
  const blocks: ReadSent["blocks"] = [];
  for (const s of shots.slice(0, SEEN_LIMITS.batch)) {
    const id = `s${sent.size + 1}`;
    const text = texts.get(s.ref);
    sent.set(id, { ref: s.ref, name: s.name, ...(text ? { text } : {}) });
    const when = takenWords(s);
    const size = text ? ` · ${text.w}×${text.h} (${platformOf(text.w, text.h)})` : "";
    blocks.push({
      id,
      ref: s.ref,
      head: `Screen ${id} · ${one(s.name).slice(0, 120)}${when ? ` · taken ${when}` : ""}${size}:`,
      words: text ? (text.lines.length ? `Words on ${id}, as this Mac read them (top to bottom):\n${linesFor(text)}` : `No words on ${id}, as this Mac read it.`) : `This Mac didn't read the words on ${id}.`,
    });
  }
  return { shots: sent, blocks };
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * What code keeps of a batch's read: one note per screenshot sent, its name holding (a quoted word
 * or number in it on the screen), its labels on the screen word for word, the rest of its lines
 * holding or left out. `dropped` hears what's left out and why.
 */
export function sanitizeRead(raw: unknown, sent: ReadSent, dropped?: (why: string, item: unknown) => void): Map<string, ShotNote> {
  const out = new Map<string, ShotNote>();
  const drop = (why: string, x: unknown) => void dropped?.(why, x);
  for (const x of Array.isArray(rec(raw).screens) ? (rec(raw).screens as unknown[]) : []) {
    const r = rec(x);
    const shot = typeof r.id === "string" ? sent.shots.get(r.id.trim()) : undefined;
    if (!shot) {
      drop("a screenshot not sent", x);
      continue;
    }
    if (out.has(shot.ref)) {
      drop("read twice", x);
      continue;
    }
    const texts = [shot.text];
    const name = noteLine(r.name, texts, "", SEEN_LIMITS.name);
    if (!name) {
      drop("its name holds a word or number not on the screen", x);
      continue;
    }
    const line = (field: string, max: number = SEEN_LIMITS.line) => {
      if (r[field] === undefined || r[field] === null || r[field] === "") return undefined;
      const kept = noteLine(r[field], texts, "", max);
      if (!kept) drop(`its ${field} holds a word or number not on the screen, or someone's contact`, x);
      return kept ?? undefined;
    };
    const can: ScreenCan[] = [];
    for (const c of Array.isArray(r.can) ? r.can.map(rec) : []) {
      if (can.length >= SEEN_LIMITS.can) break;
      const label = onScreen(c.label, shot.text, SEEN_LIMITS.label);
      if (!label) {
        drop(shot.text ? "a control whose label isn't on the screen" : "a control on a screen whose words weren't read", c);
        continue;
      }
      if (can.some((k) => k.label === label)) continue;
      const does = c.does ? noteLine(c.does, texts, "", 120) : null;
      can.push({ label, ...(does ? { does } : {}) });
    }
    const nav: string[] = [];
    for (const n of Array.isArray(r.nav) ? r.nav : []) {
      const label = onScreen(n, shot.text, SEEN_LIMITS.label);
      if (!label) drop("navigation not on the screen", n);
      else if (!nav.includes(label) && nav.length < SEEN_LIMITS.nav) nav.push(label);
    }
    const kind: ScreenKind = typeof r.kind === "string" && (SCREEN_KINDS as readonly string[]).includes(r.kind) ? (r.kind as ScreenKind) : "other";
    const does = line("does");
    const on = line("on");
    const state = line("state", 200);
    const design = line("design");
    out.set(shot.ref, { name, kind, ...(does ? { does } : {}), ...(on ? { on } : {}), can, nav, ...(state ? { state } : {}), ...(design ? { design } : {}) });
  }
  for (const [id, s] of sent.shots) if (!out.has(s.ref)) drop("not read", { id });
  return out;
}
