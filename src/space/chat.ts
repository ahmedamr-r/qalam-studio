import type { BusinessLine } from "@/business/types";
import type { PlaybookId } from "@/consult/playbooks.gen";
import type { Level, Situation } from "@/consult/situation";
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
import type { BriefShape } from "@/discovery/brief";
import type { Drafted, SolutionDraft } from "@/discovery/solutions";
import type { Proposal } from "@/discovery/proposals";
import type { PlanLook, PlanRound } from "./plan";
import type { ChatMode } from "./route";
import type { AskingState } from "@/asking/types";
import type { KeptChallenge } from "@/challenge/types";
import { awaitsConfirm, currentRound, forDraft, loaded } from "@/asking/engine";
import type { Candidate, ToolRun } from "@/connectors/everywhere";

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
  /** A picture: its asset, for a thumbnail. */
  image?: string;
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
  /** It needs Qalam AI and there's no engine here: nothing ran. `mode`: how it's taken once there is (none: there's nothing to send again). */
  | { kind: "noEngine"; mode: ChatMode | null }
  /**
   * Their words as a goal's or a problem's card: Qalam AI's wording first (`suggesting`, then
   * `suggested`, for them to use, edit or leave for their own words; none when it found none to
   * suggest), then the card written (`card`).
   */
  | { kind: "add"; what: "goal" | "problem"; card: string; under: string | null; state?: "suggesting" | "suggested"; suggestion?: string; why?: string }
  /** Material taken in as sources: read for what it states, filed into problem pages, placed where it fits. `docs`: what each was read as (none: a turn from before). */
  | { kind: "take"; state: "taking" | "done" | "failed"; sources: string[]; pages: FiledPage[]; quotes: number; docs?: TakenDoc[]; error?: string; /** Docs that couldn't be read or kept, each with why: the rest went on. */ left?: { title: string; why: string }[] }
  /**
   * Their own thinking as a brain dump: its source's session is how it's going (`error`: it never
   * started; `find`: it answers "Help me find one", with what they said to code's questions;
   * `file`: a file added for a card, read against it, `left` once they left it out; `asOwn`: a doc
   * that read as their own thinking when taken in, `cut` when only its start fits).
   */
  | { kind: "dump"; source: string; error?: string; asOwn?: { title: string; cut?: true }; find?: { what: FindWhat; said: { question: string; answer: string; before?: string }[]; goal?: FocusGoal }; file?: { card: string; title: string; left?: true } }
  /**
   * "Help me find one": the opening questions, being answered (the box asks them). `goal`: the
   * problem to focus on for a goal on the canvas, its opening questions asked once Qalam AI has
   * looked on the web for what usually gets in its way (`look`).
   */
  | ScanJob
  /** A brief for a card on the canvas: what it lacks asked in the box, then written, then a tile under the card. */
  | { kind: "brief"; card: string; title: string; brief: BriefState; /** What's written: none, a brief to build. */ shape?: BriefShape }
  | PlanJob
  | DraftJob
  | { kind: "find"; what: FindWhat; error?: string; /** Qalam AI's opening questions, from what's known about the company and its domain (none: code's own). */ questions?: PlanQuestion[]; /** Those being worked out. */ loading?: true; goal?: FocusGoal; look?: FocusLook }
  | GoalForJob
  | WhoseJob
  | ToolsJob;

/**
 * Looking in every connected tool for something (src/connectors/everywhere.ts): `looking` while each
 * tool's searcher runs (`runs`, as they go), `found` with what they found for them to tick (Qalam AI's
 * picks ticked to start), `bringing` while the ticked ones are taken in, `brought` with where they
 * went, `left` when they took none. `card`: a card's look, whose finds are placed only under it
 * (`scope`; {} when its board isn't made yet). `from`: the question it looked further for.
 */
