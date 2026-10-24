import { normalizeForMatch } from "./quotes";
import type { RoleProposal, SpeakerStats, TranscriptSegment, TranscriptSpeaker, TranscriptTurn } from "./transcript";

/*
 * Who asked and who answered, as code can tell from a transcript (pure). Code counts each speaker's
 * questions and talk time and proposes the interviewer; the builder confirms before Qalam AI reads
 * the interview, because the interviewer's words are never quoted as a customer's.
 */

/**
 * Words that open a question (or, in Egyptian and Levantine Arabic, often end one: "رحت فين؟"),
 * spelled as quote matching folds them (ا for أ/إ/آ, ي for ى, ه for ة). Words that are also
 * something else are left out: من (who · from), ما (what · not), ايه (what in Egypt · yes in the
 * Levant), منو (who in the Gulf · from him elsewhere), اي (which · yes).
 */
export const INTERROGATIVES = {
  en: ["what", "why", "how", "when", "where", "which", "who", "whom", "whose"],
  msa: ["ماذا", "لماذا", "كيف", "متي", "اين", "هل", "كم", "ايهما"],
  egyptian: ["ليه", "ازاي", "امتي", "فين", "مين", "كام"],
  gulf: ["ليش", "شلون", "وين", "شنو", "ايش", "شو", "متي"],
  levantine: ["ليش", "كيف", "وين", "ايمتي", "شو", "مين", "قديش", "اديش"],
} as const;

/** English questions that open with a verb ("Do you…", "Tell me about…"). */
const EN_OPENERS = ["do you", "did you", "does it", "does that", "can you", "could you", "would you", "will you", "have you", "has it", "are you", "is it", "is there", "was it", "were you", "tell me", "walk me", "talk me", "describe", "explain"];
/** Arabic questions that open with ما plus a pronoun ("ما هي…"), where ما can only ask. */
const AR_OPENERS = ["ما هو", "ما هي", "ما الذي", "ايه اللي", "يعني ايه"];

const WORDS = new Set<string>(Object.values(INTERROGATIVES).flat());
const EN_WORDS = new Set<string>(INTERROGATIVES.en);
/** What follows an English question word in a question ("When was…", "How long…"); "When something is out…" isn't one. */
const EN_AFTER = new Set(["do", "does", "did", "is", "are", "was", "were", "can", "could", "would", "should", "will", "have", "has", "am", "else", "long", "much", "many", "often", "kind", "sort", "part", "one", "ones"]);
/** Arabic question words that can close a question in dialect ("بتطلب ازاي"). */
const CLOSERS = new Set<string>(["ليه", "ازاي", "امتي", "فين", "مين", "كام", "وين", "ليش", "شو", "شنو", "ايش", "شلون", "قديش", "اديش"]);

