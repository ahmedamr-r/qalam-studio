import { MAX_DUMP_ROUNDS } from "@/discovery/dump";
import type { SetupSession } from "@/org/setup";
import { wordsFor, type OrgShape } from "@/org/words";
import type { DocRef, SourceFit } from "../chat/attach";
import type { KnowState } from "../setup/know-state";
import type { VoiceChoice } from "@/voice/model";
import type { MarketSession } from "@/market/session";
import { stepAfter, stepShown, type SetupStep, type StepState, type WelcomeMode } from "../welcome/steps";

/*
 * The first run as a conversation (pure): every message is read from state that's already kept
 * (the engine's test, the organization, the know door's tab state, the setup's session on its
 * source), so nothing about the chat itself is saved and a reload shows the same thread. Qalam AI
 * says one or two short sentences; anything to act on is a part (`data`) the page draws.
 */

/** The way in: goals they know or want found, problems they hear about, or an idea to test. */
export type Door = "know" | "find" | "problems" | "idea";

export type PartName = "engine" | "verify" | "choices" | "outline" | "said" | "took" | "pushback" | "answers" | "you" | "voice" | "yours" | "connect" | "allSet" | "error" | "working" | "problems" | "foundGoals" | "docs" | "facts" | "rivals";

/** Small values only: a part's renderer reads the rest from the stores. */
export type PartData = Record<string, string | number | boolean | null>;

export type ChatPart = { type: "text"; text: string } | { type: "data"; name: PartName; data: PartData };

export interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  parts: ChatPart[];
}

/** Which buttons a `choices` part shows. */
export type ChoiceSet = "shape" | "door" | "skip" | "know-skip" | "propose" | "proposal" | "know-review" | "goals-in" | "verify" | "idea-board" | "company" | "company-again" | "competitors" | "competitors-again" | "start" | "take-as";

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
  problems: { sent: string | null; docs?: DocRef[]; result: { pages: number; quotes: number } | null; error: string | null; found?: readonly unknown[] };
  /** A Qalam AI call running. */
  busy: { label: string } | null;
  /** Goals picked as theirs, once they moved on from Yours. */
  picked: number;
  /** What the web says about the company, on its way to being checked (src/market/session.ts); `noSite`: they said there's no website yet. */
  market: { session: MarketSession; noSite: boolean; error: string | null; added?: string[] };
}

const text = (t: string): ChatPart => ({ type: "text", text: t });
const part = (name: PartName, data: PartData = {}): ChatPart => ({ type: "data", name, data });
const ai = (id: string, ...parts: ChatPart[]): ChatMessage => ({ id, role: "assistant", parts });
const you = (id: string, ...parts: ChatPart[]): ChatMessage => ({ id, role: "user", parts });
/** What they sent at the problems door: their words, then the docs that went with them. */
const said = (x: { sent: string | null; docs?: DocRef[] }): ChatPart[] => [...(x.sent ? [text(x.sent)] : []), ...(x.docs?.length ? [part("docs", { scope: "problems" })] : [])];

export const engineDone = (i: Pick<ThreadInput, "engine">) => i.engine === "ready" || i.engine === "skipped";

/** The way in, as chosen or as the setup on the page says (an idea's setup says so itself). */
export const doorOf = (i: Pick<ThreadInput, "door" | "find">): Door | null => (i.door === "problems" || i.door === "idea" ? i.door : i.find.session?.idea ? "idea" : i.find.session || i.find.pending ? "find" : i.door);

/** The doors whose material Qalam AI reads, asks about, then proposes from: goals to find, or an idea. */
const reads = (door: Door | null): door is "find" | "idea" => door === "find" || door === "idea";

/** The way in is done: goals added in their words, every proposed line settled, or problems filed from what customers said. */
export function goalsSettled(i: Pick<ThreadInput, "door" | "find" | "know" | "problems">): boolean {
  const door = doorOf(i);
  return door === "know" ? i.know.phase === "added" : reads(door) ? i.find.session?.phase === "done" : door === "problems" ? !!i.problems.result?.quotes : false;
}

const DOOR_SAID: Record<Door, string> = { know: "I know our goals", find: "Help me find our goals", problems: "I have documents or notes", idea: "An idea to test" };

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

