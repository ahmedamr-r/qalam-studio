import type { FoundGoal } from "@/goals/found";
import type { Basis, BasisCounts } from "@/discovery/basis";
import type { DumpSession } from "@/discovery/dump";
import type { AskAnswer } from "@/hub/ask";
import type { SetupDoc } from "@/org/setup";
import type { FindWhat } from "./find";
import type { PlanQuestion } from "@/ai/plan";
import type { FocusLook } from "@/goals/focus";
import type { GoalFit, GoalIdea, MovesFound, SuggestedNumber } from "@/goals/moves";
import type { Benchmark } from "@/goals/outside";
import type { OstMetric } from "@/discovery/types";
import type { ScanSession, ScanTarget } from "@/scan/session";
import type { ScanSaid } from "@/scan/steer";
import type { GoalAction, ScanAudience } from "@/scan/plan";
import type { Drafted, SolutionDraft } from "@/discovery/solutions";

/*
 * Qalam AI's chat on the left of a space's canvas (src/ui/space/chat/), as it's kept: one file per
 * canvas (chats/canvas/<key>.json, this computer's, out of Git), a turn per message sent, each
 * saying what was said and the job it became. The thread is worked out from the turns and what
 * the jobs point at (threadOf), never kept itself, so a reload shows it as it was. Pure.
 */

/** A canvas's key: its product's id, or `org` for the organization's own. */
export const chatKey = (space: string | null) => space ?? "org";
export const CHAT_KEY = /^[A-Za-z0-9_-]{1,64}$/;
/** The newest turns kept: an older one is dropped as a new one comes. */
export const MAX_TURNS = 100;

export type ChatDoc = Omit<SetupDoc, "span" | "cut">;

/** A document as it was read: what it is, its points by what they rest on, and what the person said it is. */
export interface TakenDoc {
  source: string;
  title: string;
  about?: string;
  points: BasisCounts;
  basis?: Basis;
  /** Numbers it measured for goals, each `used` once they took it. */
  numbers?: { goal: string; title: string; value: number; used?: true }[];
  /** Goals it points to, for them to accept or leave out. */
  found?: FoundGoal[];
  /** What came of its pictures, in a line. */
  pictures?: string;
}

/** A problem page material went into. */
export interface FiledPage {
  id: string;
  title: string;
}

export type ChatJob =
  /** A question for the organization, and its checked answer. */
  | { kind: "ask"; state: "asking" | "answered" | "failed"; answer?: AskAnswer; secs?: number; error?: string }
  /** A short statement: is it a goal or a problem (or a question)? The chips say. */
  | { kind: "choose"; first: "goal" | "problem" }
  /**
   * Their words as a goal's or a problem's card: Qalam AI's wording first (`suggesting`, then
   * `suggested`, for them to use, edit or leave for their own words; none when it found none to
   * suggest), then the card written (`card`).
   */
  | { kind: "add"; what: "goal" | "problem"; card: string; under: string | null; state?: "suggesting" | "suggested"; suggestion?: string; why?: string }
  /** Material taken in as sources: read for what it states, filed into problem pages, placed where it fits. `docs`: what each was read as (none: a turn from before). */
  | { kind: "take"; state: "taking" | "done" | "failed"; sources: string[]; pages: FiledPage[]; quotes: number; docs?: TakenDoc[]; error?: string }
  /**
   * Their own thinking as a brain dump: its source's session is how it's going (`error`: it never
   * started; `find`: it answers "Help me find one", with what they said to code's questions;
   * `file`: a file added for a card, read against it, `left` once they left it out; `asOwn`: a doc
   * that read as their own thinking when taken in, `cut` when only its start fits).
   */
  | { kind: "dump"; source: string; error?: string; asOwn?: { title: string; cut?: true }; find?: { what: FindWhat; said: { question: string; answer: string }[]; goal?: FocusGoal }; file?: { card: string; title: string; left?: true } }
  /**
   * "Help me find one": the opening questions, being answered (the box asks them). `goal`: the
   * problem to focus on for a goal on the canvas, its opening questions asked once Qalam AI has
   * looked on the web for what usually gets in its way (`look`).
   */
  | ScanJob
  | { kind: "find"; what: FindWhat; error?: string; /** Qalam AI's opening questions, from what's known about the company and its domain (none: code's own). */ questions?: PlanQuestion[]; /** Those being worked out. */ loading?: true; goal?: FocusGoal; look?: FocusLook }
  | GoalForJob;

