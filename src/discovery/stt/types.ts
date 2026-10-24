/*
 * Speech to text (pure types): what every way of getting a transcript gives back, whether a local
 * engine on the Mac, a cloud provider with the builder's own key, or a caption file someone already
 * has (Zoom, Teams, YouTube). Each interview is one language, Arabic or English, chosen when it's
 * added; nothing is transcribed as a mix of both.
 */

export type Lang = "ar" | "en";
export type Dialect = "egyptian" | "gulf" | "levantine" | "msa" | "maghrebi" | "other";
export type ProviderId = "local" | "elevenlabs" | "soniox" | "captions";

/** What code noticed about a stretch of speech (it's marked "check this", never quoted silently). */
export type SegmentFlag = "loop" | "rate" | "nonspeech" | "refused" | "hallucination" | "truncated" | "script-mismatch";

/** What a provider can do, and where the audio goes. */
export interface SttCapabilities {
  where: "server-local" | "browser-direct" | "server-proxy";
  maxBytes: number;
  maxSeconds: number;
  formats: string[];
  diarization: boolean;
  maxSpeakers: number;
  wordTimestamps: boolean;
  languageHints: boolean;
  keyterms: number;
  trainsOnAudio: "never" | "unless-opted-out" | "n/a";
  retention: string;
  needsKey: boolean;
  /** The recording leaves the builder's Mac: they must confirm the participants agreed. */
  audioLeavesDevice: boolean;
}

/** What was asked of a transcription (kept with the transcript). */
export interface SttParams {
  provider: ProviderId;
  engine?: string;
  /** The interview's one language. */
  spoken: Lang;
  dialect?: Dialect;
  speakers: { min: number; max: number };
  keyterms: string[];
  durationSec: number;
  region?: "us" | "eu";
}

/** A stretch of one speaker's words, as a provider returns it. */
export interface RawSegment {
  /** Start and end, in seconds from the start of the recording. */
  t0: number;
  t1: number;
  /** The provider's id for the speaker ("SPEAKER_00", "S1"). */
  speaker: string;
  text: string;
  lang?: Lang;
  /** 0–1, when the provider gives one. */
  conf?: number;
  flags?: SegmentFlag[];
}

export interface RawTranscript {
  provider: ProviderId;
  model: string;
  durationSec: number;
  languages: Lang[];
  dialect?: { id: Dialect; by: "engine" | "user"; conf?: number };
  segments: RawSegment[];
  /** Names the source gives its speakers (captions: "Sara"), by the provider's speaker id. */
  names?: Record<string, string>;
  diarizer?: string;
  vad?: string;
  elapsedSec?: number;
}

export interface SttProgress {
  stage: "convert" | "upload" | "queued" | "decode" | "vad" | "diarize" | "transcribe" | "fetch";
  done: number;
  total: number;
  unit: "pct" | "sec";
}

/** The builder confirmed the participants agreed to being recorded and to AI processing of it. */
export interface ConsentRecord {
  at: number;
  provider: ProviderId;
  statement: "participants-consented-recording-and-ai";
}

export interface SttProvider {
  id: ProviderId;
  label: string;
  model: string;
  caps: SttCapabilities;
  available(): Promise<{ ok: true } | { ok: false; reason: string; fix?: string }>;
  transcribe(audio: Blob, p: SttParams, o: { signal?: AbortSignal; onProgress?: (p: SttProgress) => void; consent?: ConsentRecord }): Promise<RawTranscript>;
}