/** The company's part of the thread: its website (or their line), the look, the facts to check, what they kept. */
function companyThread(i: ThreadInput, org: string, out: ChatMessage[]) {
  const solo = i.shape === "solo";
  const look = i.market.session.company;
  const now = i.step === "company";
  out.push(
    ai(
      "company:ask",
      text(solo ? `Is there a link for ${org}? A site, an app's page or a doc: I'll look it up and check with you what I find.` : `What's ${org}'s website? I'll look it up and check with you what I find.`),
      ...(!look && !i.market.noSite && now ? [part("choices", { set: "company", solo })] : []),
    ),
  );
  const own = solo ? `Then tell me in a line or two what ${org} is and who it's for.` : `Then tell me in a line or two what ${org} does and who it's for.`;
  if (i.market.noSite && (!look || !look.site)) {
    out.push(you("company:nosite", text(solo ? "No link yet" : "No website yet")));
    if (!look) out.push(ai("company:line", text(own)));
  }
  if (look) out.push(you("company:you", text(look.site && !look.said ? look.site : look.said ?? look.site ?? "")));
  if (i.market.error && now) out.push(ai("company:error", part("error", { text: i.market.error })));
  if (!look) return;
  if (look.state === "looking") return void out.push(ai("company:looking", part("working", { label: look.steps[look.steps.length - 1] ?? "Looking it up" })));
  if (look.state === "failed") return void out.push(ai("company:failed", text(`I couldn't finish looking ${org} up: ${look.error ?? "something went wrong"}`), ...(now ? [part("choices", { set: "company-again" })] : [])));
  if (!look.facts.length) {
    const why = look.noWeb ? "I can't search the web from this computer." : look.site ? `I couldn't find ${org} on the web at ${look.site}.` : `I couldn't find ${org} on the web.`;
    out.push(ai("company:none", text(`${why} ${look.said ? "Tell me a little more about it." : own}`)));
    return;
  }
  if (look.state === "ready") {
    // Their own words instead of what was found: a line or two, kept as theirs.
    if (i.market.noSite) {
      out.push(ai("company:found", text(`Here's what I found about ${org}.`), part("facts", { open: false })));
      out.push(you("company:mine", text("I'll tell it in my words")));
      out.push(ai("company:line", text(own)));
      return;
    }
    return void out.push(ai("company:found", text(`Here's what I found about ${org}. Keep what's right, fix what's off, drop the rest.`), part("facts", { open: now })));
  }
  const kept = look.kept ?? 0;
  out.push(ai("company:found", text(`Here's what I found about ${org}.`), part("facts", { open: false })));
  out.push(you("company:kept", text(kept ? `${kept === 1 ? "That one is right" : `These ${kept} are right`}` : "None of them")));
}

