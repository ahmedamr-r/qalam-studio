import type { SourceQuote } from "./sources";
import type { Extracted } from "./synthesis";
import { pickClips, proposeRoles, speakerStats } from "./speakers";
import type { ConsentRecord, Dialect, Lang, RawTranscript, SegmentFlag, SttParams } from "./stt/types";

/*
 * An interview as a source (pure). Its text is one turn per paragraph, "S1: words\n\nS2: words":
 * neutral labels, never rewritten, so quotes stay word for word and chunks break between turns.
 * Beside the text, code keeps where each stretch of speech sits in it and when it was said, who
 * spoke, and who the builder confirmed is the interviewer: only participants' words are quoted,
 * each with the moment it was said.
 */

export interface TranscriptSegment {
  /** [start, end) of its words in the source's text (never the "S1: " label). */
  span: [number, number];
  t0: number;
  t1: number;
  /** The speaker's id. */
  speaker: string;
  lang?: Lang;
  conf?: number;
  flags?: SegmentFlag[];
}

/** One speaker's consecutive segments: a paragraph of the text. */
export interface TranscriptTurn {
  /** "t001" */
  id: string;
  speaker: string;
  /** [start, end) of its words in the text (after the label). */
  span: [number, number];
  t0: number;
  t1: number;
  /** [first, end) indices into the segments. */
  seg: [number, number];
}

export type SpeakerRole = "interviewer" | "participant" | "other";

export interface SpeakerStats {
  talkSec: number;
  talkShare: number;
  turns: number;
  /** Turns that ask something. */
  questions: number;
  /** Their share of all the questions asked. */
  questionShare: number;
  meanTurnSec: number;
  firstAt: number;
  words: number;
}

export interface TranscriptSpeaker {
  /** The provider's id for them ("SPEAKER_00", "S1"). */
  id: string;
  /** "S1": what the text calls them. */
  label: string;
  role?: SpeakerRole;
  roleBy?: "code" | "user";
  /** As the source names them (a caption file's "Sara"), or as the builder does. */
  name?: string;
  stats: SpeakerStats;
  /** Moments to hear who they are ([start, end) seconds). */
  clips: [number, number][];
}

/** Code's proposal for the interviewer, before the builder confirms. */
export interface RoleProposal {
  interviewer?: string;
  confidence: "clear" | "unsure";
  /** What code saw the proposed interviewer do ("asks 80% of the questions", "speaks first"). */
  reasons: string[];
}

export interface TranscriptMeta {
  v: 1;
  engine: { provider: SttParams["provider"]; model: string; local: boolean; at: number; params: SttParams };
  durationSec: number;
  languages: Lang[];
  /** Share of letters in each script (Arabic, Latin). */
  langShare: Partial<Record<Lang, number>>;
  dialect?: { id: Dialect; by: "engine" | "user"; conf?: number };
  speakers: TranscriptSpeaker[];
  turns: TranscriptTurn[];
  proposal: RoleProposal;
  /** The builder said who is who: until then Qalam AI doesn't read it. */
  rolesConfirmed: boolean;
  quality: { flaggedSec: number; flaggedShare: number };
  consent?: ConsentRecord;
}

/** A recording kept in this browser (P1b). */
export interface MediaRef {
  id: string;
  mime: string;
  durationSec: number;
  bytes: number;
  hasVideo: boolean;
  video?: "handle" | "none";
}

/** Characters a transcript never keeps: zero-width and direction marks (they hide inside quotes). */
const INVISIBLE = /[​-‏؜‪-‮⁦-⁩﻿]/g;
const cleanWords = (s: string) => s.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();

const ARABIC = /\p{Script=Arabic}/gu;
const LATIN = /\p{Script=Latin}/gu;

