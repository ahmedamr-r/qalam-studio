import { MAX_DUMP_ROUNDS } from "@/discovery/dump";
import type { SetupSession } from "@/org/setup";
import { wordsFor, type OrgShape } from "@/org/words";
import type { DocRef, SourceFit } from "../chat/attach";
import type { KnowState } from "../setup/know-state";
import type { VoiceChoice } from "@/voice/model";
import type { SetupStep, StepState, WelcomeMode } from "../welcome/steps";

/*
 * The first run as a conversation (pure): every message is read from state that's already kept
 * (the engine's test, the organization, the know door's tab state, the setup's session on its
 * source), so nothing about the chat itself is saved and a reload shows the same thread. Qalam AI
 * says one or two short sentences; anything to act on is a part (`data`) the page draws.
 */

/** The way in: goals they know or want found, problems they hear about, or an idea to test. */
export type Door = "know" | "find" | "problems" | "idea";

export type PartName = "engine" | "verify" | "choices" | "outline" | "said" | "took" | "pushback" | "answers" | "you" | "voice" | "yours" | "connect" | "allSet" | "error" | "working" | "problems" | "docs";

/** Small values only: a part's renderer reads the rest from the stores. */
export type PartData = Record<string, string | number | boolean | null>;

export type ChatPart = { type: "text"; text: string } | { type: "data"; name: PartName; data: PartData };

export interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  parts: ChatPart[];
}

/** Which buttons a `choices` part shows. */
export type ChoiceSet = "shape" | "door" | "skip" | "know-skip" | "propose" | "proposal" | "know-review" | "goals-in" | "verify";

export type EngineState = "looking" | "testing" | "ready" | "problem" | "skipped" | "unknown";

export interface ThreadInput {
  route: "welcome" | "setup";
  mode: WelcomeMode;
  first: boolean;
  orgName: string | null;
  /** A company or team, or just them on their own idea: picked before the name (null: not yet, or an organization from before). */
  shape: OrgShape | null;
  engine: EngineState;
  naming: { name: string | null; busy: boolean; error: string | null };
  /** Who they said they are, once they have ("Ahmed · Product manager"). */
  person: string | null;
  /** Talking instead of typing: what this Mac can have, and what was chosen here (null: not known yet). */
  voice: { offer: "apple" | "parakeet" | "none"; chosen: VoiceChoice | null } | null;
  step: SetupStep;
  door: Door | null;
  /** Goals in the organization's tree (goals.md). */
  goals: number;
  /** The setup page has found what it shows. */
  opened: boolean;
  know: Pick<KnowState, "phase" | "sent" | "answered" | "added" | "error"> & { goals: number; questions: number };
  find: {
    session: SetupSession | null;
    /** Sent and being read, before there's a session. */
    pending: boolean;
    error: string | null;
    /** Lines still to accept or discard, and accepted. */
    open: number;
    accepted: number;
  };
  /** The problems door: what they sent (their words, and the docs that went with them), and what was filed from it (the problem pages it went into, the customers' quotes it held). */
  problems: { sent: string | null; docs?: DocRef[]; result: { pages: number; quotes: number } | null; error: string | null };
  /** The idea door: what they sent, words and docs (the board takes it from there). */
  idea: { sent: string | null; docs?: DocRef[]; error: string | null };
  /** A Qalam AI call running. */
  busy: { label: string } | null;
  /** Goals picked as theirs, once they moved on from Yours. */
  picked: number;
}

const text = (t: string): ChatPart => ({ type: "text", text: t });
const part = (name: PartName, data: PartData = {}): ChatPart => ({ type: "data", name, data });
const ai = (id: string, ...parts: ChatPart[]): ChatMessage => ({ id, role: "assistant", parts });
const you = (id: string, ...parts: ChatPart[]): ChatMessage => ({ id, role: "user", parts });
/** What they sent at a door: their words, then the docs that went with them. */
const said = (x: { sent: string | null; docs?: DocRef[] }, scope: "problems" | "idea"): ChatPart[] => [...(x.sent ? [text(x.sent)] : []), ...(x.docs?.length ? [part("docs", { scope })] : [])];