export interface ToolsJob {
  kind: "tools";
  about: string;
  state: "looking" | "found" | "bringing" | "brought" | "left" | "failed";
  runs: ToolRun[];
  found?: Candidate[];
  ticked?: string[];
  card?: { id: string; title: string };
  scope?: Record<string, string[]>;
  from?: string;
  /** The interview's lookup it is (a turn asked for it and they said yes): what they bring in lands there. */
  lookup?: { turn: string; id: string };
  brought?: { added: string[]; skipped: string[]; failed: { title: string; why: string }[]; sources: string[]; pages: string[] };
  secs?: number;
  error?: string;
}

/**
 * Whose it is, asked after the start page's box when its words didn't say: whether the product
 * named is theirs (its reviews then count as its customers' words), or who the project is for.
 * `scan`: the scan turn the answer bears on.
 */
export interface WhoseJob {
  kind: "whose";
  ask: "product" | "shape";
  name?: string;
  scan?: string;
  answer?: "ours" | "theirs" | "team" | "solo";
}

/**
 * Something worked out as a plan (src/space/plan.ts): `thinking` what's still open, `looking` while a
 * turn waits on a lookup, `asking` a round in the box, `settled` showing what was settled before it
 * proposes, `proposing`, then `review` while its proposals are on the canvas and `placed` once they're
 * settled. The conversation is the interview's (`asking`, src/asking/), kept here and sent with each
 * call; `rounds` are a plan's from before it, and `looks` every web look, for the thread.
 */
/**
 * Worked out with a consultant (src/consult/, server/org/consult.ts): who's asking, the playbook in use
 * and since which turn, the level its last turn was asked at, and the lines noted on the business page
 * after the round whose answers said them. Plan mode without it is as it was.
 */
export interface ConsultState {
  situation?: Situation;
  playbook?: PlaybookId;
  /** The turn the playbook was last picked at: a switch holds a while (src/consult/situation.ts). */
  since?: number;
  level?: Level;
  noted: { round: number; lines: BusinessLine[] }[];
  /** A short statement: which "Just add it" chip leads. */
  first?: "goal" | "problem";
  /** They asked for fixes as well as the diagnosis. */
  fixes?: true;
}

export interface PlanJob {
  kind: "plan";
  /** Worked out with a consultant. */
  consult?: ConsultState;
  step: "looking" | "thinking" | "asking" | "settled" | "proposing" | "review" | "placed" | "failed";
  rounds: PlanRound[];
  looks: PlanLook[];
  asking?: AskingState;
  /** Their own answers, kept as a source of their words as it proposed (never filed into problem pages). */
  answers?: string;
  proposals?: Proposal[];
  /** The cards it proposed: what's on the canvas of them once it's settled is what was taken. */
  cards?: string[];
  /** What it doubts most, in a line. */
  doubt?: string;
  /** The card to start with, in its words. */
  start?: string;
  /** Skipped the questions: it goes by what it has. */
  skipped?: true;
  /** What their own evidence said against what it proposed before, which they kept: it proposed again by it (src/challenge/). */
  kept?: KeptChallenge[];
  error?: string;
}

export type { KeptChallenge };

/**
 * Questions before a card's draft (src/asking/, server/org/ask-card.ts): the interview in the chat,
 * as many rounds as it needs, then the card's own draft (Draft solutions, Draft its problems, Break it
 * down, its tests). `thinking` a turn, `looking` while a turn waits on a lookup, `asking` a round in the
 * box, `settled` showing what was settled, `drafting`, then `done`. Its answers are kept as a source of
 * their own words (`source`), which the card rests on once it's drafted.
 */