/** Share of Arabic and Latin letters in a text. */
export function scriptShare(text: string): Record<Lang, number> {
  const ar = text.match(ARABIC)?.length ?? 0;
  const en = text.match(LATIN)?.length ?? 0;
  const all = ar + en;
  return { ar: all ? Math.round((ar / all) * 1000) / 1000 : 0, en: all ? Math.round((en / all) * 1000) / 1000 : 0 };
}

export interface Built {
  text: string;
  segments: TranscriptSegment[];
  transcript: TranscriptMeta;
}

/**
 * A provider's transcript as a source: speakers labelled S1, S2… in the order they first speak,
 * consecutive segments of one speaker joined into a turn, each turn a paragraph. Code proposes the
 * interviewer; the builder confirms.
 */
export function buildTranscript(raw: RawTranscript, opts: { at?: number; params?: Partial<SttParams> } = {}): Built {
  const segs = raw.segments
    .map((s) => ({ ...s, text: cleanWords(s.text) }))
    .filter((s) => s.text)
    .sort((a, b) => a.t0 - b.t0);
  const order: string[] = [];
  for (const s of segs) if (!order.includes(s.speaker)) order.push(s.speaker);
  const label = new Map(order.map((id, i) => [id, `S${i + 1}`]));

  let text = "";
  const segments: TranscriptSegment[] = [];
  const turns: TranscriptTurn[] = [];
  for (const s of segs) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === s.speaker) text += " ";
    else {
      if (turns.length) text += "\n\n";
      text += `${label.get(s.speaker)}: `;
      turns.push({ id: `t${String(turns.length + 1).padStart(3, "0")}`, speaker: s.speaker, span: [text.length, text.length], t0: s.t0, t1: s.t1, seg: [segments.length, segments.length] });
    }
    const span: [number, number] = [text.length, text.length + s.text.length];
    text += s.text;
    segments.push({ span, t0: s.t0, t1: s.t1, speaker: s.speaker, ...(s.lang ? { lang: s.lang } : {}), ...(s.conf !== undefined ? { conf: s.conf } : {}), ...(s.flags?.length ? { flags: s.flags } : {}) });
    const turn = turns[turns.length - 1];
    turn.span = [turn.span[0], span[1]];
    turn.t1 = Math.max(turn.t1, s.t1);
    turn.seg = [turn.seg[0], segments.length];
  }

  const stats = speakerStats(order, turns, segments, (t) => text.slice(t.span[0], t.span[1]));
  const speakers: TranscriptSpeaker[] = order.map((id) => ({
    id,
    label: label.get(id)!,
    ...(raw.names?.[id] ? { name: raw.names[id] } : {}),
    stats: stats[id],
    clips: pickClips(id, turns, segments),
  }));
  const proposal = proposeRoles(speakers);
  for (const sp of speakers) {
    sp.role = !proposal.interviewer ? "participant" : sp.id === proposal.interviewer ? "interviewer" : "participant";
    sp.roleBy = "code";
  }

  const share = scriptShare(text);
  const spoken: Lang = opts.params?.spoken ?? (share.ar >= share.en ? "ar" : "en");
  const durationSec = raw.durationSec || segs.reduce((m, s) => Math.max(m, s.t1), 0);
  const flaggedSec = segments.filter((s) => s.flags?.length).reduce((n, s) => n + (s.t1 - s.t0), 0);
  const params: SttParams = { provider: raw.provider, spoken, speakers: { min: 1, max: Math.max(1, order.length) }, keyterms: [], durationSec, ...opts.params };
  const transcript: TranscriptMeta = {
    v: 1,
    engine: { provider: raw.provider, model: raw.model, local: raw.provider === "local" || raw.provider === "captions", at: opts.at ?? Date.now(), params },
    durationSec,
    languages: raw.languages.length ? raw.languages : [spoken],
    langShare: share,
    ...(raw.dialect ? { dialect: raw.dialect } : {}),
    speakers,
    turns,
    proposal,
    rolesConfirmed: false,
    quality: { flaggedSec, flaggedShare: durationSec ? Math.round((flaggedSec / durationSec) * 1000) / 1000 : 0 },
  };
  return { text, segments, transcript };
}