export const engineDone = (i: Pick<ThreadInput, "engine">) => i.engine === "ready" || i.engine === "skipped";

/** The way in, as chosen or as the setup on the page says. */
export const doorOf = (i: Pick<ThreadInput, "door" | "find">): Door | null => (i.door === "problems" || i.door === "idea" ? i.door : i.find.session || i.find.pending ? "find" : i.door);

/** The way in is done: goals added in their words, every proposed line settled, or problems filed from what customers said. */
export function goalsSettled(i: Pick<ThreadInput, "door" | "find" | "know" | "problems">): boolean {
  const door = doorOf(i);
  return door === "know" ? i.know.phase === "added" : door === "find" ? i.find.session?.phase === "done" : door === "problems" ? !!i.problems.result?.quotes : false;
}

const DOOR_SAID: Record<Door, string> = { know: "I know our goals", find: "Help me find our goals", problems: "Problems we hear about", idea: "An idea to test" };

const ENGINE_LINE: Record<EngineState, string> = {
  looking: "Looking for an engine on this computer…",
  testing: "Found it. Making a short call to check it…",
  ready: "Qalam AI is ready.",
  problem: "Qalam AI can't answer yet.",
  skipped: "Qalam AI can wait: set it up any time in Connections.",
  unknown: "Qalam AI is set up.",
};

const VOICE_ASK = {
  apple: "Want to talk instead of typing? Click the mic in any box, or press ⌃⌥D. It runs on this Mac: nothing you say leaves it.",
  parakeet: "Want to talk instead of typing? Click the mic in any box, or press ⌃⌥D. Parakeet runs it on this Mac: nothing you say leaves it.",
} as const;

const SHAPE_SAID: Record<OrgShape, string> = { team: "A company or team", solo: "Just me, on my own idea" };

/** What to call it, once they said who it's for. */
const nameAsk = (i: Pick<ThreadInput, "mode" | "shape">, live: boolean) =>
  i.shape === "solo" ? "What's the project you have in mind? Just name it, or tell me what you'd like to call it." : i.mode === "new" ? "What's the new organization called?" : live ? "What should I call your organization? A company, a client or a side project." : "What should I call your organization?";

const VOICE_SAID: Record<VoiceChoice, string> ={ apple: "Talk with Apple's engine", parakeet: "Talk with Parakeet", own: "I use my own dictation app", off: "Not now" };

/** The asking round is answered (or there's none to answer). */
function roundOpen(s: SetupSession): boolean {
  const last = s.buckets[s.buckets.length - 1];
  return s.phase === "asking" && !!last && !last.form.submitted;
}