const tokens = (s: string) => s.match(/[\p{L}\p{N}']+/gu) ?? [];
/** A word without "و" (and) or "ف" (so) stuck to its front, when that leaves a question word. */
const bare = (w: string) => (WORDS.has(w) ? w : /^[وف]/.test(w) && WORDS.has(w.slice(1)) ? w.slice(1) : w);

/** Whether a turn asks something: a question mark, or a sentence that opens (or, in dialect, closes) with a question word. */
export function isQuestion(text: string): boolean {
  const norm = normalizeForMatch(text).norm;
  if (/[?]/.test(norm)) return true;
  for (const sentence of norm.split(/[.!\n]+/)) {
    const words = tokens(sentence).map(bare);
    if (!words.length) continue;
    const head = words.slice(0, 3).join(" ");
    // English needs the verb after the question word; Arabic question words ask on their own.
    if (words.slice(0, 3).some((w, i) => (EN_WORDS.has(w) ? EN_AFTER.has(words[i + 1] ?? "") || words.length === 1 : WORDS.has(w)))) return true;
    if ([...EN_OPENERS, ...AR_OPENERS].some((o) => head === o || head.startsWith(`${o} `))) return true;
    if (words.slice(-2).some((w) => CLOSERS.has(w))) return true;
  }
  return false;
}

/** What makes code sure of the interviewer; short of these it proposes one and says it's unsure. */
export const ROLE_RULES = {
  /** They ask at least this share of all the questions… */
  questionShare: 0.6,
  /** …talk less than this share of the time… */
  maxTalkShare: 0.5,
  /** …and ask at least this many questions. */
  minQuestions: 3,
} as const;

const pct = (x: number) => `${Math.round(x * 100)}%`;
type Who = Pick<TranscriptSpeaker, "id" | "label" | "stats">;

/** The interviewer code proposes, how sure it is, and what it saw them do ("asks 80% of the questions"). */
export function proposeRoles(speakers: Who[]): RoleProposal {
  if (speakers.length < 2) return { confidence: "unsure", reasons: ["only one person speaks"] };
  const first = [...speakers].sort((a, b) => a.stats.firstAt - b.stats.firstAt)[0];
  const asker = [...speakers].sort((a, b) => b.stats.questions - a.stats.questions || a.stats.talkShare - b.stats.talkShare || a.stats.firstAt - b.stats.firstAt)[0];
  if (!asker.stats.questions) return { interviewer: first.id, confidence: "unsure", reasons: ["no one asks a question code can tell", "speaks first"] };
  const s = asker.stats;
  const clear = s.questionShare >= ROLE_RULES.questionShare && s.talkShare < ROLE_RULES.maxTalkShare && s.questions >= ROLE_RULES.minQuestions;
  return { interviewer: asker.id, confidence: clear ? "clear" : "unsure", reasons: [`asks ${pct(s.questionShare)} of the questions`, `talks ${pct(s.talkShare)} of the time`, ...(asker.id === first.id ? ["speaks first"] : [])] };
}

/** Each speaker's talk time, turns and questions. `turnText` gives a turn's words. */
export function speakerStats(ids: string[], turns: TranscriptTurn[], segments: TranscriptSegment[], turnText: (t: TranscriptTurn) => string): Record<string, SpeakerStats> {
  const asks = new Set(turns.filter((t) => isQuestion(turnText(t))).map((t) => t.id));
  const talk = segments.reduce((n, s) => n + Math.max(0, s.t1 - s.t0), 0);
  const out: Record<string, SpeakerStats> = {};
  for (const id of ids) {
    const mine = turns.filter((t) => t.speaker === id);
    const segs = segments.filter((s) => s.speaker === id);
    const talkSec = segs.reduce((n, s) => n + Math.max(0, s.t1 - s.t0), 0);
    const questions = mine.filter((t) => asks.has(t.id)).length;
    out[id] = {
      talkSec: round(talkSec),
      talkShare: talk ? round(talkSec / talk, 3) : 0,
      turns: mine.length,
      questions,
      questionShare: asks.size ? round(questions / asks.size, 3) : 0,
      meanTurnSec: mine.length ? round(mine.reduce((n, t) => n + (t.t1 - t.t0), 0) / mine.length) : 0,
      firstAt: segs[0]?.t0 ?? 0,
      words: mine.reduce((n, t) => n + tokens(turnText(t)).length, 0),
    };
  }
  return out;
}

/** Shortest clip worth listening to, and the longest one played. */
export const CLIP = { min: 4, max: 20 } as const;

/** A speaker's longest turns with nothing flagged in them (at least CLIP.min seconds): for the builder to hear who they are. */
export function pickClips(speaker: string, turns: TranscriptTurn[], segments: TranscriptSegment[], n = 2): [number, number][] {
  return turns
    .filter((t) => t.speaker === speaker && t.t1 - t.t0 >= CLIP.min && !segments.slice(t.seg[0], t.seg[1]).some((s) => s.flags?.length))
    .sort((a, b) => b.t1 - b.t0 - (a.t1 - a.t0))
    .slice(0, n)
    .map((t) => [t.t0, Math.min(t.t1, t.t0 + CLIP.max)]);
}

function round(x: number, places = 1) {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}