/** The transcript as it fits a text cut at `length` (only the start of a long one is kept). */
export function trimTranscript(b: { segments: TranscriptSegment[]; transcript: TranscriptMeta }, length: number) {
  const segments = b.segments.filter((s) => s.span[1] <= length);
  const turns = b.transcript.turns.filter((t) => t.seg[0] < segments.length).map((t) => ({ ...t, seg: [t.seg[0], Math.min(t.seg[1], segments.length)] as [number, number] }));
  for (const t of turns) t.span = [t.span[0], segments[t.seg[1] - 1].span[1]];
  return { segments, transcript: { ...b.transcript, turns } };
}

/** An interview Qalam AI may not read yet: the builder hasn't said who is who. */
export const awaitingRoles = (s: { kind: string; transcript?: TranscriptMeta }) => s.kind === "interview" && !!s.transcript && !s.transcript.rolesConfirmed;

/** A speaker as people read them: their name, else their label. */
export const speakerName = (sp: Pick<TranscriptSpeaker, "label" | "name">) => sp.name || sp.label;

/** Who is who, for Qalam AI reading the transcript ("S1 (Sara) is the interviewer; S2 (Omar) is a participant"). */
export function speakerNote(t: TranscriptMeta): string {
  const who = (sp: TranscriptSpeaker) => (sp.name ? `${sp.label} (${sp.name.slice(0, 40)})` : sp.label);
  const role = (r?: SpeakerRole) => (r === "interviewer" ? "the interviewer" : r === "other" ? "not a participant" : "a participant");
  return t.speakers.map((sp) => `${who(sp)} is ${role(sp.role)}`).join("; ").slice(0, 400);
}

// ---------------------------------------------------------------------------
// Where and when