export interface DraftJob {
  kind: "draft";
  card: string;
  title: string;
  step: "draft-solutions" | "break-down" | "draft-problems" | "draft-tests";
  phase: "thinking" | "looking" | "asking" | "settled" | "drafting" | "done" | "failed";
  asking: AskingState;
  source: string | null;
  /** What their words in the first answer are to the tree, as Qalam AI read them. */
  role: string | null;
  /** Break it down's levers, picked before the questions. */
  levers: string[];
  /** The draft ran and opened nothing new on the canvas (it said why). */
  none?: true;
  error?: string;
}

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
  /** They said it's theirs while it was still reading: its reviews become its customers' words once it's done. */
  mineSaid?: true;
  /** The questions while it reads: `writing` them, `asking` in the box, `done` once answered or left. Nothing waits on them. */
  ask?: { step: "writing" | "asking" | "done"; questions?: PlanQuestion[] };
  /** What they've said while it reads: heard by what's left to read, not asked again after. */
  told?: ScanSaid[];
  /** From its problems to what to build first. */
  plan?: ScanPlan;
  /**
   * A look a consultant's conversation offered and they said yes to (src/asking/: a `scan` lookup): it
   * reads beside the conversation, which goes on, and what it finds goes back there.
   */
  lookup?: { turn: string; id: string };
}

/** Where a brief stands: `asking` what it lacks, `writing`, then `ready` with which it is, a tile under its card. */
/** A brief being worked out (Qalam AI's turn, a lookup it waits on) or written. */
const briefWorking = (b: BriefState) => b.step === "writing" || b.step === "thinking" || b.step === "looking";

/** A brief worked out or written when the page went stops there, its interview kept (with nothing running) for Try again. */
function briefBack(b: BriefState): BriefState {
  if (b.step === "writing" || b.step === "thinking" || b.step === "looking") return { ...b, ...(b.asking ? { asking: loaded(b.asking) } : {}), step: "failed", error: "It stopped when the page closed." };
  return b.asking && b.asking.lookups.some((l) => l.state === "running") ? { ...b, asking: loaded(b.asking) } : b;
}

/**
 * A brief, a message plan or steps to run, for a card: the interview first (src/asking/: code's own
 * questions, then Qalam AI's, for as long as it needs; `thinking`, `looking`, `asking`, `settled`), then
 * written. `questions`: the questions a brief from before asked, read as the interview's first round.
 */
export interface BriefState {
  step: "asking" | "thinking" | "looking" | "settled" | "writing" | "ready" | "failed";
  questions?: PlanQuestion[];
  asking?: AskingState;
  /** Their answers, kept as a source of their own words. */
  source?: string;
  id?: string;
  file?: string;
  error?: string;
}

/** The steps from a scan's problems to what to build first, each kept so a reload shows it as it was. */
export interface ScanPlan {
  /** `questioning`: Qalam AI's turn (or a lookup it waits on); `asking`: a round in the box; `settled`: What we settled. */
  step: "questioning" | "asking" | "settled" | "reading" | "audiences" | "goal" | "picking" | "picked" | "placed" | "failed";
  /** The questions a plan from before asked: read as the interview's first round. */
  questions?: PlanQuestion[];
  /** The interview before who it's for (src/asking/): what they told the scan while it read as an answered round, then Qalam AI's, for as long as it needs. */
  asking?: AskingState;
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
  /** The brief for whoever builds it: `asking` what it lacks, `writing`, then `ready` with where it is. */
  brief?: BriefState;
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
  /** Their words were shown on an earlier turn (the start page's box): read here, not shown again. */
  quiet?: true;
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
  if (j.kind === "scan" && j.plan?.brief && briefBack(j.plan.brief) !== j.plan.brief) return { ...j, plan: { ...j.plan, brief: briefBack(j.plan.brief) } };
  if (j.kind === "brief" && briefBack(j.brief) !== j.brief) return { ...j, brief: briefBack(j.brief) };
  // What was being worked out when the page went stops there: they can ask again.
  if (j.kind === "scan" && j.plan && (j.plan.step === "questioning" || j.plan.step === "reading" || j.plan.step === "picking")) return { ...j, plan: { ...j.plan, ...(j.plan.asking ? { asking: loaded(j.plan.asking) } : {}), step: "failed", error: "It stopped when the page closed." } };
  if (j.kind === "goalfor" && j.step === "looking") return { ...j, step: "failed", error: "It stopped when the page closed." };
  if (j.kind === "plan" && (j.step === "looking" || j.step === "thinking" || j.step === "proposing")) return { ...j, ...(j.asking ? { asking: loaded(j.asking) } : {}), step: "failed", error: "It stopped when the page closed." };
  // Lookups running when the page closed: nothing runs them now.
  if (j.kind === "plan" && j.asking) return { ...j, asking: loaded(j.asking) };
  if (j.kind === "draft" && (j.phase === "thinking" || j.phase === "looking" || j.phase === "drafting")) return { ...j, asking: loaded(j.asking), phase: "failed", error: "It stopped when the page closed." };
  if (j.kind === "draft") return { ...j, asking: loaded(j.asking) };
  // A number still being worked out when the page went: theirs to type.
  if (j.kind === "goalfor" && j.step === "suggesting") return { ...j, step: "suggested", suggestion: null };
  // A look across the tools that hadn't finished: nothing runs it now. Bringing in goes on in the core.
  if (j.kind === "tools" && j.state === "looking") return { ...j, state: "failed", error: "It stopped when the page closed. Look again." };
  if (j.kind === "tools" && j.state === "bringing") return { ...j, state: "failed", error: "The page closed while they were being taken in. What was kept is in the sources." };
  return j;
}

