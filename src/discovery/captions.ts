import type { Lang, RawSegment, RawTranscript } from "./stt/types";
import { scriptShare } from "./transcript";

/*
 * Caption files as transcripts (pure): WebVTT (Zoom, Teams, Meet, YouTube) and SubRip (.srt).
 * Cue numbers, times, styling and tags leave the text; who spoke comes from the file itself:
 * a voice tag (<v Sara>, Teams) or a "Sara:" at the start of most cues (Zoom), never guessed.
 */

export interface Cue {
  t0: number;
  t1: number;
  /** As the file names them; undefined when it doesn't. */
  name?: string;
  text: string;
}

/** "00:01:02.500", "01:02.5", "00:01:02,500" (SRT) → seconds. */
function seconds(stamp: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(stamp.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number((m[4] ?? "0").padEnd(3, "0")) / 1000;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", lrm: "", rlm: "" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });

/** A cue's payload without its voice tag: the name, and the words with tags and styling gone. */
function payload(lines: string[]): { name?: string; text: string } {
  let raw = lines.join("\n");
  const voice = /^\s*<v(?:\.[\w.-]+)?\s+([^>]+)>/i.exec(raw);
  const name = voice ? decode(voice[1]).trim() : undefined;
  if (voice) raw = raw.slice(voice[0].length);
  const text = decode(
    raw
      .replace(/<[^>]*>/g, "") // <c>, <i>, </v>, <00:00:01.000> timestamps
      .replace(/\{\\[^}]*\}/g, ""), // {\an8} (SRT styling)
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { ...(name ? { name } : {}), text };
}

/** The cues of a WebVTT or SubRip file, in order, without numbers, times or tags. */
export function parseCues(file: string): Cue[] {
  const blocks = file.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue; // WEBVTT header, NOTE, STYLE, REGION
    const [from, rest] = lines[at].split("-->");
    const t0 = seconds(from);
    const t1 = seconds(rest.trim().split(/\s+/)[0] ?? "");
    if (t0 === null || t1 === null) continue;
    const p = payload(lines.slice(at + 1));
    if (p.text) cues.push({ t0, t1: Math.max(t0, t1), ...(p.name ? { name: p.name } : {}), text: p.text });
  }
  return cues.sort((a, b) => a.t0 - b.t0);
}

/** "Sara:", "Speaker 2:", "د. منى:": a name at the start of a cue (short, no sentence in it). */
const NAMED = /^([^:\n<>]{1,40}?):\s+([\s\S]+)$/;
const looksLikeName = (s: string) => s.trim().split(/\s+/).length <= 4 && !/[.!?؟،,;"“”]|https?$/i.test(s) && !/^\d+$/.test(s.trim());

/**
 * Who said each cue: a voice tag where the file has them; else "Name:" at the start, when most
 * cues start that way (a lone "Note: …" isn't a speaker). A cue with no name continues the last
 * speaker's turn.
 */
export function namedCues(cues: Cue[]): Cue[] {
  const tagged = cues.some((c) => c.name);
  let out = cues;
  if (!tagged) {
    const named = cues.map((c) => {
      const m = NAMED.exec(c.text);
      return m && looksLikeName(m[1]) ? { name: m[1].trim(), text: m[2].trim() } : null;
    });
    if (named.filter(Boolean).length >= cues.length / 2) out = cues.map((c, i) => (named[i] ? { ...c, ...named[i] } : c));
  }
  // Rolling captions (YouTube) repeat the last cue's line at the top of the next: keep it once.
  const kept: Cue[] = [];
  let prevLast = "";
  for (const c of out) {
    const lines = c.text.split("\n");
    while (lines.length && lines[0] === prevLast) lines.shift();
    if (lines.length) {
      kept.push({ ...c, text: lines.join(" ") });
      prevLast = lines[lines.length - 1];
    }
  }
  // Unnamed cues continue the speaker before them (or, at the very start, the first one named).
  const firstName = kept.find((c) => c.name)?.name;
  let last = firstName;
  return kept.map((c) => {
    if (c.name) last = c.name;
    return last ? { ...c, name: last } : c;
  });
}

/** A caption file as a transcript: speakers S1, S2… in the order they first speak, named as the file names them. */
export function parseCaptions(file: string, format: "vtt" | "srt" = /^﻿?WEBVTT/.test(file) ? "vtt" : "srt"): RawTranscript {
  const cues = namedCues(parseCues(file));
  const ids = new Map<string, string>();
  const names: Record<string, string> = {};
  const segments: RawSegment[] = cues.map((c) => {
    const name = c.name ?? "";
    if (!ids.has(name)) {
      const id = `S${ids.size + 1}`;
      ids.set(name, id);
      if (name) names[id] = name;
    }
    return { t0: c.t0, t1: c.t1, speaker: ids.get(name)!, text: c.text };
  });
  const share = scriptShare(cues.map((c) => c.text).join(" "));
  const languages: Lang[] = (["ar", "en"] as const).filter((l) => share[l] >= 0.05).sort((a, b) => share[b] - share[a]);
  return { provider: "captions", model: format, durationSec: segments.reduce((m, s) => Math.max(m, s.t1), 0), languages, segments, ...(Object.keys(names).length ? { names } : {}) };
}

/** Captions with no speakers as plain text: a paragraph wherever the talk pauses (2 s or more). */
export function captionText(raw: RawTranscript, pause = 2): string {
  let text = "";
  let end = -Infinity;
  for (const s of raw.segments) {
    text += text ? (s.t0 - end >= pause ? "\n\n" : " ") : "";
    text += s.text.replace(/\s+/g, " ").trim();
    end = s.t1;
  }
  return text;
}

/** How many people speak in it. */
export const speakerCount = (raw: RawTranscript) => new Set(raw.segments.map((s) => s.speaker)).size;