export function threadOf(i: ThreadInput): ChatMessage[] {
  const out: ChatMessage[] = [];
  const solo = i.shape === "solo";
  const org = i.orgName ?? (solo ? "your project" : "your organization");
  const shapeAsk = (id: string) => {
    out.push(ai(`${id}:ask`, text("Is this for a company or team, or just you?"), ...(i.shape ? [] : [part("choices", { set: "shape" })])));
    if (i.shape) out.push(you(`${id}:you`, text(SHAPE_SAID[i.shape])));
  };

  // Qalam AI, who it's for, then the name: live on the welcome, already done on the setup page's first run.
  if (i.route === "welcome") {
    out.push(ai("engine", text(ENGINE_LINE[i.engine]), part("engine")));
    if (i.mode === "verify") {
      out.push(ai("verify", text("Each part, tested again. Nothing is changed."), part("verify"), part("choices", { set: "verify" })));
      return out;
    }
    if (engineDone(i)) {
      shapeAsk("shape");
      if (i.shape) {
        out.push(ai("name:ask", text(nameAsk(i, true))));
        if (i.naming.name) out.push(you("name:you", text(i.naming.name)));
        if (i.naming.error) out.push(ai("name:error", part("error", { text: i.naming.error })));
      }
    }
    if (i.naming.busy) out.push(ai("status:name", part("working", { label: "Making it" })));
    return out;
  }

  if (i.first) {
    out.push(ai("engine", text(ENGINE_LINE[i.engine === "looking" || i.engine === "testing" ? "unknown" : i.engine]), part("engine", { compact: true })));
    // Organizations made before there was a choice don't say: they're a team's.
    if (i.shape) shapeAsk("shape");
    out.push(ai("name:ask", text(nameAsk(i, false))));
    if (i.orgName) out.push(you("name:you", text(i.orgName)));
    // Who they are, before the goals: it tells Qalam AI which goals are theirs to set and how to ask. On your own, only the name.
    out.push(ai("you:ask", text(solo ? "What's your name?" : `What's your name, and your position at ${org}?`), part("you", { open: i.step === "you", solo })));
    if (i.step === "you") return out;
    if (i.person) out.push(you("you:you", text(i.person)));
    // Talking instead of typing, once per Mac: shown while it's asked, and what was chosen after.
    const v = i.voice;
    if (v && v.offer !== "none" && (i.step === "voice" || v.chosen)) {
      out.push(ai("voice:ask", text(VOICE_ASK[v.offer]), part("voice", { open: i.step === "voice", offer: v.offer })));
      if (i.step === "voice") return out;
      if (v.chosen) out.push(you("voice:you", text(VOICE_SAID[v.chosen])));
    }
  }
  if (!i.opened) return out;

  // Goals: a way in, then either door. Picked up past them (from the home, or another window), the goals are the tree's.
  const door = doorOf(i);
  if (i.first && i.step !== "goals" && !door) out.push(ai("goals:had", text(i.goals ? `${org} has ${i.goals === 1 ? "a goal" : `${i.goals} goals`} already.` : "There are no goals yet: add them on the Goals page any time.")));
  else {
    // Three ways in: goals (known, or found in what they write), problems customers raise, or an idea to test.
    const ask = solo ? `How do you want to start with ${org}? An idea on its own is enough.` : `How do you want to start with ${org}? From its goals, from problems customers raise, or from an idea to test.`;
    out.push(ai("goals:ask", text(ask), ...(door ? [] : [part("choices", { set: "door", solo })])));
    if (door) out.push(you("goals:door", text(DOOR_SAID[door])));
  }

  if (door === "problems") {
    const p = i.problems;
    out.push(ai("problems:ask", text("Paste what customers tell you: support tickets, reviews, interview notes, or a link to them. I'll file it into problem pages and show which come up most.")));
    if (p.sent !== null) out.push(you("problems:said", ...said(p, "problems")));
    if (p.error && !i.busy) out.push(ai("problems:error", part("error", { text: p.error })));
    if (p.result && !p.result.quotes && !i.busy)
      out.push(ai("problems:none", text("I found nothing customers said in it. If it's your own thinking, start from an idea instead, or paste customers' own words."), part("choices", { set: "door", solo })));
  }

  if (door === "idea") {
    out.push(ai("idea:ask", text("Tell me the idea: what it does, who it's for, and why you think they need it. I'll put it on a board as a solution to test, ask a few questions, then work back to the problem it solves.")));
    if (i.idea.sent !== null) out.push(you("idea:said", ...said(i.idea, "idea")));
    if (i.idea.error && !i.busy) out.push(ai("idea:error", part("error", { text: i.idea.error })));
  }

  if (door === "know") {
    const k = i.know;
    out.push(ai("know:ask", text("Write them down: the North Star first, then each goal indented under the one it feeds. Add the numbers you have.")));
    if (k.sent) out.push(you("know:outline", part("outline")));
    if (k.questions && (k.phase === "asking" || k.answered)) {
      out.push(ai("know:missing", text(k.questions === 1 ? "One number is missing a part. Answer what you know." : `${k.questions} numbers are missing a part. Answer what you know.`), ...(k.phase === "asking" && !i.busy ? [part("choices", { set: "know-skip" })] : [])));
      if (k.answered) out.push(you("know:answers", ...(k.answered === "answered" ? [part("answers", { scope: "know" })] : [text("Skip the questions")])));
    }
    if (k.phase === "review" && !i.busy) out.push(ai("know:review", text(k.goals === 1 ? "Here's your goal, on the right. Add it when it reads right." : `Here are your ${k.goals} goals, on the right. Leave out any that don't belong, then add them.`), part("choices", { set: "know-review", n: k.goals })));
    if (k.error && !i.busy) out.push(ai("know:error", part("error", { text: k.error })));
  }

  if (door === "find") {
    const s = i.find.session;
    out.push(ai("find:ask", text(solo ? "Paste your notes about the idea, or give its website. I'll read it and ask before I propose anything." : "Paste a strategy doc, OKRs or notes, or give your website. I'll read it and ask before I propose anything.")));
    if (s || i.find.pending) out.push(you("find:said", part("said")));
    if (i.find.error && !s && !i.busy) out.push(ai("find:error", part("error", { text: i.find.error })));
    if (s) {
      const live = s.phase !== "review" && s.phase !== "done";
      if (s.understanding) out.push(ai("find:took", part("took", { round: -1 }), ...(s.challenges.length && live ? [part("pushback")] : [])));
      const open = roundOpen(s) && !i.busy;
      s.buckets.forEach((b, n) => {
        const answered = n < s.buckets.length - 1 || b.form.submitted || s.phase !== "asking";
        if (!answered) return;
        out.push(ai(`find:round:${n}`, text(n === 0 ? "Before I propose anything, a few questions." : `A few more (round ${n + 1} of up to ${MAX_DUMP_ROUNDS}).`)));
        out.push(you(`find:answers:${n}`, ...(b.form.submitted ? [part("answers", { scope: "find", round: n })] : [text("Skip the questions")])));
        if (b.analysis) out.push(ai(`find:analysis:${n}`, part("took", { round: n })));
      });
      if (open) {
        const n = s.buckets.length - 1;
        out.push(ai(`find:round:${n}`, text(n === 0 ? "Before I propose anything, a few questions." : `A few more (round ${n + 1} of up to ${MAX_DUMP_ROUNDS}).`), part("choices", { set: "skip" })));
      }
      if (s.phase === "ready" && !i.busy) out.push(ai("find:ready", text("I have what I need."), part("choices", { set: "propose" })));
      if (s.phase === "failed" && s.failed && !i.busy) out.push(ai("find:failed", part("error", { text: s.failed.error === "Stopped." ? "You stopped Qalam AI before it finished." : `Qalam AI couldn't finish: ${s.failed.error}`, retry: true })));
      if ((s.phase === "review" || s.phase === "done") && s.proposal) {
        if (s.proposal.lines.length)
          out.push(ai("find:proposal", text(s.proposal.summary), text("Review them on the right: accept what's true, discard the rest."), ...(i.find.open ? [part("choices", { set: "proposal", n: i.find.open })] : [])));
        else out.push(ai("find:proposal", text(`I found nothing I could set up from it. Fill in the ${wordsFor(i.shape).org} by hand from its home.`)));
      }
    }
  }

  // The goals are in: on to which are theirs (the first run), or all set.
  if (goalsSettled(i) && door === "problems") {
    // Problems in, no goals yet: on to what to connect (there are no goals to pick as theirs).
    const r = i.problems.result!;
    const said = `Filed ${r.quotes === 1 ? "1 thing customers said" : `${r.quotes} things customers said`} into ${r.pages === 1 ? "1 problem page" : `${r.pages} problem pages`}. Each page shows how strong it is and drafts solutions for it.`;
    out.push(ai("goals:in", text(said), part("problems"), ...(i.first && i.step === "goals" ? [part("choices", { set: "goals-in", solo: true })] : [])));
    if (!i.first) out.push(ai("all-set", text("All set."), part("allSet")));
  } else if (goalsSettled(i)) {
    const written = door === "find" ? i.find.accepted : i.know.added;
    const said = !written ? null : door === "know" ? (written === 1 ? "Your goal is in." : `Your ${written} goals are in.`) : `${written === 1 ? "1 line" : `${written} lines`} written to ${org}.`;
    if (i.first) {
      const moved = i.step !== "goals";
      const next = solo ? "Next: what to connect." : "Next: which goals are yours.";
      out.push(ai("goals:in", text(said ? `${said} ${next}` : "Nothing was written. You can add goals on the Goals page any time."), ...(moved ? [] : [part("choices", { set: "goals-in", solo })])));
    } else out.push(ai("all-set", text(said ? `${said} All set.` : `Nothing was written to ${org}.`), part("allSet")));
  }

  // Which are theirs (on your own every goal is), then what to connect.
  if (i.first && i.step !== "goals" && !solo && door !== "problems") {
    out.push(ai("yours:ask", text("Which goals are yours? Your home leads with them, each with the problems behind it."), part("yours", { open: i.step === "yours" })));
    if (i.step === "connect") out.push(you("yours:you", text(i.picked ? `${i.picked === 1 ? "1 goal" : `${i.picked} goals`} picked` : "None for now")));
  }
  if (i.first && i.step === "connect") out.push(ai("connect:ask", text("Connect what your goals need. Qalam only reads from them."), part("connect")));

  if (i.busy) out.push(ai(`status:${out[out.length - 1]?.id ?? "start"}`, part("working", { label: i.busy.label })));
  return out;
}