/** The last item whose start is at or before `offset` (items sorted by start). */
function lastAtOrBefore<T>(items: T[], start: (t: T) => number, offset: number): number {
  let lo = 0;
  let hi = items.length - 1;
  if (hi < 0 || start(items[0]) > offset) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (start(items[mid]) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The turn a character of the text belongs to (its label included). */
export function turnAt(turns: TranscriptTurn[], offset: number): TranscriptTurn | undefined {
  const i = lastAtOrBefore(turns, (t) => t.span[0], offset);
  if (i < 0) return turns[0];
  // Past a turn's words is the break and the next turn's label.
  return offset >= turns[i].span[1] && turns[i + 1] ? turns[i + 1] : turns[i];
}

/** Lead-in before a quote and tail after it, in seconds, when it's played (the player adds them; stored times are the words' own). */
export const PAD = { before: 1.5, after: 0.5 } as const;

/** When the words at [start, end) of the text were said (seconds), from the segments' times. */
export function timeAt(segments: TranscriptSegment[], span: [number, number], duration = Infinity): [number, number] | undefined {
  if (!segments.length) return undefined;
  const at = (s: TranscriptSegment, offset: number) => s.t0 + ((s.t1 - s.t0) * (offset - s.span[0])) / (s.span[1] - s.span[0] || 1);
  // The start: in its segment, or (on a label or a break between segments) when the next one starts.
  const i = lastAtOrBefore(segments, (s) => s.span[0], span[0]);
  const a = segments[Math.max(0, i)];
  const start = i < 0 ? a.t0 : span[0] < a.span[1] ? at(a, span[0]) : (segments[i + 1]?.t0 ?? a.t1);
  // The end: where its last character ends, in the segment that character is in.
  const j = lastAtOrBefore(segments, (s) => s.span[0], Math.max(span[0], span[1] - 1));
  const b = segments[Math.max(0, j)];
  const end = j < 0 ? b.t0 : span[1] - 1 < b.span[1] ? at(b, Math.min(span[1], b.span[1])) : b.t1;
  const t0 = Math.max(0, start);
  const t1 = Math.min(duration, end);
  return [Math.round(t0 * 10) / 10, Math.round(Math.max(t0, t1) * 10) / 10];
}

/** "4:05", "1:02:09": a time in a recording. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** A text in runs of one direction: Latin words inside Arabic, and the rest (each run goes in its own <bdi>). */
export function scriptRuns(text: string): { text: string; latin: boolean }[] {
  const out: { text: string; latin: boolean }[] = [];
  for (const m of text.matchAll(/(\p{Script=Latin}[\p{Script=Latin}\p{N}\s'.,&-]*\p{Script=Latin}|\p{Script=Latin})|([^\p{Script=Latin}]+)/gu)) {
    out.push({ text: m[0], latin: !!m[1] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Quotes: participants only, with who and when, by code

/** A label a model left at the start of a quote ("S2: "). */
const LABEL = /^S\d+:\s*/;

/** Shortest quote left once a label is cut off. */
const MIN_LEFT = 8;

type Interview = { text: string; segments?: TranscriptSegment[]; transcript?: TranscriptMeta };

/**
 * An interview's quotes, kept only where every part lies inside the words of one participant's
 * turns (never the interviewer's, never a label); each gets its speaker, turns and time from code.
 */
export function finishInterviewQuotes(source: Interview, quotes: SourceQuote[]): SourceQuote[] {
  const t = source.transcript;
  if (!t || !source.segments) return quotes;
  const byId = new Map(t.speakers.map((sp) => [sp.id, sp]));
  const out: SourceQuote[] = [];
  for (const q of quotes) {
    const parts = (q.parts ?? [q.span]).map(([a, b]): [number, number] => [a, b]);
    const lead = LABEL.exec(source.text.slice(parts[0][0], parts[0][1]));
    if (lead) parts[0][0] += lead[0].length;
    if (parts.some(([a, b]) => b - a < (parts.length > 1 ? 5 : MIN_LEFT))) continue;
    const turns = parts.map(([a, b]) => {
      const turn = turnAt(t.turns, a);
      return turn && turn.span[0] <= a && b <= turn.span[1] ? turn : undefined;
    });
    if (turns.some((x) => !x)) continue;
    const speaker = byId.get(turns[0]!.speaker);
    if (!speaker || speaker.role !== "participant" || turns.some((x) => x!.speaker !== speaker.id)) continue;
    const span: [number, number] = [parts[0][0], parts[parts.length - 1][1]];
    const time = timeAt(source.segments, span, t.durationSec || Infinity);
    const next: SourceQuote = {
      ...q,
      text: parts.map(([a, b]) => source.text.slice(a, b)).join(" … "),
      span,
      speaker: speakerName(speaker),
      speakerId: speaker.id,
      turnIds: [...new Set(turns.map((x) => x!.id))],
      ...(time ? { time } : {}),
    };
    if (parts.length > 1) next.parts = parts;
    else delete next.parts;
    out.push(next);
  }
  return out;
}

/** What one extract call kept, with interviews' quotes finished (see finishInterviewQuotes) and needs left only with quotes that stayed. */
export function finishExtracted(got: Extracted, sourceOf: (id: string) => Interview | undefined): Extracted {
  const quotes = got.quotes.flatMap((x) => {
    const s = sourceOf(x.sourceId);
    if (!s?.transcript) return [x];
    const [q] = finishInterviewQuotes(s, [x.quote]);
    return q ? [{ sourceId: x.sourceId, quote: q }] : [];
  });
  const kept = new Set(quotes.map((x) => x.quote.id));
  const needs = got.needs.map((n) => ({ ...n, need: { ...n.need, quoteIds: n.need.quoteIds.filter((id) => kept.has(id)) } })).filter((n) => n.need.quoteIds.length);
  return { quotes, needs };
}
