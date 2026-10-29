import type { SourceQuote, SourceRecord } from "@/discovery/sources";

/**
 * Who is behind what customers said (pure). The organization keeps the people it hears from
 * (people/<slug>.md: a name, the segments they're in, their role), and each source says who is
 * in it: its speakers as people, or one person or one segment for all of it, and when it was said.
 * A quote's voice is the person who said it, when the source says who; otherwise it's an unnamed
 * voice of its source (a speaker, or the whole source). Counting voices, not quotes or sources,
 * tells ten quotes from one talkative customer apart from ten customers.
 */

export interface Person {
  id: string;
  name: string;
  /** The kinds of customer they are (a product's or the organization's segments, in its words). */
  segments: string[];
  /** What they do ("Office manager at a 40-person startup"). */
  role?: string;
  notes?: string;
}

/** Who is in a source, and when it was said. */
export interface SourceWho {
  /** The one person everything in it is from (a call's notes, an interview with one participant). */
  person?: string;
  /** People by how the source names its speakers: an interview's speaker id, or a name its quotes give. */
  speakers?: Record<string, string>;
  /** The segment it's from when no person says it ("a survey of offices"). */
  segment?: string;
  /** When it was said or collected (its day); when it was added, if no one said. */
  saidAt?: number;
}

/** One voice behind a quote: a person, or an unnamed voice of a source. */
export interface Voice {
  /** The same for every quote of the same voice: `person:<id>`, or `source:<id>[:<speaker>]`. */
  key: string;
  person?: Person;
  /** As a reader sees them: the person's name, the speaker as the source names them, or none. */
  name?: string;
  segments: string[];
  source: string;
  /** When it was said. */
  at: number;
}

export const PEOPLE_LIMITS = { name: 80, role: 160, segments: 12, notes: 4000 } as const;

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
const key = (s: string) => tidy(s).toLowerCase();

/** When a source's words were said: as it says, or when it was added. */
export const saidAt = (s: Pick<SourceRecord, "addedAt" | "who">) => s.who?.saidAt ?? s.addedAt;

/** The person behind a quote, when the source says who. */
export function personOf(s: Pick<SourceRecord, "who">, q: Pick<SourceQuote, "speaker" | "speakerId">, people: ReadonlyMap<string, Person>): Person | undefined {
  const w = s.who;
  if (!w) return undefined;
  if (!q.speakerId && !q.speaker) return w.person ? people.get(w.person) : undefined;
  const named = q.speaker ? Object.entries(w.speakers ?? {}).find(([k]) => key(k) === key(q.speaker!))?.[1] : undefined;
  const id = (q.speakerId && w.speakers?.[q.speakerId]) || named;
  if (id) return people.get(id);
  // A source of one person: whatever it calls them, the quote is theirs (unless it names its speakers' people).
  return !w.speakers && w.person ? people.get(w.person) : undefined;
}

/** The voice behind a quote of a source. */
export function voiceOf(s: Pick<SourceRecord, "id" | "addedAt" | "who">, q: Pick<SourceQuote, "speaker" | "speakerId">, people: ReadonlyMap<string, Person>): Voice {
  const person = personOf(s, q, people);
  const at = saidAt(s);
  if (person) return { key: `person:${person.id}`, person, name: person.name, segments: person.segments.length ? person.segments : s.who?.segment ? [s.who.segment] : [], source: s.id, at };
  const speaker = q.speakerId ?? (q.speaker ? key(q.speaker) : "");
  return { key: `source:${s.id}${speaker ? `:${speaker}` : ""}`, ...(q.speaker ? { name: q.speaker } : {}), segments: s.who?.segment ? [s.who.segment] : [], source: s.id, at };
}

/** How many voices, which segments, how many sources, and how recent: what a need rests on. */
export interface Tally {
  /** Distinct voices: people, and unnamed voices counted once per source (or speaker). */
  voices: number;
  /** Of them, people the organization knows. */
  people: number;
  /** Each segment with how many voices in it, the most first. */
  segments: [string, number][];
  sources: number;
  /** When the newest was said (0: none). */
  newest: number;
}