/** The competitors' part: the ones they name (or "find them"), the look, the ones to keep, what they kept. */
function competitorsThread(i: ThreadInput, org: string, out: ChatMessage[]) {
  const look = i.market.session.competitors;
  const now = i.step === "competitors";
  const solo = i.shape === "solo";
  out.push(ai("competitors:ask", text(solo ? `What else does what ${org} does today? Name a few products, or I'll find them.` : `Who do you see as ${org}'s competitors? Name a few, or I'll find them.`), ...(!look && now ? [part("choices", { set: "competitors" })] : [])));
  if (!look) return;
  out.push(you("competitors:you", text(look.named.length ? look.named.join(", ") : "Find them for me")));
  if (look.state === "looking") return void out.push(ai("competitors:looking", part("working", { label: look.steps[look.steps.length - 1] ?? "Looking for them" })));
  if (look.state === "failed") return void out.push(ai("competitors:failed", text(`I couldn't finish looking: ${look.error ?? "something went wrong"}`), ...(now ? [part("choices", { set: "competitors-again" })] : [])));
  if (!look.found.length && !(i.market.added ?? []).length) {
    out.push(ai("competitors:none", text(look.noWeb ? "I can't search the web from this computer. Name the ones you know, or skip this." : "I couldn't find any on the web. Name the ones you know, or skip this."), ...(now ? [part("choices", { set: "competitors-again" })] : [])));
    return;
  }
  const n = look.found.length;
  if (look.state === "ready") return void out.push(ai("competitors:found", text(n ? `Here ${n === 1 ? "is the one" : `are the ${n}`} I found. Keep the ones that compete with ${org}, take off the rest, or add one by name.` : "Add the ones you know by name."), part("rivals", { open: now })));
  out.push(ai("competitors:found", text(n ? `Here ${n === 1 ? "is the one" : `are the ${n}`} I found.` : "The ones you named."), part("rivals", { open: false })));
  const kept = look.kept ?? 0;
  out.push(you("competitors:kept", text(kept ? `${kept === 1 ? "That one" : `These ${kept}`}` : "None of them")));
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
    if (stepShown("you")) {
      out.push(ai("you:ask", text(solo ? "What's your name?" : `What's your name, and your position at ${org}?`), part("you", { open: i.step === "you", solo })));
      if (i.step === "you") return out;
      if (i.person) out.push(you("you:you", text(i.person)));
    }
    // Talking instead of typing, once per Mac: shown while it's asked, and what was chosen after.
    const v = i.voice;
    if (v && v.offer !== "none" && stepShown("voice") && (i.step === "voice" || v.chosen)) {
      out.push(ai("voice:ask", text(VOICE_ASK[v.offer]), part("voice", { open: i.step === "voice", offer: v.offer })));
      if (i.step === "voice") return out;
      if (v.chosen) out.push(you("voice:you", text(VOICE_SAID[v.chosen])));
    }
  }
  if (!i.opened) return out;

  // The company: what the web says about it, checked with them, before any goal or problem; then its competitors.
  if (i.first && stepShown("company") && (i.step === "company" || i.market.session.company)) {
    companyThread(i, org, out);
    if (i.step === "company") return out;
  }
  if (i.first && stepShown("competitors") && (i.step === "competitors" || i.market.session.competitors)) {
    competitorsThread(i, org, out);
    if (i.step === "competitors") return out;
  }

  // Goals: a way in, then either door. Picked up past them (from the home, or another window), the goals are the tree's.
  const door = doorOf(i);
  if (i.first && i.step !== "goals" && !door) out.push(ai("goals:had", text(i.goals ? `${org} has ${i.goals === 1 ? "a goal" : `${i.goals} goals`} already.` : "There are no goals yet: add them on the canvas any time.")));
  else {
    // With the company and its domain known, help finding a first goal or problem starts from them (on the
    // canvas, in its chat); one they have in mind goes there too, and what customers said is filed here.
    const m = i.market.session;
    const known = !!m.company && m.company.state === "settled";
    const reading = m.domain?.state === "looking";
    const ask = known
      ? `Want help with a first goal or problem for ${org}? I'll start from what companies like ${org} usually aim for and face${reading ? ", which I'm still reading" : ""}, and ask you about it.`
      : `Want help with a first goal or problem for ${org}? I'll ask a few questions, then suggest one in your words.`;
    out.push(ai("goals:ask", text(ask), ...(door ? [] : [part("choices", { set: "start", solo })])));
    if (door) out.push(you("goals:door", text(DOOR_SAID[door])));
  }

  if (door === "problems") {
    const p = i.problems;
    out.push(ai("problems:ask", text("Bring what you have: analytics or reports, research, support tickets, interview notes, or a link to them. I'll say what each one is, file what it states into problem pages and show which are best backed.")));
    if (p.sent !== null) out.push(you("problems:said", ...said(p)));
    if (p.error && !i.busy) out.push(ai("problems:error", part("error", { text: p.error })));
    // Nothing to go on in it: their own thinking, taken to the canvas as a goal or a problem in better words.
    if (p.result && !p.result.quotes && !i.busy)
      out.push(ai("problems:none", text("I found nothing in that to file, so it reads as your own thinking. I can take it to the canvas as a goal or a problem, and suggest how to word it."), part("choices", { set: "take-as", solo })));
  }

  if (door === "know") {
    const k = i.know;
    out.push(ai("know:ask", text("Write them down: the North Star first, then each goal indented under the one it feeds. Add the numbers you have.")));
    if (k.sent) out.push(you("know:outline", part("outline")));
    if (k.questions && (k.phase === "asking" || k.answered)) {
      out.push(ai("know:missing", text(k.questions === 1 ? "One number is missing a part. Answer what you know." : `${k.questions} numbers are missing a part. Answer what you know.`), ...(k.phase === "asking" && !i.busy ? [part("choices", { set: "know-skip" })] : [])));
      if (k.answered) out.push(you("know:answers", ...(k.answered === "answered" ? [part("answers", { scope: "know" })] : [text("Skip the questions")])));
    }
    if (k.phase === "review" && !i.busy) out.push(ai("know:review", text(k.goals === 1 ? "Here's your goal, on the canvas. Add it when it reads right." : `Here are your ${k.goals} goals, on the canvas. Leave out any that don't belong, then add them.`), part("choices", { set: "know-review", n: k.goals })));
    if (k.error && !i.busy) out.push(ai("know:error", part("error", { text: k.error })));
  }

  // Goals to find, or an idea: Qalam AI reads what they send (words and docs), asks, then proposes. An idea's board comes at the end.
  if (reads(door)) {
    const d = door;
    const s = i.find.session;
    const ask =
      d === "idea"
        ? "Tell me the idea: what it does, who it's for, and why you think they need it. Bring the docs you have about it too. I'll read it all and ask before I propose anything; its board comes at the end."
        : solo
          ? "Paste your notes about the idea, or give its website. I'll read it and ask before I propose anything."
          : "Paste a strategy doc, OKRs or notes, or give your website. I'll read it and ask before I propose anything.";
    out.push(ai(`${d}:ask`, text(ask)));
    if (s || i.find.pending) out.push(you(`${d}:said`, part("said")));
    if (i.find.error && !s && !i.busy) out.push(ai(`${d}:error`, part("error", { text: i.find.error })));
    if (s) {
      const live = s.phase !== "review" && s.phase !== "done";
      if (s.understanding) out.push(ai(`${d}:took`, part("took", { round: -1 }), ...(s.challenges.length && live ? [part("pushback")] : [])));
      const open = roundOpen(s) && !i.busy;
      s.buckets.forEach((b, n) => {
        const answered = n < s.buckets.length - 1 || b.form.submitted || s.phase !== "asking";
        if (!answered) return;
        out.push(ai(`${d}:round:${n}`, text(n === 0 ? "Before I propose anything, a few questions." : `A few more (round ${n + 1} of up to ${MAX_DUMP_ROUNDS}).`)));
        out.push(you(`${d}:answers:${n}`, ...(b.form.submitted ? [part("answers", { scope: "find", round: n })] : [text("Skip the questions")])));
        if (b.analysis) out.push(ai(`${d}:analysis:${n}`, part("took", { round: n })));
      });
      if (open) {
        const n = s.buckets.length - 1;
        out.push(ai(`${d}:round:${n}`, text(n === 0 ? "Before I propose anything, a few questions." : `A few more (round ${n + 1} of up to ${MAX_DUMP_ROUNDS}).`), part("choices", { set: "skip" })));
      }
      if (s.phase === "ready" && !i.busy) out.push(ai(`${d}:ready`, text("I have what I need."), part("choices", { set: "propose" })));
      if (s.phase === "failed" && s.failed && !i.busy) out.push(ai(`${d}:failed`, part("error", { text: s.failed.error === "Stopped." ? "You stopped Qalam AI before it finished." : `Qalam AI couldn't finish: ${s.failed.error}`, retry: true })));
      if ((s.phase === "review" || s.phase === "done") && s.proposal) {
        if (s.proposal.lines.length)
          out.push(ai(`${d}:proposal`, text(s.proposal.summary), text("Review them on the canvas: accept what's true, leave out the rest."), ...(i.find.open ? [part("choices", { set: "proposal", n: i.find.open })] : [])));
        else out.push(ai(`${d}:proposal`, text(`I found nothing I could set up from it. Fill in the ${wordsFor(i.shape).org} by hand from its home.`)));
      }
    }
  }

  // The goals are in: on to which are theirs (the first run), or all set.
  if (goalsSettled(i) && door === "problems") {
    // Problems in, no goals yet: on to what to connect (there are no goals to pick as theirs).
    const r = i.problems.result!;
    const said = `Filed ${r.quotes === 1 ? "1 point" : `${r.quotes} points`} into ${r.pages === 1 ? "1 problem page" : `${r.pages} problem pages`}. Each page shows how strong it is and drafts solutions for it.`;
    const found = i.problems.found?.length ?? 0;
    const offer = found ? (found === 1 ? "It also points to a goal. Keep it if it's one you're working toward." : `It also points to ${found} goals. Keep the ones you're working toward.`) : "None of it states a goal. I can help you find one on the canvas.";
    out.push(ai("goals:in", text(said), part("problems"), text(offer), ...(found ? [part("foundGoals")] : []), ...(i.first && i.step === "goals" ? [part("choices", { set: "goals-in", solo: true, findGoal: !found })] : [])));
    if (!i.first) out.push(ai("all-set", text("All set."), part("allSet")));
  } else if (goalsSettled(i) && door === "idea") {
    // The idea's board, when they choose: it reads the idea and places it under the problems it solves.
    const written = i.find.accepted;
    const said = written ? `${written === 1 ? "1 line" : `${written} lines`} written to ${org}.` : "Nothing was written.";
    out.push(ai("goals:in", text(`${said} Start the idea's board when you're ready: it puts the idea under the problems it would solve.`), ...(i.step === "goals" || !i.first ? [part("choices", { set: "idea-board", solo, first: i.first })] : [])));
  } else if (goalsSettled(i)) {
    const written = door === "find" ? i.find.accepted : i.know.added;
    const said = !written ? null : door === "know" ? (written === 1 ? "Your goal is in." : `Your ${written} goals are in.`) : `${written === 1 ? "1 line" : `${written} lines`} written to ${org}.`;
    if (i.first) {
      const moved = i.step !== "goals";
      const after = stepAfter("goals", i.shape);
      const next = after === "connect" ? "Next: what to connect." : after === "yours" ? "Next: which goals are yours." : "That's the setup: Finish takes you to it.";
      out.push(ai("goals:in", text(said ? `${said} ${next}` : "Nothing was written. You can add goals on the canvas any time."), ...(moved ? [] : [part("choices", { set: "goals-in", solo })])));
    } else out.push(ai("all-set", text(said ? `${said} All set.` : `Nothing was written to ${org}.`), part("allSet")));
  }

  // Which are theirs (on your own every goal is), then what to connect.
  if (i.first && i.step !== "goals" && stepShown("yours", i.shape) && door !== "problems") {
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
  kind: "name" | "dump" | "outline" | "questions" | "problems" | "idea" | "company" | "competitors" | "none";
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
  if (i.first && i.step === "competitors") {
    const look = i.market.session.competitors;
    if (look?.state === "looking") return none("Qalam AI is looking for them…", "competitors:looking");
    // While they check what was found, a name typed is one more of theirs.
    if (look?.state === "ready") return { kind: "competitors", placeholder: "Add one by name", submit: "enter", key: `competitors:add:${look.at}` };
    return { kind: "competitors", placeholder: i.shape === "solo" ? "Mealime, Paprika" : "Their names, like Oilio, Recycly", submit: "enter", key: `competitors:names:${look?.at ?? 0}` };
  }
  if (i.first && i.step === "company") {
    const look = i.market.session.company;
    if (look?.state === "looking") return none("Qalam AI is looking it up…", "company:looking");
    if (look && look.facts.length && look.state !== "failed" && !i.market.noSite) return none("Keep, fix or drop each fact above", "company:check");
    // Their website first; their own line once there's none, or nothing was found.
    const line = i.market.noSite || (!!look && (look.state !== "failed" || !look.site));
    return { kind: "company", placeholder: line ? (i.shape === "solo" ? "A planner that builds the week's meals for busy parents" : "We collect used cooking oil from homes and restaurants in Cairo") : "example.com", submit: "enter", key: `company:${line ? "line" : "site"}:${look?.at ?? 0}` };
  }
  if (i.step === "yours") return none("Pick your goals above, then Next", "yours");
  if (i.step === "connect") return none("Connect what you need, then Finish", "connect");
  const door = doorOf(i);
  if (!door) return none("Pick a way in above", "door");
  if (door === "problems") {
    if (i.problems.result?.quotes) return none("", "problems:done");
    return { kind: "problems", placeholder: "Paste a report, tickets or interview notes, or a link to them", submit: "ctrlEnter", key: `problems:${i.problems.sent !== null ? "again" : "first"}`, sources: "customers" };
  }
  if (door === "know") {
    const k = i.know;
    if (k.phase === "write" && !k.sent) return { kind: "outline", placeholder: "2M dirhams a month in orders by end of Q2\n  More customers reorder every week: 1.2 now, 1.5 by March", submit: "ctrlEnter", key: "outline" };
    if (k.phase === "asking") return { kind: "questions", scope: "know", placeholder: "", submit: "enter", key: "know:questions" };
    if (k.phase === "review") return none("Leave out any goal on the canvas, then add them", "know:review");
    return none("", "know:done");
  }
  const s = i.find.session;
  if (!s)
    return i.find.pending
      ? none("Qalam AI is reading…", "find:pending")
      : door === "idea"
        ? { kind: "idea", placeholder: "A planner that builds the week's meals from what the family already buys, for parents who…", submit: "ctrlEnter", key: "idea", sources: "docs" }
        : { kind: "dump", placeholder: "Paste what you have, or a web address like example.com", submit: "ctrlEnter", key: "dump", sources: "docs" };
  if (roundOpen(s)) return { kind: "questions", scope: "find", placeholder: "", submit: "enter", key: `find:questions:${s.buckets.length}` };
  if (s.phase === "review") return none("Accept or leave out each one on the canvas", "find:review");
  if (door === "idea" && s.phase === "done") return none("Start the idea's board above when you're ready", "idea:done");
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
  } else if (reads(door)) {
    const s = i.find.session;
    const placing = s && (s.phase === "placing" || s.phase === "review" || s.phase === "done" || (s.phase === "failed" && s.failed?.at === "placing"));
    questions = placing ? "done" : "now";
    review = !placing ? "next" : s!.phase === "done" ? "done" : "now";
  } else if (door === "problems") {
    const filed = !!i.problems.result?.quotes;
    questions = filed ? "done" : "now";
    review = filed ? "done" : "next";
  }
  return [
    { label: "Way in", state: door ? "done" : "now" },
    { label: door === "know" ? "Write them" : door === "problems" ? "File them" : door === "idea" ? "Describe it" : "Read and ask", state: questions },
    { label: door === "problems" ? "What comes up" : "Review", state: review },
    // An idea ends on its board, opened when they choose.
    ...(door === "idea" ? [{ label: "Its board", state: (review === "done" ? "now" : "next") as StepState }] : []),
  ];
}