// ---------------------------------------------------------------------------
// What the composer takes

export interface Ask {
  /** `problems`: what customers said, to file · `idea`: the idea, for a board. */
  kind: "name" | "dump" | "outline" | "questions" | "problems" | "idea" | "none";
  /** Whose questions take the composer's place. */
  scope?: "know" | "find";
  placeholder: string;
  /** Enter for a line; ⌘↵ for writing that runs to several. */
  submit: "enter" | "ctrlEnter";
  /** Changes when what it takes changes (the draft is set again). */
  key: string;
  /** The docs it takes besides words, and which sources fit: their own thinking, or what customers said. */
  sources?: SourceFit;
}

const none = (placeholder: string, key: string): Ask => ({ kind: "none", placeholder, submit: "enter", key });

export function askOf(i: ThreadInput): Ask {
  if (i.busy || i.naming.busy) return none("Qalam AI is working…", "busy");
  if (i.route === "welcome") {
    if (i.mode === "verify") return none("Checking only: nothing to type here", "verify");
    if (!engineDone(i)) return none(i.engine === "problem" ? "Set up Qalam AI above, or set it up later" : "Checking Qalam AI…", "engine");
    if (!i.shape) return none("Pick one above", "shape");
    return { kind: "name", placeholder: i.shape === "solo" ? "Meal planner" : "Basket", submit: "enter", key: "name" };
  }
  if (i.first && i.step === "you") return none(i.shape === "solo" ? "Fill in your name above" : "Fill in your name and position above", "you");
  if (i.first && i.step === "voice") return none("Choose above, then on to the goals", "voice");
  if (!i.opened) return none("", "opening");
  if (i.step === "yours") return none("Pick your goals above, then Next", "yours");
  if (i.step === "connect") return none("Connect what you need, then Finish", "connect");
  const door = doorOf(i);
  if (!door) return none("Pick a way in above", "door");
  if (door === "problems") {
    if (i.problems.result?.quotes) return none("", "problems:done");
    return { kind: "problems", placeholder: "Paste tickets, reviews or interview notes, or a link to them", submit: "ctrlEnter", key: `problems:${i.problems.sent !== null ? "again" : "first"}`, sources: "customers" };
  }
  if (door === "idea") return i.idea.sent !== null && !i.idea.error ? none("Opening its board…", "idea:sent") : { kind: "idea", placeholder: "A planner that builds the week's meals from what the family already buys, for parents who…", submit: "ctrlEnter", key: "idea", sources: "docs" };
  if (door === "know") {
    const k = i.know;
    if (k.phase === "write" && !k.sent) return { kind: "outline", placeholder: "2M dirhams a month in orders by end of Q2\n  More customers reorder every week: 1.2 now, 1.5 by March", submit: "ctrlEnter", key: "outline" };
    if (k.phase === "asking") return { kind: "questions", scope: "know", placeholder: "", submit: "enter", key: "know:questions" };
    if (k.phase === "review") return none("Leave out any goal on the right, then add them", "know:review");
    return none("", "know:done");
  }
  const s = i.find.session;
  if (!s) return i.find.pending ? none("Qalam AI is reading…", "find:pending") : { kind: "dump", placeholder: "Paste what you have, or a web address like example.com", submit: "ctrlEnter", key: "dump", sources: "docs" };
  if (roundOpen(s)) return { kind: "questions", scope: "find", placeholder: "", submit: "enter", key: `find:questions:${s.buckets.length}` };
  if (s.phase === "review") return none("Accept or discard each line on the right", "find:review");
  return none("", `find:${s.phase}`);
}