/**
 * What people complain about: an idea or a product read in the core (server/org/scan.ts), which goes
 * on if the page closes. `session`: how it stands, its last word kept here since the next scan
 * replaces the core's. `mine`: they said the product is theirs, so its reviews are its customers' words.
 */
export interface ScanJob {
  kind: "scan";
  target: ScanTarget;
  /** When it was asked for: a session from before is an earlier scan's, never this one's. */
  asked: number;
  session?: ScanSession;
  mine?: true;
  error?: string;
  /** Another scan's problems are in this project: where it goes is theirs to say, before it starts. */
  where?: true;
  /** The questions while it reads: `writing` them, `asking` in the box, `done` once answered or left. Nothing waits on them. */
  ask?: { step: "writing" | "asking" | "done"; questions?: PlanQuestion[] };
  /** What they've said while it reads: heard by what's left to read, not asked again after. */
  told?: ScanSaid[];
  /** From its problems to what to build first. */
  plan?: ScanPlan;
}

/** The steps from a scan's problems to what to build first, each kept so a reload shows it as it was. */
export interface ScanPlan {
  step: "questioning" | "asking" | "reading" | "audiences" | "goal" | "picking" | "picked" | "placed" | "failed";
  questions?: PlanQuestion[];
  /** Their answers, as words and as a source of their own. */
  answers?: string;
  answersSource?: string;
  /** The audiences its quotes show (none: reviews often don't say who wrote them). */
  audiences?: ScanAudience[];
  audience?: { name: string; refs: string[] };
  /** The first goal: what they'd do, and how many of how many. A suggestion until they take it. */
  goal?: { action: GoalAction; reach: number; of: number };
  build?: { topic: string; problem: string; drafts: SolutionDraft[]; quotes: Drafted["quotes"]; pick: { draft: string; why: string; later: { draft: string; why: string }[] } | null; note: string };
  /** The draft to build first: Qalam AI's, until they pick another. */
  chosen?: string;
  /** Its solution's card, once it's on the canvas. */
  card?: string;
  error?: string;
}

/**
 * The goal a problem could move (src/goals/moves.ts): `looking` at the goals on the canvas, then the
 * web; `fits` or `ideas` for them to pick; `asking` its number in the box; `suggesting` then
 * `suggested` when they have none in mind; `done` with the problem under the goal.
 */
export interface GoalForJob {
  kind: "goalfor";
  /** The problem's card, its words, its page. */
  card: string;
  title: string;
  topic?: string;
  step: "looking" | "fits" | "ideas" | "asking" | "suggesting" | "suggested" | "done" | "failed";
  fits?: GoalFit[];
  ideas?: GoalIdea[];
  looked?: MovesFound["looked"];
  /** The goal picked: its card on the canvas, its words and number. */
  on?: GoalForOn;
  suggestion?: SuggestedNumber | null;
  error?: string;
}

export interface GoalForOn {
  card: string;
  title: string;
  /** In goals.md already (a goal on the canvas), not one just written. */
  goal?: string;
  metric?: Pick<OstMetric, "name" | "unit" | "direction">;
  now?: number | null;
  /** What others report for it, found when it was looked for. */
  others?: Benchmark[];
}

/** The goal whose problem to focus on: its card on the canvas, its id in goals.md, its words. */
export interface FocusGoal {
  card: string;
  id: string;
  title: string;
}

export interface ChatTurn {
  id: string;
  at: number;
  /** Their words as sent. */
  said: string;
  docs?: ChatDoc[];
  job: ChatJob;
}