const KINDS = new Set(["ask", "choose", "noEngine", "add", "take", "dump", "find", "goalfor", "scan", "brief", "plan", "draft", "whose", "tools"]);

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

/** A scan started from the first run, as if it had been asked for in the chat: nothing left to ask, and the chat follows it from here. */
export const scanTurn = (target: ScanTarget, said: string, session: ScanSession, told?: readonly ScanSaid[]): ChatTurn => ({
  id: `scan-${session.at}`,
  at: session.at,
  said,
  job: { kind: "scan", target, asked: session.at, session, ask: { step: "done" }, ...(target.kind === "product" && target.mine ? { mine: true as const } : {}), ...(told?.length ? { told: [...told] } : {}) },
});

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
  parts: [...(t.said.trim() && !t.quiet ? [{ type: "text" as const, text: t.said }] : []), ...(t.docs?.length ? [{ type: "data" as const, name: "docs", data: { turn: t.id } }] : [])],
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
      return [...out, text(last > 0 ? "More I can't tell from here: answer what you can, or take my picks." : "Some questions before I place it on the canvas: answer what you can, or take my picks."), ...(s.file ? [part("skip", id)] : [])];
    case "settled":
      return [...out, part("dumpSettled", id)];
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

const DRAFT_WORDS: Record<DraftJob["step"], string> = { "draft-solutions": "draft solutions", "break-down": "break it down", "draft-problems": "draft its problems", "draft-tests": "draft its tests" };

/** Questions before a card's draft in the thread: each round answered, what was found in their project, What we settled, then the draft. */
function draftReply(t: ChatTurn, j: DraftJob): ChatPart[] {
  const id = { turn: t.id };
  const s = j.asking;
  const out: ChatPart[] = [text(`Before I ${DRAFT_WORDS[j.step]} for “${j.title}”: what I can find myself, then what only you can tell me.`)];
  const open = !!currentRound(s);
  s.rounds.forEach((_r, i) => {
    if (open && i === s.rounds.length - 1) return;
    out.push(part("askAnswered", { turn: t.id, round: i }));
  });
  // What the web looks found, each folded to a row; then what their project and people online had.
  for (const l of s.lookups) if (l.kind === "web" && l.state === "done" && l.look) out.push(part("planLook", { turn: t.id, lookup: l.id }));
  if (s.lookups.some((l) => l.kind !== "web" && l.state === "done" && l.lines?.length)) out.push(part("askFound", id));
  switch (j.phase) {
    case "thinking":
    case "drafting":
      return [...out, part("working", id)];
    case "looking":
      // Asked all it needed, and the draft waits on a look in the background: they can draft now.
      return s.end && forDraft(s).length ? [...out, part("working", id), part("draftNow", id)] : [...out, part("working", id)];
    case "asking":
      return [...out, text(s.offer ? offerLine(s.offer) : "Answer what you can, or take my picks.")];
    case "settled":
      return awaitsConfirm(s) ? [...out, part("draftSettled", id)] : [...out, part("working", id)];
    case "done":
      return [...out, text(j.none ? "Nothing new came of the draft this time." : "Drafted: what I proposed went on the canvas, to accept or discard."), ...(j.none ? [] : [part("draftChecked", id)])];
    case "failed":
      return [...out, text(`I couldn't finish: ${j.error ?? "something went wrong"}`), part("draftRetry", id)];
  }
}

