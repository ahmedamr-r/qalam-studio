import type { Basis } from "@/discovery/basis";
import type { OrgShape } from "@/org/words";
import type { Situation } from "@/consult/situation";
import { isAppLink, projectName, scanInput, type FirstRead } from "@/scan/input";
import type { ScanTarget } from "@/scan/session";

/*
 * The first run's one box (pure): what its words say to look at, whose it is, and what it becomes
 * in the canvas's chat (src/ui/start/StartFlow.tsx, src/ui/space/chat/store.ts startFrom).
 */

export type StartPath = "company" | "idea";

/** A product's name is a few words; more is them saying what it is. */
const NAME_WORDS = 6;

const one = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * What to read, from the first answer on the path they picked, before it's read for what it is. A link
 * is always a product, and a product at their company is theirs. A few words on the company's path are
 * its name; more is them saying what it does, which is read as an idea until the first read finds the
 * product's own name in it (`targetAfterRead`).
 */
export function startTarget(path: StartPath, raw: string): ScanTarget | null {
  const text = one(raw);
  if (text.length < 2) return null;
  const read = scanInput(text);
  if (path === "company") {
    if (read?.kind === "product") return { ...read, mine: true };
    return text.split(" ").length <= NAME_WORDS && !/[.!?؟,]/.test(text) ? { kind: "product", name: text, mine: true } : { kind: "idea", said: text };
  }
  if (read?.kind === "product" && (read.app || /[./]/.test(text))) return read;
  return text.length >= 3 ? { kind: "idea", said: text } : null;
}

/**
 * What to read once the first answer is read: on the company's path, a product's own name found in what
 * they said is the product, and theirs. Otherwise what they said stands.
 */
export function targetAfterRead(path: StartPath, t: ScanTarget, read: FirstRead): ScanTarget {
  if (path === "company" && t.kind === "idea" && read.product) return { kind: "product", name: read.product, mine: true };
  return t;
}

/** What the project's called: the name the read found for it, else as before. With nothing named, "My project". It's theirs to change. */
export function nameAfterRead(t: ScanTarget, read: FirstRead): string {
  if (!read.named) return "My project";
  if (t.kind === "product" && t.name) return t.name;
  return read.name || projectName(t);
}

/** What's found isn't all there is: more can come in later. A company may have analytics; an idea has none yet. */
export const moreLine = (path: StartPath) => `This is only a start. Add ${path === "company" ? "interviews, docs, notes or your analytics" : "interviews, notes or docs"} any time from the canvas, to find more problems and goals.`;

// ---------------------------------------------------------------------------
// The one box (src/ui/start/StartFlow.tsx): what they wrote and attached, read by code with no tokens.

/** The longest an idea is read as one (the scan's own limit, `scanRequest`); longer is their thinking. */
export const SCAN_MAX = 2000;
/** Pictures in one message: each costs a call. */
export const START_PICTURES = 6;

/** What the box knows of an attached doc before it's sent. */
export interface BoxDoc {
  title: string;
  /** The connector's group it came from ("voice": a tool of customers' voice). */
  group?: string;
  basis?: Basis;
  image?: true;
}

/** Whose it is: a team's product or their own idea; `sure: false` asks in the chat after Send. */
export interface Whose {
  shape: OrgShape;
  /** A named product they say is theirs: its reviews are its customers' words. */
  mine: boolean;
  sure: boolean;
  /** What to ask when unsure: whether the product named is theirs, or who it's for. */
  ask?: "product" | "shape";
}

/**
 * `consult`: their words worked out with them in the canvas's chat (src/consult/), with who's asking
 * as Send read it (`situation`) and, for an app's link, reading its reviews offered (`offer`). `plan`
 * and `scan` are a chat's from before.
 */
export type StartTurn =
  | { mode: "scan"; said: string; target: ScanTarget; /** Read already for whether it names anything (Send's first read). */ read?: true }
  | { mode: "take" | "dump" | "plan"; said: string }
  | { mode: "consult"; said: string; situation?: Situation; offer?: true };

export interface StartPlan {
  turns: StartTurn[];
  name: string;
  whose: Whose;
}