export interface CanvasChat {
  v: 1;
  turns: ChatTurn[];
}

export const emptyChat = (): CanvasChat => ({ v: 1, turns: [] });

/** A turn still running when the page went is over (nothing carries it on). */
function stopped(j: ChatJob): ChatJob {
  if (j.kind === "ask" && j.state === "asking") return { ...j, state: "failed", error: "It stopped when the page closed. Ask again." };
  // Capture goes on in the core: what was taken in shows up on the canvas and in its panel.
  if (j.kind === "take" && j.state === "taking") return { ...j, state: "failed", error: "The page closed while it was being taken in. What was kept is in the sources." };
  // A wording still being worked out when the page went: their own words, to add as they are.
  if (j.kind === "add" && j.state === "suggesting") return { ...j, state: "suggested" };
  // Questions still being worked out when the page went: code's own are asked instead.
  if (j.kind === "find" && j.loading) {
    const { loading: _gone, ...rest } = j;
    return rest;
  }
  if (j.kind === "scan" && j.ask?.step === "writing") return { ...j, ask: { step: "done" } };
  // What was being worked out when the page went stops there: they can ask again.
  if (j.kind === "scan" && j.plan && (j.plan.step === "questioning" || j.plan.step === "reading" || j.plan.step === "picking")) return { ...j, plan: { ...j.plan, step: "failed", error: "It stopped when the page closed." } };
  if (j.kind === "goalfor" && j.step === "looking") return { ...j, step: "failed", error: "It stopped when the page closed." };
  // A number still being worked out when the page went: theirs to type.
  if (j.kind === "goalfor" && j.step === "suggesting") return { ...j, step: "suggested", suggestion: null };
  return j;
}

const KINDS = new Set(["ask", "choose", "add", "take", "dump", "find", "goalfor", "scan"]);

/** A chat as read from its file (what it doesn't know is left out). */
export function chatOf(raw: unknown): CanvasChat {
  const c = raw as Partial<CanvasChat> | null;
  if (!c || c.v !== 1 || !Array.isArray(c.turns)) return emptyChat();
  return {
    v: 1,
    turns: c.turns.filter((t) => t && typeof t.id === "string" && typeof t.said === "string" && KINDS.has(t.job?.kind)).map((t) => ({ ...t, job: stopped(t.job) })),
  };
}

/** A turn added: the newest MAX_TURNS kept. */
export const withTurn = (c: CanvasChat, t: ChatTurn): CanvasChat => ({ ...c, turns: [...c.turns, t].slice(-MAX_TURNS) });

/** A turn changed in place (gone: nothing changes). */
export const withJob = (c: CanvasChat, id: string, fn: (j: ChatJob) => ChatJob): CanvasChat => ({ ...c, turns: c.turns.map((t) => (t.id === id ? { ...t, job: fn(t.job) } : t)) });

// ---------------------------------------------------------------------------
// The thread

export type PartData = Record<string, string | number | boolean | null>;
export type ChatPart = { type: "text"; text: string } | { type: "data"; name: string; data: PartData };
export interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  parts: ChatPart[];
}

const you = (t: ChatTurn): ChatMessage => ({
  id: `${t.id}:you`,
  role: "user",
  parts: [...(t.said.trim() ? [{ type: "text" as const, text: t.said }] : []), ...(t.docs?.length ? [{ type: "data" as const, name: "docs", data: { turn: t.id } }] : [])],
});

const reply = (t: ChatTurn, parts: ChatPart[]): ChatMessage => ({ id: `${t.id}:ai`, role: "assistant", parts });
const text = (s: string): ChatPart => ({ type: "text", text: s });
const part = (name: string, data: PartData): ChatPart => ({ type: "data", name, data });

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** A dump's session by its source's id (null: not loaded, or gone). */
export type DumpOf = (source: string) => DumpSession | null;

/** The looks on the web after a round (-1: before the first), as the thread shows them. */
const looksAfter = (t: ChatTurn, s: DumpSession | null, round: number): ChatPart[] => (s?.looks ?? []).flatMap((l, i) => (l.after === round ? [part("looked", { turn: t.id, look: i })] : []));