/** What Qalam AI says once they've said whose it is. */
const WHOSE_SAID: Record<NonNullable<WhoseJob["answer"]>, (name?: string) => string> = {
  ours: (name) => `Then ${name ?? "its"}${name ? "'s" : ""} reviews count as your customers' words.`,
  theirs: () => "Then its reviews are people online, not your customers.",
  team: () => "A team's, then.",
  solo: () => "Just you, then.",
};

/**
 * A plan in the thread: each round answered and each look as it came, what was found in their project,
 * What we settled before it proposes, then where it stands. A plan from before the interview reads as it did.
 */
function planReply(t: ChatTurn, j: PlanJob): ChatPart[] {
  if (j.consult) return consultReply(t, j, j.consult);
  const id = { turn: t.id };
  const s = j.asking;
  const looks = (after: number) => j.looks.flatMap((l, i) => (l.after === after ? [part("planLook", { turn: t.id, look: i })] : []));
  const out: ChatPart[] = [text(s ? "I'll work this out with you: what I can find myself, what only you can tell me, then cards on the canvas for you to accept." : "I'll work this out as a plan: a look around, what I can't tell from here, then cards on the canvas for you to accept."), part("justAnswer", id), ...looks(-1)];
  const rounds = s ? s.rounds : j.rounds;
  const open = s ? !!currentRound(s) : j.step === "asking";
  rounds.forEach((_r, i) => {
    if (open && i === rounds.length - 1) return;
    out.push(part(s ? "askAnswered" : "planAnswered", { turn: t.id, round: i }), ...looks(i));
  });
  if (s?.lookups.some((l) => l.kind === "project" && l.state === "done" && l.lines?.length)) out.push(part("askFound", id));
  switch (j.step) {
    case "looking":
    case "thinking":
    case "proposing":
      return [...out, part("working", id)];
    case "asking":
      if (!s) return [...out, text(j.rounds.length > 1 ? "A few more, then I'll propose it." : "A few questions first: answer what you can."), part("planSkip", id)];
      return [...out, text(s.offer ? offerLine(s.offer) : s.rounds.length > 1 ? "More I can't tell from here: answer what you can, or take my picks." : "Some questions first: answer what you can, or take my picks.")];
    case "settled":
      return s && awaitsConfirm(s) ? [...out, part("askSettled", id)] : [...out, part("working", id)];
    case "review":
      return [...out, part("planProposed", id)];
    case "placed":
      return [...out, part("planPlaced", id)];
    case "failed":
      return [...out, text(`I couldn't finish: ${j.error ?? "something went wrong"}`), part("planRetry", id)];
  }
}

/**
 * A conversation with the consultant in the thread: before each round that follows answers, what's
 * settled and what's still open (not for someone seasoned); each round answered, then what it noted on
 * the business page and the looks that came after it; What we settled before it proposes.
 */