const COMPANY_LEAD = [
  /^our (?:own )?(?:product|app|company|startup|service|platform|tool|business)(?:'s name)?(?:\s+is|\s+called|\s*:|\s*,|\s*-)?\s+/i,
  /^we(?:'re| are)? (?:make|build|run|making|building|running|have|own|sell)\s+/i,
  /^i work (?:at|on|for)\s+/i,
  /^(?:تطبيقنا|منتجنا|شركتنا)(?:\s+(?:هو|هي|اسمه|اسمها))?\s*:?\s*/,
];
/** An opening that says nothing of whose it is: taken off, nothing more. */
const PLAIN_LEAD = [/^i (?:want|need|'d like|would like) to (?:work on|fix|improve|look (?:at|into)|figure out)\s+/i, /^(?:help me (?:with|figure out)|can you help (?:me )?with)\s+/i];
const IDEA_LEAD = [
  /^(?:my (?:own )?idea|the idea|an idea)(?:\s+is|\s*:|\s*,|\s*-)?\s+/i,
  /^i(?:'m| am) (?:building|making|working on|thinking (?:of|about) (?:building|making)?)\s*/i,
  /^i (?:want|plan|would like|'d like) to (?:build|make|create|start)\s+/i,
  /^thinking (?:of|about) (?:building|making)\s+/i,
  /^(?:فكرتي|الفكرة)(?:\s+(?:هي|هو))?\s*:?\s*/,
  /^(?:أفكر في|أريد أن أبني|أبني)\s+/,
];

/** An opening that says whose it is ("Our app is", "My idea is"), taken off what's read. */
export function stripPreamble(text: string): { rest: string; cue: StartPath | null } {
  const t = text.trim();
  // An opening with nothing after it yet ("Our app is") says nothing to look at.
  const after = (re: RegExp) => {
    const m = re.exec(t);
    const rest = m ? t.slice(m[0].length).trim() : "";
    return rest && !/^(?:is|are|called|was|هو|هي|اسمه|اسمها)$/i.test(rest) ? rest : null;
  };
  for (const re of COMPANY_LEAD) {
    const rest = after(re);
    if (rest) return { rest, cue: "company" };
  }
  for (const re of IDEA_LEAD) {
    const rest = after(re);
    if (rest) return { rest, cue: "idea" };
  }
  for (const re of PLAIN_LEAD) {
    const rest = after(re);
    if (rest) return { rest, cue: null };
  }
  return { rest: t, cue: null };
}

/** A product's name after "Our app is": the words before a comma, a dash or "which/that/it". */
const nameAhead = (rest: string) => rest.split(/\s*(?:[,;:(—–]|\s-\s|\s(?:which|that|it|and)\s)/i)[0].trim();

/** What the box's words say to look at, the opening that says whose it is taken off. */
export function boxTarget(text: string): { target: ScanTarget | null; cue: StartPath | null } {
  const { rest, cue } = stripPreamble(text);
  if (cue === "company") {
    const name = nameAhead(rest);
    const read = scanInput(name);
    if (read?.kind === "product" && name.split(/\s+/).length <= 5) return { target: { ...read, mine: true }, cue };
    return { target: startTarget("company", rest) ?? scanInput(rest), cue };
  }
  if (cue === "idea") return { target: startTarget("idea", rest), cue };
  return { target: scanInput(rest), cue };
}

const TEAM_WORDS = /\b(?:we|we're|we've|we'd|our|ours|us)\b|\bmy (?:company|team|startup|employer|job|manager)\b|\bmy (?:own )?(?:[\w-]+ ){0,2}(?:app|store|shop|business|product|platform|clinic|restaurant|website|service)\b|\bat work\b|\bi work (?:at|for|on)\b|تطبيقنا|شركتنا|عملاؤنا|عملائنا|فريقنا|منتجنا|نحن/i;
const SOLO_WORDS = /\bmy (?:own )?idea\b|\bi (?:want|plan|would like|'d like) to (?:build|make|create|start)\b|\bi(?:'m| am) (?:building|making|thinking (?:of|about))\b|\bside project\b|\bwould (?:people|anyone) pay\b|\bjust me\b|فكرتي|أفكر في|مشروعي/i;

/**
 * Whose it is, from their words and where their docs came from. A product with "we" or "our" is
 * theirs; "my idea" or "I'm building" is their own; a bare product's name or docs that say nothing
 * leave it unsure, and the chat asks after Send.
 */
export function whoseOf(text: string, docs: readonly BoxDoc[], target: ScanTarget | null, cue: StartPath | null = null): Whose {
  const team = cue === "company" || TEAM_WORDS.test(text) || docs.some((d) => d.group === "voice");
  const solo = cue === "idea" || SOLO_WORDS.test(text);
  if (team && solo) return { shape: "team", mine: false, sure: false, ask: "shape" };
  if (team) return { shape: "team", mine: target?.kind === "product", sure: true };
  if (solo) return { shape: "solo", mine: false, sure: true };
  if (target?.kind === "product") return { shape: "solo", mine: false, sure: false, ask: "product" };
  if (target?.kind === "idea") return { shape: "solo", mine: false, sure: true };
  return { shape: "solo", mine: false, sure: false, ask: "shape" };
}

const titleName = (title: string) => {
  const t = title.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > 48 ? t.slice(0, 48).replace(/\s+\S*$/, "") : t;
};

/**
 * What the box's message becomes in the canvas chat, and the project it makes. Words alone are worked
 * out with them by the consultant (an app's link with its reviews offered), or taken in as customers'
 * words, or kept as their thinking when they're long. Docs are taken in, then their words are worked
 * out with them; their own thinking's docs ask their own rounds. `pasted`: whose words the text reads
 * as (`guessVoice`).
 */
export function startPlan(text: string, docs: readonly BoxDoc[], pasted?: "customers" | "own"): StartPlan | null {
  const said = text.trim();
  const { target, cue } = said && said.length <= SCAN_MAX ? boxTarget(said) : { target: null, cue: null };
  const whose = whoseOf(said, docs, target, cue);
  const name = target ? projectName(target) : titleName(docs.find((d) => !d.image)?.title ?? "") || "New project";
  const consult: StartTurn[] = said && said.length <= SCAN_MAX ? [{ mode: "consult", said, ...(isAppLink(said) ? { offer: true as const } : {}) }] : [];
  if (!docs.length) {
    if (!said) return null;
    if (pasted === "customers") return { turns: [{ mode: "take", said }], name, whose };
    if (said.length > SCAN_MAX) return { turns: [{ mode: "dump", said }], name, whose };
    return { turns: consult, name, whose };
  }
  const own = docs.every((d) => d.basis === "own");
  return { turns: [{ mode: own ? "dump" : "take", said }, ...(own ? [] : consult)], name, whose };
}

/** What stops the box's message, in words; null when it can go. */
export function startProblem(text: string, docs: readonly BoxDoc[], engine: "ok" | "none" | "checking"): string | null {
  if (!text.trim() && !docs.length) return "Say what you're working on, or add a file.";
  if (docs.filter((d) => d.image).length > START_PICTURES) return `Up to ${START_PICTURES} pictures at a time.`;
  if (docs.length && engine === "none") return "Qalam AI needs to be set up to read files. Set it up, or send just your words.";
  return null;
}