export function stepsOf(i: ThreadInput): StepItem[] {
  if (i.route === "setup" && !i.first) {
    const subs = goalSubs(i);
    return [...subs.map((s, n) => ({ id: `goals:${n}`, ...s })), { id: "done", label: "All set", state: goalsSettled(i) ? "done" : "next" }];
  }
  const welcome = i.route === "welcome";
  const at = welcome ? (engineDone(i) ? "name" : "engine") : i.step;
  // On your own there's no "Yours": every goal is. v0.1 asks only for Qalam AI, a name and a start (src/lab.ts).
  const order = (["engine", "name", "you", "voice", "company", "competitors", "goals", "yours", "connect"] as const).filter((s) => stepShown(s, i.shape)) as readonly string[];
  const k = order.indexOf(at);
  const state = (id: string): StepState => (order.indexOf(id) < k ? "done" : order.indexOf(id) === k ? "now" : "next");
  return [
    { id: "engine", label: "Qalam AI", state: state("engine") },
    { id: "name", label: "Name it", state: state("name") },
    { id: "you", label: "You", state: state("you") },
    { id: "voice", label: "Voice", state: state("voice") },
    { id: "company", label: i.shape === "solo" ? "The project" : "The company", state: state("company") },
    { id: "competitors", label: i.shape === "solo" ? "Like it" : "Competitors", state: state("competitors") },
    { id: "goals", label: "Start", state: state("goals"), ...(at === "goals" ? { sub: goalSubs(i) } : {}) },
    { id: "yours", label: "Yours", state: state("yours") },
    { id: "connect", label: "Connect", state: state("connect") },
  ].filter((s) => order.includes(s.id));
}

/** Where the setup is, for the top bar: the step it's on (1-based), how many there are, and its name with the part of it under way. */
export function progressOf(steps: readonly StepItem[]): { at: number; total: number; label: string } {
  const now = steps.findIndex((x) => x.state === "now");
  const at = now < 0 ? steps.filter((x) => x.state === "done").length : now + 1;
  const step = steps[now];
  const sub = step?.sub?.find((x) => x.state === "now");
  return { at, total: steps.length, label: step ? (sub ? `${step.label} · ${sub.label}` : step.label) : at >= steps.length ? "Done" : "" };
}