export function tally(voices: Voice[]): Tally {
  const byKey = new Map<string, Voice>();
  for (const v of voices) if (!byKey.has(v.key)) byKey.set(v.key, v);
  const seg = new Map<string, { name: string; n: number }>();
  for (const v of byKey.values())
    for (const s of new Set(v.segments.map(key))) {
      const name = v.segments.find((x) => key(x) === s)!;
      seg.set(s, { name: seg.get(s)?.name ?? tidy(name), n: (seg.get(s)?.n ?? 0) + 1 });
    }
  return {
    voices: byKey.size,
    people: [...byKey.values()].filter((v) => v.person).length,
    segments: [...seg.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((x) => [x.name, x.n]),
    sources: new Set(voices.map((v) => v.source)).size,
    newest: Math.max(0, ...voices.map((v) => v.at)),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A tally in words: "3 voices (2 named) in 2 segments (4 sources)". */
export function tallyText(t: Tally): string {
  if (!t.voices) return "";
  const who = t.people && t.people < t.voices ? `${plural(t.voices, "voice")} (${t.people} named)` : t.people ? plural(t.voices, "person", "people") : plural(t.voices, "voice");
  const segs = t.segments.length ? ` in ${plural(t.segments.length, "segment")}` : "";
  return `${who}${segs} (${plural(t.sources, "source")})`;
}

/**
 * Every quote's voice, by its piece ref (hub:quote:<id>): what checks and comparisons count. Built
 * once from the organization's sources and people.
 */
export function voicesByQuote(sources: Pick<SourceRecord, "id" | "addedAt" | "who" | "quotes" | "kind">[], people: Person[]): Map<string, Voice> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const out = new Map<string, Voice>();
  for (const s of sources) {
    // A brain dump's pieces are the team's words, not a customer's voice.
    if (s.kind === "dump") continue;
    for (const q of s.quotes) out.set(`hub:quote:${q.id}`, voiceOf(s, q, byId));
  }
  return out;
}

/**
 * The speakers a source names, to say who each is: an interview's participants (by their id), or
 * the names its quotes give. None: the source doesn't tell its speakers apart.
 */
export function speakersOf(s: Pick<SourceRecord, "transcript" | "quotes">): { key: string; label: string }[] {
  if (s.transcript) return s.transcript.speakers.filter((x) => x.role !== "interviewer" && x.role !== "other").map((x) => ({ key: x.id, label: x.name ? `${x.label} · ${x.name}` : x.label }));
  const names = new Map<string, string>();
  for (const q of s.quotes) if (q.speaker?.trim() && !names.has(key(q.speaker))) names.set(key(q.speaker), tidy(q.speaker));
  return [...names.values()].map((n) => ({ key: n, label: n }));
}

/** A source's who, as a window sends it, checked (null: none; unknown people are dropped). */
export function whoShape(raw: unknown, known?: (id: string) => boolean): SourceWho | undefined {
  const w = raw as Record<string, unknown> | null;
  if (!w || typeof w !== "object") return undefined;
  const ok = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) && (!known || known(v));
  const out: SourceWho = {};
  if (ok(w.person)) out.person = w.person;
  if (w.speakers && typeof w.speakers === "object") {
    const sp = Object.entries(w.speakers as Record<string, unknown>)
      .filter(([k, v]) => k.length <= 120 && ok(v))
      .slice(0, 60);
    if (sp.length) out.speakers = Object.fromEntries(sp) as Record<string, string>;
  }
  if (typeof w.segment === "string" && tidy(w.segment)) out.segment = tidy(w.segment).slice(0, 120);
  if (typeof w.saidAt === "number" && Number.isFinite(w.saidAt) && w.saidAt > 0) out.saidAt = w.saidAt;
  return Object.keys(out).length ? out : undefined;
}

/** A person as a window sends one, checked, or null. */
export function personShape(raw: unknown, id: string): Person | null {
  const p = raw as Record<string, unknown> | null;
  if (!p || typeof p !== "object" || p.id !== id || typeof p.name !== "string" || !tidy(p.name)) return null;
  const segments = Array.isArray(p.segments) ? [...new Set(p.segments.filter((s): s is string => typeof s === "string" && !!tidy(s)).map((s) => tidy(s).slice(0, 120)))].slice(0, PEOPLE_LIMITS.segments) : [];
  return {
    id,
    name: tidy(p.name).slice(0, PEOPLE_LIMITS.name),
    segments,
    ...(typeof p.role === "string" && tidy(p.role) ? { role: tidy(p.role).slice(0, PEOPLE_LIMITS.role) } : {}),
    ...(typeof p.notes === "string" && p.notes.trim() ? { notes: p.notes.trim().slice(0, PEOPLE_LIMITS.notes) } : {}),
  };
}