/** A brain dump that's a web address and nothing else is read as a page. */
export const isAddress = (t: string) => /^\S+\.\S+$/.test(t.trim()) && !/\s/.test(t.trim());

// ---------------------------------------------------------------------------
// The steps on the left

export interface StepItem {
  id: string;
  label: string;
  state: StepState;
  sub?: { label: string; state: StepState }[];
}

function goalSubs(i: ThreadInput): { label: string; state: StepState }[] {
  const door = doorOf(i);
  let questions: StepState = "next";
  let review: StepState = "next";
  if (door === "know") {
    const p = i.know.phase;
    questions = p === "write" || p === "asking" ? "now" : "done";
    review = p === "review" ? "now" : p === "added" ? "done" : "next";
  } else if (door === "find") {
    const s = i.find.session;
    const placing = s && (s.phase === "placing" || s.phase === "review" || s.phase === "done" || (s.phase === "failed" && s.failed?.at === "placing"));
    questions = placing ? "done" : "now";
    review = !placing ? "next" : s!.phase === "done" ? "done" : "now";
  } else if (door === "problems") {
    const filed = !!i.problems.result?.quotes;
    questions = filed ? "done" : "now";
    review = filed ? "done" : "next";
  } else if (door === "idea") questions = "now";
  return [
    { label: "Way in", state: door ? "done" : "now" },
    { label: door === "know" ? "Write them" : door === "problems" ? "File them" : door === "idea" ? "Describe it" : "Read and ask", state: questions },
    { label: door === "problems" ? "What comes up" : door === "idea" ? "Its board" : "Review", state: review },
  ];
}