/** A brain dump in the thread: what Qalam AI took from it, each round answered (and what it looked up after), then where it stands. */
function dumpReply(t: ChatTurn, s: DumpSession | null): ChatPart[] {
  const id = { turn: t.id };
  if (!s || s.phase === "reading") return [part("dumping", id)];
  const out: ChatPart[] = [];
  if (s.understanding || s.challenges.length) out.push(part("took", id));
  const last = s.buckets.length - 1;
  s.buckets.forEach((b, i) => {
    if (i >= last && s.phase === "asking") return;
    // What it took from a round it looked something up after reads it with what the look found: the look first.
    const looked = looksAfter(t, s, i);
    if (looked.length && b.analysis) out.push(part("answered", { turn: t.id, round: i, bare: true }), ...looked, part("analysis", { turn: t.id, round: i }));
    else out.push(part("answered", { turn: t.id, round: i }), ...looked);
  });
  switch (s.phase) {
    case "asking":
      return [...out, text(last > 0 ? "A few more questions, then I'll place it." : "A few questions before I place it on the canvas: answer what you can."), part("skip", id)];
    case "analyzing":
    case "placing":
      return [...out, part("dumping", id)];
    case "ready":
      // A file that doesn't bear on its card: what would help instead.
      if (s.off) return [...out, part("off", id)];
      return [...out, text(s.skipped ? "I'll place it with what you've answered." : "I have what I need."), part("place", id)];
    case "review":
      return [...out, part("proposed", id)];
    case "placed":
      return [...out, part("placed", id)];
    case "failed":
      return [...out, text(s.failed?.error === "Stopped." ? "You stopped me before I finished." : `I couldn't finish: ${s.failed?.error ?? "something went wrong"}`), part("retry", id)];
  }
}

/** What Qalam AI says to a turn, from its job. */
function replyTo(t: ChatTurn, dumpOf: DumpOf): ChatPart[] {
  const j = t.job;
  const id = { turn: t.id };
  switch (j.kind) {
    case "ask":
      if (j.state === "asking") return [part("working", id)];
      if (j.state === "failed") return [text(`I couldn't answer that: ${j.error ?? "something went wrong"}`), part("switch", id)];
      return [part("answer", id), part("switch", id)];
    case "choose":
      return [text("Is it a goal or a problem? I'll suggest how to word it for the canvas."), part("choose", id)];
    case "add":
      if (j.state === "suggesting") return [part("working", id)];
      if (j.state === "suggested") return [part("statement", id)];
      return [part("added", id)];
    case "take":
      if (j.state === "taking") return [part("working", id)];
      if (j.state === "failed") return [text(j.error ?? "It couldn't be taken in.")];
      if (j.docs)
        return [
          part("taken", id),
          ...(j.pages.length ? [text(`It went into ${j.pages.length === 1 ? "this problem's page" : "these problems' pages"}:`), part("pages", id)] : []),
        ];
      return [
        text(
          j.pages.length
            ? `I kept ${plural(j.sources.length, "source")}. ${j.quotes ? `${plural(j.quotes, "quote")} from customers went` : "What it says went"} into ${j.pages.length === 1 ? "this problem's page" : "these problems' pages"}:`
            : j.quotes
              ? `I kept ${plural(j.sources.length, "source")} and found ${plural(j.quotes, "quote")} from customers, but no problem's page took them in yet.`
              : `I kept ${plural(j.sources.length, "source")}, but found nothing customers said in ${j.sources.length === 1 ? "it" : "them"}.`,
        ),
        ...(j.pages.length ? [part("pages", id)] : []),
      ];
    case "dump": {
      if (j.file?.left) return [text(`You left “${j.file.title}” out.`)];
      const s = dumpOf(j.source);
      return [...(j.asOwn ? [part("asOwn", id)] : []), ...looksAfter(t, s, -1), ...(j.find ? [part("opening", id)] : []), ...(j.error ? [text(j.error)] : dumpReply(t, s))];
    }
    case "scan":
      if (j.where) return [part("scanWhere", id)];
      if (j.error) return [text(`I couldn't read it: ${j.error}`), part("scanAgain", id)];
      if (!j.session || j.session.state === "reading") return [part("scanning", id)];
      if (j.session.state === "stopped") return [text("You stopped it before it finished."), part("scanAgain", id)];
      if (j.session.state === "failed") return [text(`I couldn't finish: ${j.session.error ?? "something went wrong"}`), part("scanAgain", id)];
      return [part("scanned", id), ...(j.plan ? [part("scanPlan", id)] : [])];
    case "find":
      if (j.goal) {
        if (j.loading) return [part("working", id), part("cancel", id)];
        return [...(j.look ? [part("looked", id)] : []), text("A few questions first. I'll look things up where your answers call for it, then propose the problems to focus on. Skip any you can't answer."), ...(j.error ? [text(j.error)] : []), part("cancel", id)];
      }
      return [text(`A few questions first, then I'll suggest ${j.what === "goal" ? "a goal" : "a problem"} from what you say. Skip any you can't answer.`), ...(j.error ? [text(j.error)] : []), part("cancel", id)];
    case "goalfor":
      switch (j.step) {
        case "looking":
        case "suggesting":
          return [...(j.on ? [part("goalOn", id)] : []), part("working", id)];
        case "fits":
          return [part("goalFits", id)];
        case "ideas":
          return [part("goalIdeas", id)];
        case "asking":
          return [part("goalOn", id), text("Now its number, so we can tell if it's realistic.")];
        case "suggested":
          return [part("goalOn", id), part("goalNumber", id)];
        case "done":
          return [part("goalDone", id)];
        case "failed":
          return [...(j.on ? [part("goalOn", id)] : []), text(`I couldn't finish: ${j.error ?? "something went wrong"}`), part("goalRetry", id)];
      }
  }
}