function consultReply(t: ChatTurn, j: PlanJob, c: ConsultState): ChatPart[] {
  const id = { turn: t.id };
  const s = j.asking;
  const reflect = c.level !== "seasoned";
  const looks = (after: number) => j.looks.flatMap((l, i) => (l.after === after ? [part("planLook", { turn: t.id, look: i })] : []));
  const out: ChatPart[] = [text("Let's work it out. I'll ask what only you know, then put what we find on your canvas.")];
  // A short statement: a way to just add it as it is, until they've answered something.
  if (c.first && !s?.rounds.some((r) => r.form.submitted || !!r.said) && j.step !== "review" && j.step !== "placed") out.push(part("consultFirst", id));
  const rounds = s?.rounds ?? [];
  const open = s ? !!currentRound(s) : false;
  rounds.forEach((r, i) => {
    if (open && i === rounds.length - 1) return;
    if (reflect && r.reflect) out.push(part("consultReflect", { turn: t.id, round: i }));
    out.push(part("askAnswered", { turn: t.id, round: i }));
    if (c.noted.some((n) => n.round === i && n.lines.length)) out.push(part("consultNoted", { turn: t.id, round: i }));
    out.push(...looks(i));
  });
  if (s?.lookups.some((l) => l.kind === "project" && l.state === "done" && l.lines?.length)) out.push(part("askFound", id));
  // Reading what people say online, offered beside the rounds until they say yes or not now.
  if (s?.scan && !s.scan.said && j.step !== "review" && j.step !== "placed" && j.step !== "failed") out.push(part("consultScan", id));
  switch (j.step) {
    case "looking":
    case "thinking":
    case "proposing":
      return [...out, part("working", id)];
    case "asking": {
      const cur = s ? currentRound(s) : null;
      if (reflect && cur?.reflect) out.push(part("consultReflect", { turn: t.id, round: rounds.length - 1 }));
      return [...out, text(s?.offer ? offerLine(s.offer) : rounds.length > 1 ? "Answer what you can, and skip anything you don't know." : "A few questions first. Answer what you can, and skip anything you don't know.")];
    }
    case "settled":
      return s && awaitsConfirm(s) ? [...out, part("askSettled", id)] : [...out, part("working", id)];
    case "review":
      return [...out, part("planProposed", id)];
    case "placed":
      return [...out, part("planPlaced", id)];
    case "failed":
      return [...out, text(`I couldn't finish: ${j.error ?? "something went wrong"}`), part("planRetry", id)];
  }
}

/** A lookup put to them, in a line. */
const offerLine = (o: NonNullable<AskingState["offer"]>) => (o.kind === "tools" ? "I'd look in your tools for this next, before asking you more. Should I?" : "I'd look this up next, before asking you more. Should I?");