export function stepsOf(i: ThreadInput): StepItem[] {
  if (i.route === "setup" && !i.first) {
    const subs = goalSubs(i);
    return [...subs.map((s, n) => ({ id: `goals:${n}`, ...s })), { id: "done", label: "All set", state: goalsSettled(i) ? "done" : "next" }];
  }
  const welcome = i.route === "welcome";
  const at = welcome ? (engineDone(i) ? "name" : "engine") : i.step;
  // On your own there's no "Yours": every goal is.
  const order = ["engine", "name", "you", "voice", "goals", "yours", "connect"].filter((s) => s !== "yours" || i.shape !== "solo");
  const k = order.indexOf(at);
  const state = (id: string): StepState => (order.indexOf(id) < k ? "done" : order.indexOf(id) === k ? "now" : "next");
  return [
    { id: "engine", label: "Qalam AI", state: state("engine") },
    { id: "name", label: "Name it", state: state("name") },
    { id: "you", label: "You", state: state("you") },
    { id: "voice", label: "Voice", state: state("voice") },
    { id: "goals", label: "Start", state: state("goals"), ...(at === "goals" ? { sub: goalSubs(i) } : {}) },
    { id: "yours", label: "Yours", state: state("yours") },
    { id: "connect", label: "Connect", state: state("connect") },
  ].filter((s) => order.includes(s.id));
}