/** The conversation, from the turns: each one's words, then what Qalam AI made of it. */
export function threadOf(c: CanvasChat, dumpOf: DumpOf = () => null): ChatMessage[] {
  return c.turns.flatMap((t) => [you(t), reply(t, replyTo(t, dumpOf))]);
}

/** Whose questions the box asks now: the newest "Help me find one" or brain dump waiting on its answers. */
export function asking(c: CanvasChat, dumpOf: DumpOf): ({ turn: ChatTurn } & ({ source: string } | { find: FindWhat } | { number: true } | { plan: true } | { steer: true })) | null {
  for (const t of [...c.turns].reverse()) {
    if (t.job.kind === "scan" && t.job.ask?.step === "asking" && !t.job.error) return { turn: t, steer: true };
    if (t.job.kind === "scan" && t.job.plan?.step === "asking") return { turn: t, plan: true };
    if (t.job.kind === "goalfor" && t.job.step === "asking") return { turn: t, number: true };
    if (t.job.kind === "find") return { turn: t, find: t.job.what };
    if (t.job.kind !== "dump" || t.job.error) continue;
    if (dumpOf(t.job.source)?.phase === "asking") return { turn: t, source: t.job.source };
  }
  return null;
}

// A goal's opening look runs here (the box offers Stop); the questions it works out are asked after.
const scanBusy = (j: ScanJob) => (!j.error && !j.where && (!j.session || j.session.state === "reading")) || (!!j.plan && (j.plan.step === "questioning" || j.plan.step === "reading" || j.plan.step === "picking"));
const busy = (j: ChatJob) => (j.kind === "scan" && scanBusy(j)) || (j.kind === "ask" && j.state === "asking") || (j.kind === "take" && j.state === "taking") || (j.kind === "find" && !!j.goal && !!j.loading) || (j.kind === "goalfor" && (j.step === "looking" || j.step === "suggesting"));

/** What in the chat is still running (the composer offers Stop). */
export const running = (c: CanvasChat): ChatTurn | null => [...c.turns].reverse().find((t) => busy(t.job)) ?? null;