/** A look across the tools in the thread: each tool as it goes, then what they found to tick, then where the ticked ones went. */
function toolsReply(j: ToolsJob, id: PartData): ChatPart[] {
  switch (j.state) {
    case "looking":
      return [part("toolsLooking", id)];
    case "found":
      return [part("toolsFound", id)];
    case "bringing":
      return [part("working", id)];
    case "brought":
      return [part("toolsBrought", id)];
    case "left":
      return [text("You left them. Nothing was taken in."), part("toolsAgain", id)];
    case "failed":
      return [text(`I couldn't look: ${j.error ?? "something went wrong"}`), part("toolsAgain", id)];
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
      return [part("answer", id), part("lookTools", id), part("switch", id)];
    case "tools":
      return toolsReply(j, id);
    case "choose":
      return [text("Is it a goal or a problem? I'll suggest how to word it for the canvas."), part("choose", id)];
    case "noEngine":
      return [text("That needs Qalam AI, which isn't set up on this computer yet. It runs on your own Claude Code or Codex."), part("noEngine", id)];
    case "add":
      if (j.state === "suggesting") return [part("working", id)];
      if (j.state === "suggested") return [part("statement", id)];
      return [part("added", id)];
    case "take": {
      const left = j.left?.length ? [text(j.left.map((l) => `I couldn't take “${l.title}”: ${l.why}`).join("\n"))] : [];
      if (j.state === "taking") return [...left, part("working", id)];
      if (j.state === "failed") return [...left, text(j.error ?? "It couldn't be taken in.")];
      if (j.docs)
        return [
          part("taken", id),
          ...(j.pages.length ? [text(`It went into ${j.pages.length === 1 ? "this problem's page" : "these problems' pages"}:`), part("pages", id)] : []),
          ...left,
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
        ...left,
      ];
    }
    case "whose":
      if (j.answer) return [text(WHOSE_SAID[j.answer](j.name))];
      return [text(j.ask === "product" ? `Is ${j.name ?? "this"} yours, or are you looking into it?` : "Is this for a team, or just you?"), part("whose", id)];
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
    case "brief":
      return [part("brief", id)];
    case "plan":
      return planReply(t, j);
    case "draft":
      return draftReply(t, j);
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
  // A turn with no words or docs of theirs (one the start page's box began, a question Qalam AI asks) is Qalam AI's alone.
  return c.turns.flatMap((t) => {
    const y = you(t);
    return y.parts.length ? [y, reply(t, replyTo(t, dumpOf))] : [reply(t, replyTo(t, dumpOf))];
  });
}

/** Whose questions the box asks now: the newest "Help me find one" or brain dump waiting on its answers. */
export function asking(c: CanvasChat, dumpOf: DumpOf, first?: string | null): ({ turn: ChatTurn } & ({ source: string } | { find: FindWhat } | { number: true } | { plan: true } | { steer: true } | { brief: true } | { planning: true } | { drafting: true })) | null {
  // The picked card's draft, while its questions wait on them, comes before any other round.
  const mine = first ? c.turns.find((t) => t.id === first) : undefined;
  if (mine?.job.kind === "draft" && mine.job.phase === "asking") return { turn: mine, drafting: true };
  for (const t of [...c.turns].reverse()) {
    if (t.job.kind === "scan" && t.job.ask?.step === "asking" && !t.job.error) return { turn: t, steer: true };
    if (t.job.kind === "scan" && t.job.plan?.step === "asking") return { turn: t, plan: true };
    if (t.job.kind === "scan" && t.job.plan?.brief?.step === "asking") return { turn: t, brief: true };
    if (t.job.kind === "brief" && t.job.brief.step === "asking") return { turn: t, brief: true };
    if (t.job.kind === "goalfor" && t.job.step === "asking") return { turn: t, number: true };
    if (t.job.kind === "plan" && t.job.step === "asking") return { turn: t, planning: true };
    if (t.job.kind === "draft" && t.job.phase === "asking") return { turn: t, drafting: true };
    if (t.job.kind === "find") return { turn: t, find: t.job.what };
    if (t.job.kind !== "dump" || t.job.error) continue;
    if (dumpOf(t.job.source)?.phase === "asking") return { turn: t, source: t.job.source };
  }
  return null;
}

// A goal's opening look runs here (the box offers Stop); the questions it works out are asked after.
// A scan a conversation asked for reads beside it: the box stays theirs to answer in.
const scanBusy = (j: ScanJob) => (!j.lookup && !j.error && !j.where && (!j.session || j.session.state === "reading")) || (!!j.plan && (j.plan.step === "questioning" || j.plan.step === "reading" || j.plan.step === "picking" || (!!j.plan.brief && briefWorking(j.plan.brief))));
const busy = (j: ChatJob) => (j.kind === "scan" && scanBusy(j)) || (j.kind === "brief" && briefWorking(j.brief)) || (j.kind === "ask" && j.state === "asking") || (j.kind === "take" && j.state === "taking") || (j.kind === "find" && !!j.goal && !!j.loading) || (j.kind === "goalfor" && (j.step === "looking" || j.step === "suggesting")) || (j.kind === "plan" && (j.step === "looking" || j.step === "thinking" || j.step === "proposing")) || (j.kind === "draft" && (j.phase === "thinking" || j.phase === "looking" || j.phase === "drafting")) || (j.kind === "tools" && j.state === "looking");

/** What in the chat is still running (the composer offers Stop). */
export const running = (c: CanvasChat): ChatTurn | null => [...c.turns].reverse().find((t) => busy(t.job)) ?? null;
