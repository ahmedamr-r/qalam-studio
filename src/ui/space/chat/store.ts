import { nanoid } from "nanoid";
import { checkFirst, setAside, startReview, useReview } from "../../discovery/review";
import { keptChallenges, useChallenges } from "../../discovery/challenges";
import { planAhead, planLook, planPropose, planRoute, type ConsultTurn, type PlanAsk } from "@/org/plan";
import { planOutline, planProposals } from "@/space/plan";
import { answersOf, currentRound, decideChoice, decideTerm, dropCurrentRound, emptyAsking, foundOf, fromBuckets, fromPlanRounds, loaded, looksOf, scanSaid, startLookup, theirWords } from "@/asking/engine";
import { capFor } from "@/consult/pace";
import type { PlaybookId } from "@/consult/playbooks.gen";
import { levelOf, nextPlaybook, pastBasics, simpler, type Level, type Situation } from "@/consult/situation";
import { loadYou, setFluency, useYou, type Position } from "@/org/you";
import { OPEN_ID, answered, answersRecord, openQuestion, type AskFor, type CardAnswers } from "@/discovery/questions";
import { DUMP_ROLES } from "@/discovery/dump";
import { sharedWords } from "@/discovery/near";
import type { GoalLever } from "@/goals/types";
import { lab } from "@/lab";
import { SECTION_LABEL, type BusinessSection } from "@/business/types";
import { askCardTurn } from "@/org/ask-card";
import { lookOnline } from "@/org/online";
import { boardOfCard, productOfCard } from "@/space/view";
import { addSourceRecord, updateSource } from "../../discovery/sources";
import { keptAnswers, useAskingIn } from "../../discovery/ask";
import { recordChoice } from "../../decisions/recorder";
import { attachQuoteRefs } from "../../discovery/drop";
import { draftSolutionsFor } from "../../discovery/solutions";
import { breakDownFor, draftProblemsFor } from "../../discovery/goal-steps";
import { draftTestsFor } from "../../discovery/tests";
import { fileAfterReading } from "../../topics/filing";
import type { AskingState, FoundLine, Lookup } from "@/asking/types";
import { basisOf } from "@/discovery/basis";
import { askingIn } from "@/asking/wire";
import { hostOf } from "@/ai/research-shared";
import { editTerm, useTerms } from "@/org/terms";
import { initialFlow, type FlowState } from "../../ai/questionFlow";
import { toQuestion } from "../../ai/plan";
import { answer, askMeInstead, confirm, generateNow, goOn, keepRound, lookItUp, off, picks, projectLookup, startLookups, stopAsking, stopLookup, stopLookups, type AskingHost, type Paused } from "../../asking/run";
import { create } from "zustand";
import { aiStatus } from "@/ai/client";
import { studio } from "@/doc/store";
import { isOstCard } from "@/doc/board";
import { KIND_LABEL } from "@/discovery/kinds";
import { backing } from "@/discovery/evidence";
import { addCardIn, makeCardNode, moveCardsIn, newCard, updateCardIn } from "@/discovery/ops";
import type { OstMetric } from "@/discovery/types";
import { changeGoal, goalsNow, setMe } from "@/goals/client";
import { goalById } from "@/goals/tree";
import { askOrganization } from "@/org/ask";
import { captureIngested, decideFoundGoal, setSourceBasis } from "@/org/capture";
import { currentOrg, orgFetch, orgJson } from "@/org/client";
import type { Ingested } from "@/discovery/ingest/core";
import { chatKey, chatOf, emptyChat, running, withJob, withTurn, type CanvasChat, type ChatDoc, type ChatJob, type ChatTurn, type FiledPage, type FocusGoal, type GoalForJob, type GoalForOn, type BriefState, type ScanJob, type ScanPlan, type TakenDoc, type WhoseJob, type PlanJob, type DraftJob, type KeptChallenge, type ToolsJob } from "@/space/chat";
import { everywhereDb } from "@/org/everywhere";
import type { StartHandoff } from "@/onboarding/handoff";

/** A doc taken in: read already, or a picture kept in the project to read now. */
type TakeDoc = Attachment & ({ ingested: Ingested; asset?: undefined } | { asset: { hash: string; type: string }; ingested?: undefined });
import { cardForPage, pageOf } from "@/space/pages";
import { DUMP_WORDS, routeOf, titleFrom, wordsIn, type ChatMode } from "@/space/route";
import { FIND_MIN, findRound, findText, findTranscript, openingAnswer, type FindWhat, type OpeningAnswers } from "@/space/find";
import type { PlanQuestion } from "@/ai/plan";
import { focusRound, focusTranscript } from "@/goals/focus";
import { nowFrom, numberRound, targetFrom } from "@/goals/moves";
import { goalsForProblem, lookForGoal, suggestGoalNumber } from "@/org/goal-work";
import { loadMarket, useMarket } from "@/org/market";
import { useSpaceView } from "@/space/view";
import { rememberRound, withKnownAnswers } from "@/org/memory";
import { onOrgChange } from "@/org/live";
import { needsDb } from "@/org/needs";
import { isAppLink, otherReading, requestOf, scanInput } from "@/scan/input";
import { peopleQuotes, type ScanTarget } from "@/scan/session";
import { steerAnswers, steerRound, type ScanSaid } from "@/scan/steer";
import { askedFromAnswers, briefRound, type BriefAsked, type BriefShape } from "@/discovery/brief";
import { askBriefTurn, writeCardBrief } from "@/org/briefs";
import { briefRequest } from "../../discovery/brief-request";
import { loadBriefs } from "../../discovery/briefs";
import { glideToLayer, onCanvasReady } from "../../discovery/canvas";
import { askScanPlan, firstBuild, writeBrief, keepAnswers, keepAudience, namesSomething, readFirstAnswer, planAudiences, scanNow, startScan, steerQuestions, steerScan, stopScan } from "@/org/scan";
import { firstGoal, sameTarget, SUGGESTED_GOAL, type GoalAction, type ScanAudience } from "@/scan/plan";
import { projectName } from "@/scan/input";
import { nameAfterRead } from "@/onboarding/start";
import { draftBacking, draftCards } from "@/discovery/solutions";
import { decideDraft } from "@/org/solutions";
import { quoteEvidence, quotePiece } from "@/discovery/sources";
import { sourcesDb } from "@/discovery/db";
import { createOrg, setOrgShape } from "@/org/client";
import { setCurrentOrg } from "../../frame/store";
import { orgHref } from "@/projects/model";
import { handWords } from "../handoff";
import { problemCard } from "../../topics/start-board";
import { visitSources } from "../../discovery/sources";
import { newId } from "@/doc/factory";
import { docPart, docRef, guessVoice, joinParts, type Attachment, type SentDoc } from "../../chat/attach";
import type { Basis } from "@/discovery/basis";
import { DUMP_MAX_CHARS } from "@/discovery/dump";
import { ingestFile, ingestPaste } from "../../discovery/ingest";
import { startDump, stopDump, useDump } from "../../discovery/dump";
import { addSources } from "../../discovery/import";
import { sourceOf, useSources } from "../../discovery/sources";
import { sourceCame } from "../flights";
import { show } from "../links";
import { placeFor, writeCard } from "../new";
import { useCompose } from "./compose";
import { toggleChat } from "../../frame/store";
import { engineMissing } from "../../frame/useHealth";

/*
 * Qalam AI's chat beside a space's canvas, in the window: the canvas's turns (src/space/chat.ts),
 * loaded as the canvas opens and saved a moment after each change, and what's running now (its
 * steps and its Stop), which is never kept. What's sent goes where src/space/route.ts says: asked,
 * taken in, written on the canvas, read as a brain dump, or first a choice between them; a turn
 * can be taken another way after (its words stay, its job changes).
 */

interface Live {
  steps: string[];
  started: number;
}

interface ChatState {
  /** The canvas the turns are for (null until one opens). */
  key: string | null;
  space: string | null;
  chat: CanvasChat;
  loaded: boolean;
  live: Record<string, Live>;
  /** "Help me find one" asked for a canvas whose chat isn't loaded yet: started as it loads. */
  pending: { key: string; what: FindWhat } | null;
  /** Words for a scan from a canvas whose chat isn't loaded yet (the first run's box): started as it loads. */
  pendingScan: { key: string; said: string; mode?: "consult" } | null;
  /** What the start page's box handed this canvas, held until its chat has loaded. */
  pendingStart: { key: string; start: StartHandoff } | null;
  /** A goal asked for by the address before the chat has loaded: started as it loads. */
  pendingGoal: { card: string; topic?: string } | null;
}

export const useCanvasChat = create<ChatState>(() => ({ key: null, space: null, chat: emptyChat(), loaded: false, live: {}, pending: null, pendingScan: null, pendingStart: null, pendingGoal: null }));

const st = () => useCanvasChat.getState();
const ctrls = new Map<string, AbortController>();
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

let saving: ReturnType<typeof setTimeout> | null = null;
function save() {
  const { key, chat } = st();
  if (!key) return;
  if (saving) clearTimeout(saving);
  saving = setTimeout(() => {
    saving = null;
    void orgFetch(`/canvas-chat/${key}`, { method: "PUT", json: chat }).catch(() => {});
  }, 400);
}

/** Now: what's about to run in the core shouldn't depend on the page staying open 400 ms more. */
function saveNow() {
  const { key, chat } = st();
  if (!key) return Promise.resolve();
  if (saving) clearTimeout(saving);
  saving = null;
  return orgFetch(`/canvas-chat/${key}`, { method: "PUT", json: chat }).catch(() => {});
}

function change(fn: (c: CanvasChat) => CanvasChat) {
  useCanvasChat.setState((s) => ({ chat: fn(s.chat) }));
  save();
}

/** The chat of the canvas now open (another canvas's goes, and what it was running stops). */
export async function openChat(space: string | null) {
  watchReview();
  const key = chatKey(space);
  if (st().key === key) return;
  for (const c of ctrls.values()) c.abort();
  ctrls.clear();
  useCanvasChat.setState({ key, space, chat: emptyChat(), loaded: false, live: {} });
  // What's known about the company and its domain words Help me find one's questions.
  void loadMarket();
  const chat = await orgJson<unknown>(`/canvas-chat/${key}`).then(chatOf, () => emptyChat());
  if (st().key !== key) return;
  useCanvasChat.setState({ chat, loaded: true });
  const pending = st().pending;
  if (pending?.key === key) {
    useCanvasChat.setState({ pending: null });
    void findWith(pending.what, space);
  }
  const goal = st().pendingGoal;
  if (goal) {
    useCanvasChat.setState({ pendingGoal: null });
    goalWith(goal.card, goal.topic);
  }
  // A scan started before the page closed went on in the core: where it's got to.
  void followScan();
  const words = st().pendingScan;
  if (words?.key === key) {
    useCanvasChat.setState({ pendingScan: null });
    void runAs(null, words.said, words.mode ?? "scan");
  }
  const start = st().pendingStart;
  if (start?.key === key) {
    useCanvasChat.setState({ pendingStart: null });
    void runStart(start.start);
  }
}

/** A new chat: the turns go (what they made stays where it is). */
export function clearChat() {
  for (const c of ctrls.values()) c.abort();
  ctrls.clear();
  useCanvasChat.setState({ live: {} });
  change(() => emptyChat());
}

export function turnOf(id: string): ChatTurn | undefined {
  return st().chat.turns.find((t) => t.id === id);
}

function addTurn(said: string, job: ChatJob, docs?: ChatDoc[], o: { quiet?: true } = {}): string {
  const id = nanoid(10);
  change((c) => withTurn(c, { id, at: Date.now(), said, ...(docs?.length ? { docs } : {}), ...(o.quiet ? { quiet: true as const } : {}), job }));
  return id;
}

/** A turn's job set: a new turn, or (`at`) one taken another way. */
function jobAt(at: string | null, said: string, job: ChatJob, docs?: ChatDoc[]): string {
  if (!at) return addTurn(said, job, docs);
  change((c) => withJob(c, at, () => job));
  return at;
}

function begin(id: string): AbortController {
  const ctrl = new AbortController();
  ctrls.set(id, ctrl);
  useCanvasChat.setState((s) => ({ live: { ...s.live, [id]: { steps: [], started: Date.now() } } }));
  return ctrl;
}

/** What it's doing now, once: the same words twice in a row (the window's and the route's) show once. */
const step = (id: string) => (label: string) => useCanvasChat.setState((s) => (s.live[id] && s.live[id].steps.at(-1) !== label ? { live: { ...s.live, [id]: { ...s.live[id], steps: [...s.live[id].steps, label].slice(-4) } } } : s));

function end(id: string) {
  ctrls.delete(id);
  useCanvasChat.setState((s) => {
    const { [id]: _gone, ...live } = s.live;
    return { live };
  });
}

// ---------------------------------------------------------------------------
// Sending

/** What the box sent, where it goes (the box's mode first): false keeps the text in the box. */
export function send(text: string, docs: readonly SentDoc[]): boolean {
  const said = text.trim();
  const mode = useCompose.getState().mode;
  const routed = routeOf({ text: said, docs, pasted: said ? guessVoice({ text: said, title: "" }) : undefined, mode });
  if (!routed) return false;
  // Sent: the box's text and mode are spent (the box drawn again after a round of questions starts empty).
  useCompose.setState({ text: "", mode: null });
  if (routed.read) {
    void readQuestion(said);
    return true;
  }
  void runAs(null, said, routed.job, docs, { ...(routed.first ? { first: routed.first } : {}), ...(routed.offer ? { offer: routed.offer } : {}) });
  return true;
}

/**
 * A turn's words taken one way: as a new turn, or (`at`) a turn taken another way than it was. A
 * consultant's: `first`, which "Just add it" leads; `offer`, reading what people say about it offered.
 */
export async function runAs(at: string | null, said: string, mode: ChatMode, docs: readonly SentDoc[] = [], o: { first?: "goal" | "problem"; offer?: "scan" } = {}): Promise<void> {
  if (at) stopTurn(at);
  if (mode === "goal" || mode === "problem") return void addCard(at, said, mode);
  if (await engineMissing()) return void jobAt(at, said, { kind: "noEngine", mode });
  if (mode === "ask") return ask(said, at);
  if (mode === "take") return takeIn(at, said, docs);
  if (mode === "dump") return dumpIt(at, said, docs);
  if (mode === "scan") return scanIt(at, said);
  if (mode === "plan") return workOut(at, said);
  if (mode === "consult") return consultOn(at, said, { ...(o.first ? { first: o.first } : {}), ...(o.offer || isAppLink(said) ? { offer: said } : {}) });
  if (mode === "tools") return void (await lookInTools(at, said, { typed: true }));
}

/** Words sent to the chat from elsewhere (the first run's idea), taken as `mode`. */
export function sendToChat(text: string, mode: ChatMode) {
  void runAs(null, text.trim(), mode);
}

/** A turn taken another way, from the thread (its chips): the same words. */
export function retake(id: string, mode: ChatMode) {
  const t = turnOf(id);
  if (t) void runAs(id, t.said, mode);
}

// ---------------------------------------------------------------------------
// What people complain about

/** Words from the one box (the first run's, the empty canvas's): into this canvas's chat, once it's loaded. */
export function scanFrom(said: string, space: string | null, mode?: "consult") {
  toggleChat(true);
  const key = chatKey(space);
  if (st().key !== key || !st().loaded) return useCanvasChat.setState({ pendingScan: { key, said, ...(mode ? { mode } : {}) } });
  void runAs(null, said, mode ?? "scan");
}

/** What the start page's box handed this canvas (src/ui/start/flow.ts): into its chat, once it's loaded. */
export function startFrom(start: StartHandoff, space: string | null) {
  toggleChat(true);
  const key = chatKey(space);
  if (st().key !== key || !st().loaded) return useCanvasChat.setState({ pendingStart: { key, start } });
  void runStart(start);
}

/**
 * The box's message as this chat's first turns: its docs and pictures taken in, a scan beside them
 * when the words named what to look at, then whose it is when the words didn't say. They never pass
 * through the box's own docs (useAttach), which the chat empties as it opens.
 */
async function runStart(h: StartHandoff) {
  if (await engineMissing()) {
    for (const t of h.turns) addTurn(t.said, { kind: "noEngine", mode: t.mode });
    return;
  }
  const docs: TakeDoc[] = [
    ...h.docs.map((d) => ({ ...d, key: `start:${d.from}:${d.title}`, via: d.from === "computer" ? "this computer" : d.from, state: "ready" as const })),
    ...h.images.map((i) => ({ key: `start:image:${i.asset}`, from: "computer", via: "this computer", title: i.title, type: "image", ...(i.at ? { at: i.at } : {}), state: "ready" as const, asset: { hash: i.asset, type: i.type } })),
  ];
  // The words show once, on the first turn: a scan beside docs is Qalam AI's own turn.
  let shown = false;
  let scan: string | undefined;
  const going: Promise<unknown>[] = [];
  for (const t of h.turns) {
    const said = shown ? "" : t.said;
    const quiet = shown && !!t.said;
    shown = shown || !!t.said;
    if (t.mode === "consult") {
      // Their words, worked out with them once what came with them is in (it reads their material).
      await Promise.allSettled(going);
      consultOn(null, t.said, { ...(t.situation ? { situation: t.situation } : {}), ...(t.offer ? { offer: t.said } : {}), ...(quiet ? { quiet: true as const } : {}) });
      // Who's asking was read from their own words on the start page: kept as the first read is.
      if (t.situation) {
        void setFluency(t.situation.level, "qalam").catch(() => {});
        if (t.situation.position) void setMeOnce(t.situation.position);
      }
    } else if (t.mode === "scan") {
      void scanIt(null, said, t.target, undefined, t.said, !!t.read);
      scan = [...st().chat.turns].reverse().find((x) => x.job.kind === "scan")?.id;
    } else if (t.mode === "take") going.push(takeIn(null, said, docs));
    else if (t.mode === "plan") consultOn(null, t.said);
    else going.push(dumpIt(null, said, docs.filter((d): d is SentDoc => !!d.ingested)));
  }
  // The consultant asks whose it is where it matters, in the conversation.
  if (h.whose.sure || h.turns.some((t) => t.mode === "consult")) return;
  const target = h.turns.find((t) => t.mode === "scan");
  const name = target?.mode === "scan" && target.target.kind === "product" ? target.target.name || undefined : undefined;
  const ask = h.whose.ask === "product" && name ? "product" : "shape";
  addTurn("", { kind: "whose", ask, ...(name ? { name } : {}), ...(scan ? { scan } : {}) });
}

/** Whose it is, as they answer: the project's shape, and a named product's reviews as its customers' words. */
export async function answerWhose(id: string, answer: NonNullable<WhoseJob["answer"]>) {
  const t = turnOf(id);
  if (t?.job.kind !== "whose" || t.job.answer) return;
  const scan = t.job.scan;
  change((c) => withJob(c, id, (j) => (j.kind === "whose" ? { ...j, answer } : j)));
  const shape = answer === "ours" || answer === "team" ? "team" : "solo";
  const org = await currentOrg().catch(() => null);
  if (org && org.shape !== shape) await setOrgShape(shape).then(setCurrentOrg, () => {});
  if (answer !== "ours" || !scan) return;
  const s = turnOf(scan);
  if (s?.job.kind !== "scan" || s.job.mine) return;
  if (s.job.session?.state === "done") await scanIsMine(scan);
  else change((c) => withJob(c, scan, (j) => (j.kind === "scan" ? { ...j, mineSaid: true } : j)));
}

/** An idea or a product read for what people complain about. It runs in the core; this follows it. */
async function scanIt(at: string | null, said: string, target: ScanTarget | null = scanInput(said), told?: readonly ScanSaid[], words = said, read = false) {
  if (!target) return void jobAt(at, said, { kind: "choose", first: "problem" });
  // Another scan's problems are here: two unrelated products would run together on one page.
  const other = !at && st().chat.turns.some((t) => t.job.kind === "scan" && t.job.session?.state === "done" && t.job.session.problems.length > 0 && !sameTarget(t.job.target, target));
  if (other) return void jobAt(at, said, { kind: "scan", target, asked: Date.now(), where: true });
  const id = jobAt(at, said, { kind: "scan", target, asked: Date.now(), ...(target.kind === "product" && target.mine ? { mine: true as const } : {}), ...(told?.length ? { told: [...told] } : {}) });
  void saveNow();
  // Nothing named to read about: reading would go on their sentence, so it's worked out with them instead.
  // (`read`: the start page's box read them already, `readFirst`.)
  if (target.kind === "idea" && !told?.length && !read && !(await namesSomething(words))) return consultOn(id, words);
  try {
    const session = await startScan({ ...requestOf(target, words, typeof navigator === "undefined" ? "" : navigator.language), ...(told?.length ? { told: [...told] } : {}) });
    change((c) => withJob(c, id, (j) => (j.kind === "scan" ? { ...j, session } : j)));
    void followScan();
    // Asked again, what they've said still stands.
    if (!told?.length) void askWhileReading(id, target);
  } catch (e) {
    change((c) => withJob(c, id, (j) => (j.kind === "scan" ? { ...j, error: message(e) } : j)));
  }
}

/** The questions as it starts. It's reading already, and nothing waits on them. */
async function askWhileReading(id: string, target: ScanTarget) {
  const set = (fn: (j: ScanJob) => ScanJob) => change((c) => withJob(c, id, (j) => (j.kind === "scan" ? fn(j) : j)));
  set((j) => ({ ...j, ask: { step: "writing" } }));
  const questions = await steerQuestions(target).catch(() => steerRound(target));
  set((j) => (j.ask?.step === "writing" && (!j.session || j.session.state === "reading") ? { ...j, ask: { step: "asking", questions } } : j.ask?.step === "writing" ? { ...j, ask: { step: "done" } } : j));
}

/** The questions the box asks while it reads. */
export const steerQuestionsOf = (id: string) => scanJob(id)?.ask?.questions ?? [];

/** Their answers: heard by what's left to read, and not asked again. */
export function answerSteer(id: string, answers: Readonly<Record<string, string>>) {
  const said = steerAnswers(steerQuestionsOf(id), answers);
  change((c) => withJob(c, id, (j) => (j.kind === "scan" ? { ...j, ask: { step: "done" }, ...(said.length ? { told: [...(j.told ?? []), ...said] } : {}) } : j)));
  if (said.length) void steerScan({ said }).catch(() => {});
}

/** The questions go, unanswered: it finished before they started on them. */
export const leaveSteer = (id: string) => change((c) => withJob(c, id, (j) => (j.kind === "scan" && j.ask?.step === "asking" ? { ...j, ask: { step: "done" } } : j)));

/** Not what they meant: an app or a competitor it found, taken off before it's read into anything. */
export const steerOff = (name: string) => void steerScan({ off: [name] }).catch(() => {});

let followingScan: (() => void) | null = null;
/** The window and the core share a clock on this computer; a little room all the same. */
const CLOCK_SLACK = 1000;

/** The newest scan still reading takes the core's word on how it stands; the panel opens on what it found. */
async function followScan() {
  followingScan ??= onOrgChange((c) => {
    if (c.kind === "scan") void followScan();
  });
  const open = [...st().chat.turns].reverse().find((t) => t.job.kind === "scan" && !t.job.error && !t.job.where && (!t.job.session || t.job.session.state === "reading"));
  if (!open) return;
  const session = await scanNow().catch(() => null);
  // An answer about an earlier scan (asked just before this one started) says nothing about this one.
  if (!session || open.job.kind !== "scan" || session.at < open.job.asked - CLOCK_SLACK) return;
  change((c) => withJob(c, open.id, (j) => (j.kind === "scan" ? { ...j, session } : j)));
  // They said it's theirs while it read: its reviews are its customers' words now that they're kept.
  if (session.state === "done" && open.job.mineSaid && !open.job.mine) await scanIsMine(open.id);
  if (session.state === "done" && session.problems.length && !open.job.lookup) openProblems();
}

/** The panel on the ranked problems (src/ui/home/Home.tsx hears this). */
export const PANEL_EVENT = "qalam:panel";
export const openProblems = () => window.dispatchEvent(new CustomEvent(PANEL_EVENT, { detail: "problems" }));

/** The same words read the other way: an idea as a product's name, or the other way round. */
export function scanOtherWay(id: string) {
  const t = turnOf(id);
  if (t?.job.kind !== "scan") return;
  const other = otherReading(t.job.target, t.said);
  if (!other) return;
  stopTurn(id);
  void scanIt(id, t.said, other);
}

/** It goes in this project anyway: they know what they're mixing. */
export function scanHere(id: string) {
  const t = turnOf(id);
  if (t?.job.kind === "scan") void scanIt(id, t.said, t.job.target);
}

/** It gets a project of its own, whose canvas starts it. */
export async function scanInNewProject(id: string) {
  const t = turnOf(id);
  if (t?.job.kind !== "scan") return;
  try {
    const org = await createOrg(nameAfterRead(t.job.target, await readFirstAnswer(t.said)), "solo");
    await fetch(`/api/org/${encodeURIComponent(org.id)}/first-run`, { method: "POST" }).catch(() => {});
    handWords(t.said);
    dropTurn(id);
    window.location.assign(`${orgHref(org.id)}?scan=1`);
  } catch (e) {
    change((c) => withJob(c, id, (j) => (j.kind === "scan" ? { ...j, where: undefined, error: message(e) } : j)));
  }
}

/** Again, as it was read, and what they said still stands. */
export function scanAgain(id: string) {
  const t = turnOf(id);
  if (t?.job.kind !== "scan") return;
  if (t.job.lookup) return void lookupScanAgain(id, t.job, t.job.lookup);
  void scanIt(id, t.said, t.job.target, t.job.told);
}

/** A conversation's scan asked again: the same look, still beside the same conversation, asking nothing. */
async function lookupScanAgain(id: string, j: ScanJob, at: { turn: string; id: string }) {
  const l = canvasPlan(at.turn)?.asking?.lookups.find((x) => x.id === at.id);
  if (!l) return;
  setCanvasPlan(at.turn, (x) => (x.asking ? { ...x, asking: startLookup(x.asking, { id: l.id, kind: "scan", query: l.query, ...(l.why ? { why: l.why } : {}), waits: "later" }, Date.now()) } : x));
  change((c) => withJob(c, id, (x) => (x.kind === "scan" ? { kind: "scan", target: x.target, asked: Date.now(), ...(x.mine ? { mine: true as const } : {}), ...(x.told?.length ? { told: x.told } : {}), lookup: at } : x)));
  startLookups(planHost(at.turn));
  try {
    const words = [turnOf(at.turn)?.said ?? "", ...(j.told ?? []).map((x) => x.answer)].join("\n");
    const session = await startScan({ ...requestOf(j.target, words, typeof navigator === "undefined" ? "" : navigator.language), ...(j.told?.length ? { told: [...j.told] } : {}) });
    change((c) => withJob(c, id, (x) => (x.kind === "scan" ? { ...x, session } : x)));
    void followScan();
  } catch (e) {
    change((c) => withJob(c, id, (x) => (x.kind === "scan" ? { ...x, error: message(e) } : x)));
  }
}

/** They say the product is theirs: its reviews are its customers' words, and what rests on them moves to "We know". */
export async function scanIsMine(id: string) {
  const t = turnOf(id);
  if (t?.job.kind !== "scan" || !t.job.session) return;
  const reviews = t.job.session.read.filter((r) => r.kind === "reviews" && r.sourceId);
  await Promise.all(reviews.map((r) => setSourceBasis(r.sourceId!, "said")));
  change((c) => withJob(c, id, (j) => (j.kind === "scan" ? { ...j, mine: true } : j)));
}

// ---------------------------------------------------------------------------
// From a scan's problems to what to build first

const scanJob = (id: string): ScanJob | null => {
  const j = turnOf(id)?.job;
  return j?.kind === "scan" ? j : null;
};
const plan = (id: string, fn: (p: ScanPlan) => ScanPlan) => change((c) => withJob(c, id, (j) => (j.kind === "scan" && j.plan ? { ...j, plan: fn(j.plan) } : j)));
export const planOf = (j: ScanJob) => ({ target: j.target, sources: (j.session?.read ?? []).flatMap((r) => (r.sourceId ? [r.sourceId] : [])), ...(j.told?.length ? { told: j.told } : {}) });
/** What it's working out now, or that it stopped. */
const stoppedPlan = (id: string, e: unknown) => {
  const aborted = (e as Error).name === "AbortError";
  plan(id, (p) => ({ ...p, step: "failed", error: aborted ? "You stopped it." : message(e) }));
};

/** What they told the scan while it read, as the interview's first round, answered (src/asking/). */
function toldRound(told: readonly ScanSaid[]): AskingState {
  const s = emptyAsking();
  if (!told.length) return s;
  const questions = told.map((t, i) => ({ id: `told${i + 1}`, title: t.question, why: "", multi: false, options: [], recommended: [], allowOther: true, by: "code" as const }));
  return { ...s, rounds: [{ questions, form: { ...initialFlow(questions.map(toQuestion), false), submitted: true }, said: Object.fromEntries(told.map((t, i) => [`told${i + 1}`, t.answer])) }] };
}

/** The scan plan's interview: kept on the plan, or made from a plan from before (its questions as the first round). */
const scanAsking = (id: string): AskingState | null => {
  const j = scanJob(id);
  const p = j?.plan;
  if (!p) return null;
  if (p.asking) return p.asking;
  const s = toldRound(j.told ?? []);
  return p.questions ? { ...s, rounds: [...s.rounds, { questions: p.questions.map((q) => ({ ...q, by: "code" as const })), form: initialFlow(p.questions.map(toQuestion), false) }] } : s;
};

/** The interview's host before what to build first: its turns read what the scan read, its lookups, and who the quotes show at the end. */
export const scanPlanHost = (id: string): AskingHost => ({
  key: id,
  memory: () => ({ flow: "scan", key: id, about: { product: useSpaceView.getState().space ?? null } }),
  get: () => scanAsking(id),
  set: (fn) => {
    const s = scanAsking(id);
    if (s) plan(id, (p) => ({ ...p, asking: fn(s) }));
  },
  turn: (s, signal) => {
    const j = scanJob(id);
    if (!j) throw new Error("The scan has gone.");
    return askScanPlan(planOf(j), askingIn(s, { said: j.target.kind === "idea" ? j.target.said : "", terms: useTerms.getState().terms, memory: scanPlanHost(id).memory?.() }), step(id), signal);
  },
  lookup: async (l, signal) => {
    if (l.kind === "tools") return toolsLookup(l, signal, { turn: id });
    if (l.kind === "project") return projectLookup(l);
    const j = scanJob(id);
    const about = j?.target.kind === "idea" ? j.target.said : (j?.target.name ?? "");
    const look = await planLook({ said: `What people do about this: ${about}`.slice(0, 4000), outline: [], rounds: [], looks: [], ...(l.query ? { query: l.query } : {}) }, undefined, signal);
    return { look, lines: look.lines.map((x, i) => ({ ref: `${l.id}-${i + 1}`, text: x.text, from: x.url ? hostOf(x.url) : "a page", whose: "a page online", ...(x.url ? { url: x.url } : {}), ...(x.quote ? { quote: x.quote } : {}) })) };
  },
  generate: (s, signal) => audiencesNow(id, s, signal),
  status: (st) => {
    plan(id, (p) => (p.step === "reading" ? p : { ...p, step: "questioning" }));
    step(id)(st === "thinking" ? "Working out what to ask" : "Looking it up before asking more");
  },
});

/** One stretch of the interview: until it asks, shows what's settled, or has found who the quotes show. */
async function runScanPlanAsk(id: string, stretch: (signal: AbortSignal) => Promise<Paused | void>) {
  const ctrl = begin(id);
  try {
    const why = await stretch(ctrl.signal);
    if (why === "ask" || why === "offer") plan(id, (p) => ({ ...p, step: "asking" }));
    else if (why === "settled") plan(id, (p) => ({ ...p, step: "settled" }));
  } catch (e) {
    if ((e as Error).name === "AbortError" || ctrl.signal.aborted) stopLookups(id);
    stoppedPlan(id, e);
  } finally {
    end(id);
  }
}

/** Work out what to build first: the interview first, in the box; what they told the scan while it read is never asked again. */
export function planStart(id: string) {
  const j = scanJob(id);
  if (!j) return;
  change((c) => withJob(c, id, (x) => (x.kind === "scan" ? { ...x, plan: { step: "questioning", asking: toldRound(x.told ?? []) } } : x)));
  void runScanPlanAsk(id, (signal) => goOn(scanPlanHost(id), signal));
}

/** The interview's done: their own answers kept as a source of their words (Qalam AI's picks never are), then who the quotes show. */
async function audiencesNow(id: string, s: AskingState, signal: AbortSignal) {
  const j = scanJob(id);
  if (!j?.plan) return;
  const said = answersOf(s).filter((a) => a.how === "own" && a.text).map((a) => ({ question: a.question, answer: a.text }));
  const words = said.map((x) => `${x.question} ${x.answer}`).join("\n");
  plan(id, (p) => ({ ...p, step: "reading", answers: words }));
  step(id)("Reading who these people are");
  const project = (await currentOrg().catch(() => null))?.name ?? projectName(j.target);
  const source = said.length ? await keepAnswers(said, `Your answers: ${project}`).catch(() => null) : null;
  const audiences = await planAudiences({ ...planOf(j), answers: words }, signal);
  plan(id, (p) => ({ ...p, step: "audiences", audiences, ...(source ? { answersSource: source } : {}) }));
}

export const scanRoundOf = (id: string) => scanAsking(id);
export const keepScanRound = (id: string, form: FlowState) => keepRound(scanPlanHost(id), form);
export const answerScanRound = (id: string, form: FlowState) => void runScanPlanAsk(id, (signal) => answer(scanPlanHost(id), form, signal));
export const picksScan = (id: string, form: FlowState) => void runScanPlanAsk(id, (signal) => picks(scanPlanHost(id), form, signal));
export const stopAskingScan = (id: string, form: FlowState | null) => void runScanPlanAsk(id, (signal) => stopAsking(scanPlanHost(id), form, signal));
export const confirmScan = (id: string) => void runScanPlanAsk(id, (signal) => confirm(scanPlanHost(id), signal));
export const lookItUpScan = (id: string) => void runScanPlanAsk(id, (signal) => lookItUp(scanPlanHost(id), signal));
export const askMeInsteadScan = (id: string) => void runScanPlanAsk(id, (signal) => askMeInstead(scanPlanHost(id), signal));
export const stopScanLookup = (id: string, lookup: string) => stopLookup(id, lookup);
export function offScan(id: string) {
  off(scanPlanHost(id));
  plan(id, (p) => ({ ...p, step: "asking" }));
}
export async function decideScanTerm(id: string, term: string, keep: boolean) {
  const t = scanAsking(id)?.terms.find((x) => x.id === term);
  if (!t) return;
  scanPlanHost(id).set((s) => decideTerm(s, term, keep));
  if (keep && !(await editTerm({ op: "add", term: t.term, means: t.means, avoid: t.avoid, by: "qalam" }))) scanPlanHost(id).set((s) => ({ ...s, terms: s.terms.map((x) => (x.id === term ? { ...x, state: undefined } : x)) }));
}

// A brief: what it lacks first, in the box, then written, then a tile under its card.

const briefNow = (id: string) => {
  const j = turnOf(id)?.job;
  return j?.kind === "brief" ? j.brief : j?.kind === "scan" ? j.plan?.brief : undefined;
};
const setBrief = (id: string, brief: BriefState) => change((c) => withJob(c, id, (j) => (j.kind === "brief" ? { ...j, brief } : j.kind === "scan" && j.plan ? { ...j, plan: { ...j.plan, brief } } : j)));

/** A New product's modules: worked out as a plan, in the chat. */
export function modulesFor(card: string) {
  toggleChat(true);
  if (st().loaded) void runAs(null, `What modules should “${cardTitle(card)}” have?`, "plan");
}

/** What's written for a card, as a turn says it. */
const BRIEF_ASK: Record<BriefShape, (title: string) => string> = { build: (t) => `Write a brief for “${t}”`, message: (t) => `Word the message for “${t}”`, steps: (t) => `Steps to run for “${t}”` };

/** A brief for a card on the canvas (a goal, a problem or a solution), a message plan or steps to run, asked in the chat. */
export function briefFor(card: string, shape: BriefShape = "build") {
  toggleChat(true);
  if (!st().loaded) return;
  const open = st().chat.turns.some((t) => t.job.kind === "brief" && t.job.card === card && t.job.brief.step !== "ready" && t.job.brief.step !== "failed");
  if (open) return;
  const title = cardTitle(card);
  // Qalam AI asks first, from what it would be written from; code's own questions only when it can't.
  const id = addTurn(BRIEF_ASK[shape](title), { kind: "brief", card, title, ...(shape !== "build" ? { shape } : {}), brief: { step: "thinking", asking: emptyAsking() } });
  void runBriefAsk(id, (signal) => goOn(briefHost(id), signal));
}

/** A scan's first pick: on the canvas first, since a brief's tile hangs under its card. */
export async function briefStart(id: string) {
  if (scanJob(id)?.plan?.step !== "placed") await placeFirstBuild(id);
  if (scanJob(id)?.plan?.step !== "placed") return;
  setBrief(id, { step: "thinking", asking: emptyAsking() });
  void runBriefAsk(id, (signal) => goOn(briefHost(id), signal));
}

const briefShape = (id: string): BriefShape => {
  const j = turnOf(id)?.job;
  return j?.kind === "brief" ? (j.shape ?? "build") : "build";
};

/** Try again: a turn that failed is taken again, and a brief that was written (or couldn't be) is asked for again from the start. */
export function briefAgain(id: string) {
  const b = briefNow(id);
  if (b?.step === "failed" && b.asking && !b.asking.confirmed) {
    setBrief(id, { ...b, step: "thinking", error: undefined, asking: loaded(b.asking) });
    return void runBriefAsk(id, (signal) => goOn(briefHost(id), signal));
  }
  setBrief(id, { step: "thinking", asking: emptyAsking() });
  void runBriefAsk(id, (signal) => goOn(briefHost(id), signal));
}

/** A brief's interview (src/asking/): code's questions first, then Qalam AI's; a brief from before reads its questions as the first round. */
const briefAsking = (id: string): AskingState | null => {
  const b = briefNow(id);
  return b ? (b.asking ?? emptyAsking(b.questions ?? briefRound(briefShape(id)))) : null;
};

/** The card a brief is written for: the turn's, or a scan's first pick once it's on the canvas. */
const briefCard = (id: string): string | null => {
  const j = turnOf(id)?.job;
  return j?.kind === "brief" ? j.card : j?.kind === "scan" ? (j.plan?.card ?? null) : null;
};

/** What the brief's interview settled, as the brief keeps it (`askedFromAnswers`). */
const askedFrom = (s: AskingState): BriefAsked => askedFromAnswers(answersOf(s));

/** The interview's host for a brief: its turns through the core, which read what it would be written from; its lookups; the writing at the end. */
export const briefHost = (id: string): AskingHost => ({
  key: id,
  memory: () => {
    const card = briefCard(id);
    const board = card ? boardOfCard(card) : null;
    return { flow: "brief", key: id, about: { product: card ? productOfCard(card) : (useSpaceView.getState().space ?? null), ...(card ? { card } : {}), ...(board ? { board } : {}) } };
  },
  get: () => briefAsking(id),
  set: (fn) => {
    const b = briefNow(id);
    const s = briefAsking(id);
    if (b && s) setBrief(id, { ...b, asking: fn(s) });
  },
  turn: async (s, signal) => {
    const card = briefCard(id);
    const req = card ? briefRequest(studio().doc, card, askedFrom(s), turnOf(id)?.job.kind === "brief" ? briefShape(id) : undefined) : null;
    if (!req) throw new Error("What it would be written from has gone from the canvas.");
    try {
      return await askBriefTurn(req, askingIn(s, { said: "", terms: useTerms.getState().terms, memory: briefHost(id).memory?.() }), step(id), signal);
    } catch (e) {
      // A first turn that can't be had: code's own questions, so they're still asked.
      if (signal.aborted || s.rounds.length) throw e;
      return { questions: briefRound(turnOf(id)?.job.kind === "brief" ? briefShape(id) : "build").map((q) => ({ ...q, by: "code" as const })), lookups: [], done: false, understood: [], terms: [], choices: [] };
    }
  },
  lookup: async (l, signal) => {
    const card = briefCard(id);
    if (l.kind === "tools") return toolsLookup(l, signal, { turn: id, ...(card ? { card } : {}) });
    if (l.kind === "project") return projectLookup(l, { product: card ? productOfCard(card) : null });
    const look = await planLook({ said: `What's needed to build or run: ${card ? cardTitle(card) : ""}`.slice(0, 4000), outline: [], rounds: [], looks: [], ...(l.query ? { query: l.query } : {}) }, undefined, signal);
    return { look, lines: look.lines.map((x, i) => ({ ref: `${l.id}-${i + 1}`, text: x.text, from: x.url ? hostOf(x.url) : "a page", whose: "a page online", ...(x.url ? { url: x.url } : {}), ...(x.quote ? { quote: x.quote } : {}) })) };
  },
  generate: (s, signal) => writeBriefNow(id, s, signal),
  status: (st) => {
    const b = briefNow(id);
    if (b && b.step !== "writing") setBrief(id, { ...b, step: st });
    step(id)(st === "thinking" ? "Working out what else it needs" : "Looking it up before asking more");
  },
});

/** The interview's done: their answers kept as a source of their own words, then the brief written from what's decided and the features one call works out. */
async function writeBriefNow(id: string, s: AskingState, signal: AbortSignal) {
  const job = turnOf(id)?.job;
  const b = briefNow(id);
  if (!job || !b) return;
  setBrief(id, { ...b, step: "writing" });
  step(id)("Writing it");
  const said = answersOf(s).filter((a) => a.how === "own" && a.text).map((a) => ({ question: a.question, answer: a.text }));
  const title = job.kind === "brief" ? job.title : (briefCard(id) && cardTitle(briefCard(id)!)) || "the first build";
  const source = b.source ?? (said.length ? await keepAnswers(said, `Your answers: ${title}`).catch(() => null) : null);
  const asked = askedFrom(s);
  const meta = await (job.kind === "brief" ? writeForCard(job.card, asked, signal, job.shape) : job.kind === "scan" ? writeForPick(job, asked, signal) : null);
  if (!meta) return setBrief(id, { ...briefNow(id)!, step: "failed", error: "What it was written from has gone." });
  await loadBriefs();
  setBrief(id, { ...briefNow(id)!, step: "ready", id: meta.id, file: meta.file, ...(source ? { source } : {}), error: undefined });
  onCanvasReady((c) => glideToLayer(c, meta.card));
}

/** One stretch of a brief's interview: until it asks, shows what's settled, or has written it. */
async function runBriefAsk(id: string, stretch: (signal: AbortSignal) => Promise<Paused | void>) {
  const ctrl = begin(id);
  try {
    const why = await stretch(ctrl.signal);
    const b = briefNow(id);
    if (b && (why === "ask" || why === "offer")) setBrief(id, { ...b, step: "asking" });
    else if (b && why === "settled") setBrief(id, { ...b, step: "settled" });
  } catch (e) {
    const stopped = (e as Error).name === "AbortError" || ctrl.signal.aborted;
    if (stopped) stopLookups(id);
    const b = briefNow(id);
    if (b) setBrief(id, { ...b, step: "failed", error: stopped ? "You stopped it." : message(e) });
  } finally {
    end(id);
  }
}

export const briefRoundOf = (id: string) => briefAsking(id);
export const keepBriefRound = (id: string, form: FlowState) => keepRound(briefHost(id), form);
export const answerBriefRound = (id: string, form: FlowState) => void runBriefAsk(id, (signal) => answer(briefHost(id), form, signal));
export const picksBrief = (id: string, form: FlowState) => void runBriefAsk(id, (signal) => picks(briefHost(id), form, signal));
export const stopAskingBrief = (id: string, form: FlowState | null) => void runBriefAsk(id, (signal) => stopAsking(briefHost(id), form, signal));
export const confirmBrief = (id: string) => void runBriefAsk(id, (signal) => confirm(briefHost(id), signal));
export const lookItUpBrief = (id: string) => void runBriefAsk(id, (signal) => lookItUp(briefHost(id), signal));
export const askMeInsteadBrief = (id: string) => void runBriefAsk(id, (signal) => askMeInstead(briefHost(id), signal));
export const stopBriefLookup = (id: string, lookup: string) => stopLookup(id, lookup);
export function offBrief(id: string) {
  off(briefHost(id));
  const b = briefNow(id);
  if (b) setBrief(id, { ...b, step: "asking" });
}

/** A term a brief's conversation settled: added to the project's words, or left out. */
export async function decideBriefTerm(id: string, term: string, keep: boolean) {
  const t = briefAsking(id)?.terms.find((x) => x.id === term);
  if (!t) return;
  briefHost(id).set((s) => decideTerm(s, term, keep));
  if (keep && !(await editTerm({ op: "add", term: t.term, means: t.means, avoid: t.avoid, by: "qalam" }))) briefHost(id).set((s) => ({ ...s, terms: s.terms.map((x) => (x.id === term ? { ...x, state: undefined } : x)) }));
}

const writeForCard = (card: string, asked: BriefAsked, signal: AbortSignal, shape?: BriefShape) => {
  const req = briefRequest(studio().doc, card, asked, shape);
  return req ? writeCardBrief(req, signal) : null;
};

function writeForPick(j: ScanJob, asked: BriefAsked, signal: AbortSignal) {
  const p = j.plan;
  const d = p?.build?.drafts.find((x) => x.id === p.chosen);
  if (!p?.build || !p.audience || !p.goal || !p.card || !d) return null;
  const pick = p.build.pick;
  const goal = firstGoal(p.audience.name, p.goal.action, p.goal.reach, p.goal.of);
  const about = p.audiences?.find((a) => a.name === p.audience?.name)?.about;
  return writeBrief(
    {
      ...planOf(j),
      card: p.card,
      topic: p.build.topic,
      draft: d.id,
      audience: p.audience.name,
      ...(about ? { about } : {}),
      goal: { title: goal.title, metric: goal.metric },
      answers: p.answers ?? "",
      why: pick?.draft === d.id ? pick.why : "",
      later: p.build.drafts.filter((x) => x.id !== d.id).map((x) => ({ draft: x.id, why: pick?.later.find((l) => l.draft === x.id)?.why ?? "" })),
      asked,
      known: j.session?.known ?? [],
    },
    signal,
  );
}

/** Who they'll build for: one the quotes show, or their own words. On to a first goal. */
export function pickAudience(id: string, a: ScanAudience | { name: string }) {
  const name = a.name.trim();
  if (!name) return;
  const refs = "quotes" in a ? a.quotes.map((q) => q.ref) : [];
  void keepAudience({ name, ...("about" in a && a.about ? { about: a.about } : {}), refs }).catch(() => {});
  plan(id, (p) => ({ ...p, step: "goal", audience: { name, refs }, goal: { action: "sign-up", reach: SUGGESTED_GOAL.reach, of: SUGGESTED_GOAL.of } }));
}

/** The first goal as they've set it. */
export function setPlanGoal(id: string, goal: { action: GoalAction; reach: number; of: number }) {
  plan(id, (p) => ({ ...p, goal }));
}

/** Their first goal taken: one solution drafted and picked for them. */
export async function planFirst(id: string, topic?: string) {
  const j = scanJob(id);
  if (!j?.plan?.audience) return;
  plan(id, (p) => ({ ...p, step: "picking", error: undefined }));
  const ctrl = begin(id);
  try {
    const build = await firstBuild({ ...planOf(j), audience: j.plan.audience.name, refs: j.plan.audience.refs, answers: j.plan.answers ?? "", ...(j.plan.answersSource ? { answersSource: j.plan.answersSource } : {}), ...(topic ? { topic } : {}) }, ctrl.signal);
    if (!build?.drafts.length) return plan(id, (p) => ({ ...p, step: "failed", error: build?.note || "I found no solution I could stand behind for this problem." }));
    plan(id, (p) => ({ ...p, step: "picked", build, chosen: build.pick?.draft ?? build.drafts[0].id }));
  } catch (e) {
    stoppedPlan(id, e);
  } finally {
    end(id);
  }
}

/** Where a plan that stopped carries on. */
export function planAgain(id: string) {
  const p = scanJob(id)?.plan;
  if (!p) return;
  if (p.audience) return void planFirst(id);
  if (p.questions) return plan(id, (x) => ({ ...x, step: "asking", error: undefined }));
  void planStart(id);
}

/** Another draft first: it's theirs to say. */
export const chooseDraft = (id: string, draft: string) => plan(id, (p) => ({ ...p, chosen: draft }));

/** On the canvas in one undo step: the first goal, its problem under it, the solution and its test. */
export async function placeFirstBuild(id: string) {
  const p = scanJob(id)?.plan;
  const d = p?.build?.drafts.find((x) => x.id === p.chosen);
  if (!p?.build || !p.audience || !p.goal || !d) return;
  const c = await problemCard(p.build.topic);
  if (!c) return;
  const goal = firstGoal(p.audience.name, p.goal.action, p.goal.reach, p.goal.of);
  const goalNode = makeCardNode(newCard("outcome", { title: goal.title, metric: { name: goal.metric, unit: "people", direction: "increase", baseline: null, current: null, target: goal.target } }));
  const { solution, test } = draftCards(d);
  const quotes = p.build.quotes;
  const backing = draftBacking(d, (ref) => quotes[ref] ?? null, Date.now(), newId);
  const evidence = [...backing.words];
  await visitSources(backing.quotes.map((q) => q.sourceId));
  for (const q of backing.quotes) {
    const s = await sourcesDb.get(q.sourceId).catch(() => null);
    const quote = s?.quotes.find((x) => x.id === q.quoteId);
    if (s && quote) evidence.push(quoteEvidence(s, quote, "ai"));
  }
  const solutionNode = makeCardNode({ ...solution, evidence });
  const doc = studio().doc;
  const sameCard = (k: string) => !k.startsWith("topic:") && doc.nodes[k]?.meta.ost?.kind === "opportunity" && doc.nodes[k].meta.ost.title === c.title;
  const already = Object.keys(doc.nodes).find(sameCard);
  const problemNode = already ? null : makeCardNode(newCard("opportunity", { title: c.title, evidence: c.evidence }));
  const faint = [...useSpaceView.getState().things].flatMap(([card, t]) => (t.type === "problem" && t.topic === p.build!.topic ? [card] : []));
  studio().mutate((x) => {
    for (const f of faint) {
      const parent = x.nodes[f]?.parentId;
      const list = parent ? x.nodes[parent].children : x.roots;
      const at = list.indexOf(f);
      if (at >= 0) list.splice(at, 1);
      delete x.nodes[f];
    }
    addCardIn(x, goalNode, null);
    if (already) moveCardsIn(x, [already], goalNode.id);
    else addCardIn(x, problemNode!, goalNode.id);
    addCardIn(x, solutionNode, already ?? problemNode!.id);
    if (test) addCardIn(x, makeCardNode(test), solutionNode.id);
  });
  void decideDraft(p.build.topic, d.id, "accepted").catch(() => {});
  plan(id, (x) => ({ ...x, step: "placed", card: solutionNode.id }));
  show(solutionNode.id);
}

// ---------------------------------------------------------------------------
// Worked out as a plan

const canvasPlan = (id: string) => {
  const j = turnOf(id)?.job;
  return j?.kind === "plan" ? j : null;
};
const setCanvasPlan = (id: string, fn: (j: PlanJob) => PlanJob) => change((c) => withJob(c, id, (j) => (j.kind === "plan" ? fn(j) : j)));

/** What each call is told: what they asked, the canvas as it is now, and the conversation so far (the interview's, src/asking/). */
const planAsk = (id: string): PlanAsk | null => {
  const t = turnOf(id);
  const j = canvasPlan(id);
  if (!t || !j) return null;
  const asking = j.asking ? askingIn(j.asking, { said: t.said, terms: useTerms.getState().terms, memory: planHost(id).memory?.() }) : undefined;
  // What a lookup found, and the words the challenges they kept rest on: what a card may rest on.
  const found = [...new Set([...(j.asking ? foundOf(j.asking).flatMap((l) => (l.piece ? [l.piece] : [])) : []), ...(j.kept ?? []).flatMap((k) => k.pieces)])];
  const kept = (j.kept ?? []).map(({ line, from }) => ({ line, from }));
  // Worked out with a consultant: how much they know (theirs over the read), who's asking, the playbook in use.
  const consult = j.consult ? { mode: "consult" as const, consult: { level: levelNow(j), ...(j.consult.situation ? { situation: j.consult.situation } : {}), ...(j.consult.playbook ? { playbook: j.consult.playbook } : {}), ...(j.consult.fixes ? { fixes: true as const } : {}) } } : {};
  return { said: t.said, outline: planOutline(studio().doc, useSpaceView.getState().things, goalsNow().north), rounds: j.rounds, looks: j.looks, ...(asking ? { asking } : {}), ...(found.length ? { found } : {}), ...(kept.length ? { kept } : {}), ...consult };
};

/** How much a consultant's turn teaches: what they set wins, then what the read found, then what's kept on this computer. */
const levelNow = (j: PlanJob): Level => {
  const f = useYou.getState().fluency;
  return levelOf({ set: f, read: j.consult?.situation?.level ?? null });
};

/**
 * What a consultant's turn brought besides its questions: who's asking (the first read, or an answer
 * that settled it), the playbook from the next turn on (a switch holds a while), the level it was asked
 * at, and the lines it noted on the business page, after the round whose answers said them. The first
 * read's level is kept on this computer unless they set their own; their position, where they said it,
 * once per project.
 */
function keepConsult(id: string, t: ConsultTurn) {
  const j = canvasPlan(id);
  if (!j?.consult) return;
  const first = !j.consult.situation && !!t.situation;
  const turn = (j.asking?.turns ?? 0) + 1;
  const round = (j.asking?.rounds.length ?? 0) - 1;
  setCanvasPlan(id, (x) => {
    const c = x.consult ?? { noted: [] };
    const situation = t.situation ?? c.situation;
    const now = c.playbook ?? situation?.layer;
    const next = now && t.picked ? nextPlaybook(now, t.picked, { turn, since: c.since ?? 1 }) : null;
    return {
      ...x,
      consult: {
        ...c,
        ...(situation ? { situation } : {}),
        ...(now ? { playbook: next?.playbook ?? now, since: next?.since ?? c.since ?? turn } : {}),
        level: levelNow({ ...x, consult: { ...c, ...(situation ? { situation } : {}) } }),
        noted: t.noted?.length ? [...c.noted, { round, lines: t.noted }] : c.noted,
      },
    };
  });
  if (first && t.situation) {
    void setFluency(t.situation.level, "qalam").catch(() => {});
    if (t.situation.position) void setMeOnce(t.situation.position);
  }
}

/** Their position, said in their first words: kept for the project once, never over one they set. */
async function setMeOnce(position: Position) {
  try {
    const now = await orgJson<{ me?: unknown }>("/goals");
    if (!now.me) await setMe({ position });
  } catch {
    // Not kept: nothing depends on it.
  }
}

/**
 * Plan mode on the interview (src/asking/): its state on the turn, each turn through the core, its
 * lookups in their project and on the web (each look also kept with the plan's looks, so the thread
 * shows it where it came), and the proposal at the end.
 */
export const planHost = (id: string): AskingHost => ({
  key: id,
  memory: () => ({ flow: canvasPlan(id)?.consult ? "consult" : "plan", key: id, about: { product: useSpaceView.getState().space ?? null } }),
  // A consultant paces its rounds to who's asking: a few at a time, open questions first, for someone new.
  pace: () => {
    const j = canvasPlan(id);
    if (!j?.consult) return {};
    const level = levelNow(j);
    const cap = capFor(level);
    return { ...(cap ? { cap } : {}), openFirst: level === "new" };
  },
  // A plan from before the interview goes on as one: its rounds and looks become its state.
  get: () => {
    const j = canvasPlan(id);
    return j ? planAsking(j) : null;
  },
  set: (fn) => setCanvasPlan(id, (j) => ({ ...j, asking: fn(planAsking(j)) })),
  turn: async (_s, signal) => {
    const t = await planAhead(planAsk(id)!, step(id), signal);
    keepConsult(id, t);
    return t;
  },
  lookup: async (l, signal) => {
    if (l.kind === "tools") return toolsLookup(l, signal, { turn: id });
    if (l.kind === "project") return projectLookup(l);
    if (l.kind === "scan") return scanLookup(l, signal, { turn: id });
    const look = await planLook({ ...planAsk(id)!, ...(l.query ? { query: l.query } : {}) }, undefined, signal);
    setCanvasPlan(id, (j) => ({ ...j, looks: [...j.looks, { ...look, after: (j.asking?.rounds.length ?? 0) - 1 }] }));
    return { look, lines: look.lines.map((x, i) => ({ ref: `${l.id}-${i + 1}`, text: x.text, from: x.url ? hostOf(x.url) : "a page", whose: "a page online", ...(x.url ? { url: x.url } : {}), ...(x.quote ? { quote: x.quote } : {}) })) };
  },
  generate: (_s, signal) => proposeNow(id, signal),
  status: (s) => setCanvasPlan(id, (j) => (j.step === "proposing" ? j : { ...j, step: s })),
});

/** Run one stretch of the conversation: until it asks, shows what's settled, or has proposed. Stopped, it says so; any other failure offers to try again. */
async function runCanvasPlan(id: string, stretch: (signal: AbortSignal) => Promise<Paused | void>) {
  const ctrl = begin(id);
  try {
    const why = await stretch(ctrl.signal);
    if (why === "ask" || why === "offer") setCanvasPlan(id, (j) => ({ ...j, step: "asking" }));
    else if (why === "settled") setCanvasPlan(id, (j) => ({ ...j, step: "settled" }));
  } catch (e) {
    const stopped = (e as Error).name === "AbortError" || ctrl.signal.aborted;
    if (stopped) stopLookups(id);
    setCanvasPlan(id, (j) => ({ ...j, step: "failed", error: stopped ? "You stopped it." : message(e) }));
  } finally {
    end(id);
  }
}

/** A question read first: asking what's known, or asking to work something out. It shows as asking until it's known, and any trouble leaves it a question. */
async function readQuestion(said: string) {
  if (await engineMissing()) return void addTurn(said, { kind: "noEngine", mode: "ask" });
  const id = addTurn(said, { kind: "ask", state: "asking" });
  const ctrl = begin(id);
  step(id)("Reading what you're asking");
  const route = await planRoute(said, AbortSignal.any([ctrl.signal, AbortSignal.timeout(20_000)])).then(
    (r) => r.route,
    () => "ask" as const,
  );
  end(id);
  if (ctrl.signal.aborted) return change((c) => withJob(c, id, () => ({ kind: "ask", state: "failed", error: "You stopped it." })));
  // Asking to work something out: worked out with them, the way a consultant would.
  if (route === "plan") consultOn(id, said);
  else void ask(said, id);
}

/**
 * Taken as a plan: a look around on the web starts at once and runs while Qalam AI's first turn asks
 * what it can without it; only the turn after waits for the look.
 */
function workOut(at: string | null, said: string) {
  const asking = startLookup(emptyAsking(), { id: "l0", kind: "web", query: "", waits: 1 }, Date.now());
  const id = jobAt(at, said, { kind: "plan", step: "thinking", rounds: [], looks: [], asking });
  void runCanvasPlan(id, (signal) => goOn(planHost(id), signal));
}

/**
 * Worked out with a consultant: no look before they've answered anything. Its first turn reads who's
 * asking, then asks the way the playbook for where they came in says, paced to how much they know.
 */
function consultOn(at: string | null, said: string, o: { first?: "goal" | "problem"; playbook?: PlaybookId; situation?: Situation; offer?: string; quiet?: true } = {}) {
  void ensureYou();
  // An app's link: reading its reviews is offered from the start, beside the first round, never read unasked.
  const asking = o.offer ? { ...emptyAsking(), scan: { id: "scan-0", query: o.offer, why: "Its reviews show what the people using it run into." } } : emptyAsking();
  const job: PlanJob = { kind: "plan", step: "thinking", rounds: [], looks: [], asking, consult: { noted: [], ...(o.first ? { first: o.first } : {}), ...(o.playbook ? { playbook: o.playbook } : {}), ...(o.situation ? { situation: o.situation } : {}) } };
  const id = o.quiet ? addTurn(said, job, undefined, { quiet: true }) : jobAt(at, said, job);
  void runCanvasPlan(id, (signal) => goOn(planHost(id), signal));
}

/**
 * Talk it through, from an empty section of the business page: the consultant on how the business works,
 * starting with that section. With something already going on in the chat, or a conversation about the
 * business still open, the chat opens on it instead.
 */
export async function talkThrough(section: BusinessSection, org: string) {
  toggleChat(true);
  // One conversation about the business at a time: an open one is carried on.
  const open = st().chat.turns.some((t) => t.job.kind === "plan" && t.job.consult?.playbook === "business" && (t.job.step === "thinking" || t.job.step === "looking" || t.job.step === "asking" || t.job.step === "settled"));
  if (!st().loaded || open || running(st().chat)) return;
  // The words that open it are Qalam AI's, so nothing is read from them about who's asking: what an
  // earlier conversation read from theirs stands, else what's known here.
  await ensureYou();
  const info = await currentOrg().catch(() => null);
  if (running(st().chat)) return;
  const before = [...st().chat.turns].reverse().find((t) => t.job.kind === "plan" && t.job.consult?.situation)?.job;
  const known = before?.kind === "plan" ? before.consult?.situation : undefined;
  const whose = info?.shape === "solo" ? "solo" : info?.shape === "team" ? "team" : "unsure";
  const situation: Situation = known ? { ...known, layer: "business" } : { named: true, product: "", name: org, role: "", level: useYou.getState().fluency?.level ?? "some", stage: "unknown", theirs: "yes", whose, layer: "business" };
  consultOn(null, `Work out how ${org} works, starting with ${SECTION_LABEL[section].toLowerCase()}`, { playbook: "business", situation });
}

/**
 * Reading what people say online, as a consultant's conversation offered it (src/asking/: a `scan`
 * lookup nothing waits on): yes starts it as its own job in the chat, hearing what they've said so far,
 * and the conversation goes on; what it finds goes back to the next turn. Not now leaves it.
 */
export async function readScan(id: string) {
  const j = canvasPlan(id);
  const offer = j?.asking?.scan;
  if (!j?.asking || !offer || offer.said) return;
  const target = scanTargetOf(offer.query, id, j);
  if (!target) return skipScan(id);
  // What they've said in their own words, the latest last: where the scan looks first.
  const told = answersOf(j.asking)
    .filter((a) => a.how === "own" && a.text)
    .slice(-8)
    .map((a) => ({ question: a.question, answer: a.text }));
  const label = target.kind === "product" ? target.name || "the app" : `“${target.said}”`;
  setCanvasPlan(id, (x) => (x.asking ? { ...x, asking: scanSaid(x.asking, true, Date.now()) } : x));
  const scan = addTurn(`Read what people say online about ${label}`, { kind: "scan", target, asked: Date.now(), ...(target.kind === "product" && target.mine ? { mine: true as const } : {}), ...(told.length ? { told } : {}), lookup: { turn: id, id: offer.id } });
  void saveNow();
  startLookups(planHost(id));
  try {
    const words = [turnOf(id)?.said ?? "", ...told.map((x) => x.answer)].join("\n");
    const session = await startScan({ ...requestOf(target, words, typeof navigator === "undefined" ? "" : navigator.language), ...(told.length ? { told } : {}) });
    change((c) => withJob(c, scan, (x) => (x.kind === "scan" ? { ...x, session } : x)));
    void followScan();
  } catch (e) {
    change((c) => withJob(c, scan, (x) => (x.kind === "scan" ? { ...x, error: message(e) } : x)));
  }
}

export const skipScan = (id: string) => setCanvasPlan(id, (x) => (x.asking ? { ...x, asking: scanSaid(x.asking, false, Date.now()) } : x));

/**
 * What a conversation's scan reads about: the product they named (theirs when they said so, so its
 * reviews are its customers' words), else the idea in their words. A name they never wrote is read as
 * words about an idea, never as some app that happens to share it.
 */
function scanTargetOf(query: string, id: string, j: PlanJob): ScanTarget | null {
  const sit = j.consult?.situation;
  const mine = sit?.theirs === "yes";
  const q = query.replace(/\s+/g, " ").trim();
  if (sit?.product && q.toLowerCase().includes(sit.product.toLowerCase())) return { kind: "product", name: sit.product, ...(mine ? { mine: true } : {}) };
  const t = scanInput(q);
  if (t?.kind !== "product") return t;
  const theirs = [turnOf(id)?.said ?? "", ...(j.asking ? answersOf(j.asking).filter((a) => a.how === "own").map((a) => a.text) : [])].join("\n").toLowerCase();
  if (t.app || (t.name && theirs.includes(t.name.toLowerCase()))) return { ...t, ...(mine ? { mine: true } : {}) };
  return { kind: "idea", said: q };
}

/** A conversation's scan, followed until it's read: the problems people raise and their words nearest it, for the next turn. */
async function scanLookup(l: Pick<Lookup, "id" | "query">, signal: AbortSignal, o: { turn: string }): Promise<{ lines: FoundLine[]; stopped?: true }> {
  const at = () => st().chat.turns.find((t) => t.job.kind === "scan" && t.job.lookup?.turn === o.turn && t.job.lookup.id === l.id);
  const settled = () => {
    const j = at()?.job;
    return !j || j.kind !== "scan" || !!j.error || (!!j.session && j.session.state !== "reading");
  };
  await new Promise<void>((resolve) => {
    if (settled() || signal.aborted) return resolve();
    const off = useCanvasChat.subscribe(() => {
      if (!settled()) return;
      off();
      resolve();
    });
    signal.addEventListener(
      "abort",
      () => {
        off();
        resolve();
      },
      { once: true },
    );
  });
  const t = at();
  if (signal.aborted) {
    if (t) stopTurn(t.id);
    throw new DOMException("Stopped", "AbortError");
  }
  const j = t?.job.kind === "scan" ? t.job : null;
  const s = j?.session;
  // Stopped where it reads (its own Stop): stopped here too, so nothing reads it as a failure.
  if (s?.state === "stopped") return { lines: [], stopped: true };
  if (!j || j.error || !s || s.state !== "done") throw new Error(j?.error ?? s?.error ?? "It stopped before it finished.");
  const pages = s.problems.slice(0, 6).map((p, i): FoundLine => ({ ref: `${l.id}-${i + 1}`, text: p.title, from: "a problem page, from what people say online", whose: "people online" }));
  // People's words nearest it, each saying whose they are: people online, or their customers (their own app's reviews are).
  const near = await projectLookup({ id: l.id, query: l.query }).catch(() => ({ lines: [] as FoundLine[] }));
  const quotes = near.lines
    .filter((x) => x.whose === "people online" || x.whose === "people said")
    .slice(0, 5)
    .map((x, i) => ({ ...x, ref: `${l.id}-q${i + 1}` }));
  const said = peopleQuotes(s.read);
  const thin: FoundLine[] = s.thin ? [{ ref: `${l.id}-0`, text: `Little to go on: ${s.problems.length === 1 ? "1 problem" : `${s.problems.length} problems`} from ${said === 1 ? "1 quote" : `${said} quotes`}, not a pattern`, from: "what it read" }] : [];
  return { lines: [...thin, ...pages, ...quotes] };
}

/** How much they know, loaded once this window works something out with them. */
let youLoading: Promise<void> | null = null;
const ensureYou = () => (youLoading ??= loadYou().catch(() => void (youLoading = null)));

/**
 * Explain more, or Skip the basics: theirs from now on, on this computer. A round they haven't touched
 * is asked again at the new level; one they've started answering keeps its questions, and the next round
 * changes.
 */
export function relevel(id: string, way: "simpler" | "pastBasics") {
  const j = canvasPlan(id);
  if (!j?.consult || !j.asking) return;
  const was = levelNow(j);
  const level = way === "simpler" ? simpler(was) : pastBasics(was);
  if (level === was) return;
  void setFluency(level, "you").catch(() => {});
  setCanvasPlan(id, (x) => (x.consult ? { ...x, consult: { ...x.consult, level } } : x));
  const cur = currentRound(j.asking);
  if (!cur || Object.keys(cur.form.answers).length || running(st().chat)?.id === id) return;
  setCanvasPlan(id, (x) => (x.asking ? { ...x, asking: dropCurrentRound(x.asking), step: "thinking" } : x));
  void runCanvasPlan(id, (signal) => goOn(planHost(id), signal));
}

/** The proposal: cards on the canvas for review. A problem only a page so far brings its page's words along. */
async function proposeNow(id: string, signal: AbortSignal) {
  const b = planAsk(id);
  if (!b) return;
  setCanvasPlan(id, (j) => ({ ...j, step: "proposing" }));
  // Their own answers, kept as a source of their words (not filed into the problem pages; Qalam AI's picks never are).
  const j0 = canvasPlan(id);
  if (j0?.asking && !j0.answers) {
    const said = answersOf(j0.asking).filter((a) => a.how === "own" && a.text).map((a) => ({ question: a.question, answer: a.text }));
    const source = said.length ? await keepAnswers(said, `Your answers: ${turnOf(id)?.said ?? "a plan"}`.slice(0, 200)).catch(() => null) : null;
    if (source) setCanvasPlan(id, (j) => ({ ...j, answers: source }));
  }
  const d = await planPropose(b, step(id), signal);
  await visitSources(Object.values(d.quotes).map((q) => q.sourceId));
  const things = useSpaceView.getState().things;
  const topics = [...new Set(d.cards.flatMap((c) => {
    const t = c.under && "card" in c.under ? things.get(c.under.card) : undefined;
    return t?.type === "problem" ? [t.topic] : [];
  }))];
  const pages = Object.fromEntries(await Promise.all(topics.map(async (t) => [t, (await problemCard(t).catch(() => null)) ?? undefined] as const)));
  const proposals = planProposals(d, { doc: studio().doc, things, pages, now: Date.now(), id: newId });
  const startCard = d.start ? d.cards.find((c) => c.ref === d.start)?.title : undefined;
  const done: Partial<PlanJob> = { ...(d.doubt ? { doubt: d.doubt } : {}), ...(startCard ? { start: startCard } : {}), proposals, cards: proposals.flatMap((p) => (p.kind === "card" ? [p.cardId] : [])) };
  if (!proposals.length) return setCanvasPlan(id, (j) => ({ ...j, ...done, step: "placed" }));
  // Before they see them: what their own evidence says against the proposals (src/challenge/).
  await checkFirst({ kind: "plan", turn: id }, proposals, { asked: turnOf(id)?.said ?? "", onLabel: step(id), signal });
  setCanvasPlan(id, (j) => ({ ...j, ...done, step: "review" }));
  startReview({ kind: "plan", turn: id }, proposals);
}

/** The plan's interview: kept on the turn, or made from a plan's rounds from before. */
const planAsking = (j: PlanJob): AskingState => j.asking ?? fromPlanRounds(j.rounds, j.looks);

/** A round's answers kept as they're given, so a reload finds them. */
export const keepPlanRound = (id: string, form: FlowState) => keepRound(planHost(id), form);

/** A round answered: on to what comes next. */
export const answerCanvasPlan = (id: string, form: FlowState) => void runCanvasPlan(id, (signal) => answer(planHost(id), form, signal));

/** "Use Qalam AI's picks" for what they haven't answered. */
export const picksCanvasPlan = (id: string, form: FlowState) => void runCanvasPlan(id, (signal) => picks(planHost(id), form, signal));

/** "Stop asking": what's answered stands; What we settled shows. */
export const stopAskingPlan = (id: string, form: FlowState | null) => void runCanvasPlan(id, (signal) => stopAsking(planHost(id), form, signal));

/** They saw what was settled: propose. */
export const confirmCanvasPlan = (id: string) => void runCanvasPlan(id, (signal) => confirm(planHost(id), signal));

/** "With fixes too": the consultant's diagnosis, with a solution under the likeliest causes. */
export function withFixes(id: string) {
  setCanvasPlan(id, (j) => (j.consult ? { ...j, consult: { ...j.consult, fixes: true } } : j));
  confirmCanvasPlan(id);
}

/**
 * Propose again with the challenges they kept (src/challenge/): what's under review is set aside, not
 * discarded, and the plan proposes again by what their evidence says; the new proposals are checked too.
 */
export function reproposeCanvasPlan(id: string) {
  const { key, run } = useChallenges.getState();
  const kept = key === `plan:${id}` ? keptChallenges(run) : [];
  if (!kept.length) return;
  if (useReview.getState().origin?.kind === "plan") setAside();
  const list: KeptChallenge[] = kept.map((c) => ({ line: c.words ?? c.line, from: c.cites.map((x) => x.text).slice(0, 4), pieces: c.cites.flatMap((x) => (x.piece ? [x.piece] : [])) }));
  setCanvasPlan(id, (j) => ({ ...j, kept: list, proposals: [], step: "proposing" }));
  void runCanvasPlan(id, (signal) => proposeNow(id, signal));
}

/** "Something's off": a round asks what. */
export function offCanvasPlan(id: string) {
  off(planHost(id));
  setCanvasPlan(id, (j) => ({ ...j, step: "asking" }));
}

/** The lookup put to them: yes, or ask me instead. */
export const lookItUpPlan = (id: string) => void runCanvasPlan(id, (signal) => lookItUp(planHost(id), signal));
export const askMeInsteadPlan = (id: string) => void runCanvasPlan(id, (signal) => askMeInstead(planHost(id), signal));

/** A lookup they don't want to wait for: what waited on it is asked again without it. */
export const stopPlanLookup = (id: string, lookup: string) => stopLookup(id, lookup);

/** A term the conversation settled: added to the project's words, or left out. */
export async function decidePlanTerm(id: string, term: string, keep: boolean) {
  const t = canvasPlan(id)?.asking?.terms.find((x) => x.id === term);
  if (!t) return;
  planHost(id).set((s) => decideTerm(s, term, keep));
  if (keep && !(await editTerm({ op: "add", term: t.term, means: t.means, avoid: t.avoid, by: "qalam" }))) planHost(id).set((s) => ({ ...s, terms: s.terms.map((x) => (x.id === term ? { ...x, state: undefined } : x)) }));
}

/** Tried again from where it stopped: what it has read and been told stands. */
export function retryCanvasPlan(id: string) {
  const j = canvasPlan(id);
  if (!j) return;
  setCanvasPlan(id, (x) => ({ ...x, step: "thinking", error: undefined, asking: loaded(planAsking(x)) }));
  void runCanvasPlan(id, (signal) => goOn(planHost(id), signal));
}

// ---------------------------------------------------------------------------
// Questions before a card's draft (src/asking/, server/org/ask-card.ts): in the chat, then the draft

const draftJob = (id: string) => {
  const j = turnOf(id)?.job;
  return j?.kind === "draft" ? j : null;
};
const setDraftJob = (id: string, fn: (j: DraftJob) => DraftJob) => change((c) => withJob(c, id, (j) => (j.kind === "draft" ? fn(j) : j)));

const DRAFT_LABEL: Record<AskFor, string> = { "draft-solutions": "Draft solutions", "break-down": "Break it down", "draft-problems": "Draft its problems", "draft-tests": "Draft its tests" };
const DRAFT_GO: Record<AskFor, string> = { "draft-solutions": "Draft them", "break-down": "Break it down", "draft-problems": "Draft its problems", "draft-tests": "Draft its tests" };
export const draftGo = (step: AskFor) => DRAFT_GO[step];

/** The titles above a card, nearest first (its problem, its goals). */
function aboveCard(card: string): string[] {
  const doc = studio().doc;
  const out: string[] = [];
  for (let p = doc.nodes[card]?.parentId; p && out.length < 6; p = doc.nodes[p]?.parentId ?? null) {
    const c = doc.nodes[p]?.meta.ost;
    if (c) out.push(`${KIND_LABEL[c.kind]}: ${c.title}`.slice(0, 400));
  }
  return out;
}

/** The answers as a source of their own words (made with the first answer, then kept current); the card rests on it once it's drafted. */
async function keepDraftAnswers(id: string, done = false): Promise<string | null> {
  const j = draftJob(id);
  if (!j) return null;
  if (!answered(j.asking.rounds).length && !j.source) return null;
  const t = useSpaceView.getState().things.get(j.card);
  const found = foundOf(j.asking).flatMap((l) => (l.piece ? [l.piece] : []));
  const card: CardAnswers = { v: 1, card: j.card, goal: t?.type === "goal" || t?.type === "card" ? t.goal : null, topic: null, step: j.step, buckets: j.asking.rounds, found, ...(done ? { done: true } : {}), at: Date.now() };
  const sid = j.source ?? newId();
  const rec = answersRecord({ id: sid, board: boardOfCard(j.card) ?? "", title: `Your answers: ${j.title}`.slice(0, 200), product: productOfCard(j.card), card, role: DUMP_ROLES.find((r) => r === j.role) ?? null, now: Date.now(), quoteId: (q) => `${sid}-${q}` });
  if (j.source) await updateSource(sid, (s) => ({ ...rec, addedAt: s.addedAt, ...(s.boards ? { boards: s.boards } : {}), ...(s.filed ? { filed: s.filed } : {}) }));
  else await addSourceRecord(rec);
  if (!j.source) setDraftJob(id, (x) => ({ ...x, source: sid }));
  return sid;
}

/** The interview's host for a card's draft: its turn through the core, its lookups in their project and on the web, the card's own draft at the end. */
export const draftHost = (id: string): AskingHost => ({
  key: id,
  memory: () => {
    const j = draftJob(id);
    if (!j) return null;
    const board = boardOfCard(j.card);
    return { flow: "card", key: id, about: { product: productOfCard(j.card), card: j.card, ...(board ? { board } : {}) } };
  },
  get: () => draftJob(id)?.asking ?? null,
  set: (fn) => setDraftJob(id, (j) => ({ ...j, asking: fn(j.asking) })),
  turn: async (s, signal) => {
    const j = draftJob(id)!;
    const c = studio().doc.nodes[j.card]?.meta.ost;
    if (!c) throw new Error("The card isn't on the canvas any more.");
    await keepDraftAnswers(id);
    const found = foundOf(s).map((l) => ({ id: l.ref, text: l.text.slice(0, 1200), source: l.from.slice(0, 300), whose: (l.whose ?? "people said").slice(0, 40) })).slice(0, 20);
    const r = await askCardTurn({ card: { kind: c.kind, title: c.title.slice(0, 400), description: (c.description ?? "").slice(0, 600), above: aboveCard(j.card) }, step: j.step, found, asking: askingIn(s, { said: "", terms: useTerms.getState().terms, memory: draftHost(id).memory?.() }) }, step(id), signal);
    if (r.role) setDraftJob(id, (x) => ({ ...x, role: r.role }));
    return r;
  },
  lookup: async (l, signal) => {
    const j = draftJob(id)!;
    if (l.kind === "tools") return toolsLookup(l, signal, { turn: id, card: j.card });
    if (l.kind === "project") {
      // Search ranks what's nearest, near or not: only a quote sharing two telling words with the card, their words and what was looked for counts as found, so the draft never rests on one that isn't about it.
      const r = await projectLookup(l, { product: productOfCard(j.card) });
      const about = [j.title, studio().doc.nodes[j.card]?.meta.ost?.description ?? "", theirWords(j.asking), l.query].join(" ");
      const lines = r.lines.filter((x) => sharedWords(about, x.text) >= 2);
      // What they know, searched: little from customers, and the draft hears what's said further afield too.
      if (l.id === KNOW && lines.filter((x) => x.whose === "people said").length < 2) lookFurther(id);
      return { lines };
    }
    if (l.kind === "online") {
      const r = await lookOnline({ title: j.title, words: l.query, product: productOfCard(j.card), place: { board: boardOfCard(j.card), card: j.card } }, undefined, signal);
      await visitSources(r.sources ?? []);
      const lines = (r.sources ?? []).flatMap((sid) => {
        const s = sourceOf(sid);
        return s ? s.quotes.map((q) => ({ text: q.text, from: s.title, whose: "people online", piece: quotePiece(q.id) })) : [];
      });
      if (!lines.length && r.error) throw new Error(r.error);
      return { lines: lines.slice(0, 10).map((x, i) => ({ ...x, ref: `${l.id}-${i + 1}` })) };
    }
    const what = j.step === "draft-problems" || j.step === "break-down" ? "What usually keeps people from reaching this goal" : "Ways to solve this problem";
    // A look in the background reads the web on the card and what they said; a turn's, on its own query.
    const said = l.waits === "draft" ? `${what}: ${j.title}.${l.query ? ` They say: ${l.query}` : ""}` : `${what}: ${j.title}`;
    const look = await planLook({ said: said.slice(0, 4000), outline: [], rounds: [], looks: [], ...(l.waits !== "draft" && l.query ? { query: l.query } : {}) }, undefined, signal);
    return { look, lines: look.lines.map((x, i) => ({ ref: `${l.id}-${i + 1}`, text: x.text, from: x.url ? hostOf(x.url) : "a page", whose: "a page online", ...(x.url ? { url: x.url } : {}), ...(x.quote ? { quote: x.quote } : {}) })) };
  },
  generate: (_s, signal) => runCardDraft(id, signal),
  status: (s) => {
    setDraftJob(id, (j) => (j.phase === "drafting" ? j : { ...j, phase: s }));
    step(id)(s === "thinking" ? "Working out what to ask" : draftJob(id)?.asking.end ? "Reading what the web says on it, for the draft" : "Looking it up before asking more");
  },
});

/** Code's own lookup: what they said they know, searched in their project (no tokens), which the next turn reads. */
const KNOW = "l0";

/** What they said they know about the card, in their own words ("" when they left it). */
const knownWords = (s: AskingState) => answersOf(s).find((a) => a.id === OPEN_ID && a.how === "own")?.text ?? "";

/** The round with code's open question sent (it comes closed from the box): what they know is searched in their project, and the next turn reads what it found. */
function searchWhatTheyKnow(id: string) {
  const j = draftJob(id);
  if (!j || !j.asking.rounds.at(-1)?.questions.some((q) => q.id === OPEN_ID) || j.asking.lookups.some((l) => l.id === KNOW)) return;
  const query = [j.title, knownWords(j.asking)].filter(Boolean).join(". ").slice(0, 300);
  draftHost(id).set((s) => startLookup(s, { id: KNOW, kind: "project", query, waits: s.turns }, Date.now()));
}

/** Little from customers on it: the web read on what they said (not before Break it down), and people online (a problem, lab "online"), in the background. Only the draft waits on them. */
function lookFurther(id: string) {
  const j = draftJob(id);
  if (!j) return;
  const said = knownWords(j.asking).slice(0, 300);
  const looks: Pick<Lookup, "id" | "kind" | "query" | "waits">[] = [];
  if (j.step !== "break-down") looks.push({ id: "bg-web", kind: "web", query: said, waits: "draft" });
  if (lab("online") && studio().doc.nodes[j.card]?.meta.ost?.kind === "opportunity") looks.push({ id: "bg-online", kind: "online", query: said, waits: "draft" });
  draftHost(id).set((s) => looks.reduce((x, l) => (x.lookups.some((y) => y.id === l.id) ? x : startLookup(x, l, Date.now())), s));
  startLookups(draftHost(id));
}

/** Draft now, without waiting for what's being read in the background: it goes with what it has. */
export const draftNow = (id: string) => generateNow(draftHost(id));

const DRAFTING: Record<AskFor, string> = { "draft-solutions": "Drafting solutions", "break-down": "Breaking it down", "draft-problems": "Drafting its problems", "draft-tests": "Drafting its tests" };

/** The interview is done: the card rests on their answers, and its own draft runs with them, what was found on their words and what was read on the web. */
async function runCardDraft(id: string, signal: AbortSignal) {
  const j = draftJob(id);
  if (!j || signal.aborted) return;
  setDraftJob(id, (x) => ({ ...x, phase: "drafting" }));
  step(id)(DRAFTING[j.step]);
  const source = await keepDraftAnswers(id, true);
  const s = source ? sourceOf(source) : undefined;
  if (s?.quotes.length && !useSpaceView.getState().virtual.has(j.card)) attachQuoteRefs(j.card, s.quotes.map((q) => ({ sourceId: s.id, quoteId: q.id })), { quiet: true });
  const looks = looksOf(j.asking).flatMap((l) => l.lines.map((x) => ({ text: x.text, ...(x.url ? { url: x.url } : {}), ...(x.title ? { title: x.title } : {}), ...(x.quote ? { quote: x.quote } : {}) })));
  const said = { ...(source ? { answers: source } : {}), found: foundOf(j.asking).flatMap((l) => (l.piece ? [l.piece] : [])).slice(0, 20), ...(looks.length ? { looks: looks.slice(0, 8) } : {}) };
  const t = useSpaceView.getState().things.get(j.card);
  // The draft says what came of it on its own (a review on the canvas, or why not); the thread says which.
  const before = useReview.getState().proposals;
  if (j.step === "draft-solutions") await draftSolutionsFor(j.card, said);
  else if (j.step === "break-down" && t?.type === "goal") await breakDownFor(j.card, t.goal, j.levers as GoalLever[], said);
  else if (j.step === "draft-problems" && t?.type === "goal") await draftProblemsFor(j.card, t.goal, said);
  else if (j.step === "draft-tests") await draftTestsFor(j.card);
  const opened = useReview.getState().proposals !== before && useReview.getState().proposals.length > 0;
  // Filed once the draft has read what was there: a page made from their words never races the draft drawn from them.
  if (source) void fileAfterReading([source], productOfCard(j.card));
  setDraftJob(id, (x) => ({ ...x, phase: "done", ...(opened ? {} : { none: true as const }) }));
}

/** One stretch of a card's interview: until it asks, shows what's settled, or has drafted. */
async function runDraftAsk(id: string, stretch: (signal: AbortSignal) => Promise<Paused | void>) {
  const ctrl = begin(id);
  try {
    const why = await stretch(ctrl.signal);
    if (why === "ask" || why === "offer") setDraftJob(id, (j) => ({ ...j, phase: "asking" }));
    else if (why === "settled") setDraftJob(id, (j) => ({ ...j, phase: "settled" }));
  } catch (e) {
    const stopped = (e as Error).name === "AbortError" || ctrl.signal.aborted;
    if (stopped) stopLookups(id);
    setDraftJob(id, (j) => ({ ...j, phase: "failed", error: stopped ? "You stopped it." : message(e) }));
  } finally {
    end(id);
  }
}

/**
 * Ask before a card's draft, in the chat: every draft goes through the interview. A card nothing backs
 * yet starts with code's own question (what they know about it); otherwise Qalam AI's first turn asks
 * what it needs, or drafts at once when nothing's open. One conversation per card: a running one is
 * picked up rather than started again.
 */
export function askBeforeDraft(card: string, step: AskFor, o: { levers?: GoalLever[]; thin?: boolean } = {}) {
  const c = studio().doc.nodes[card]?.meta.ost;
  if (!c) return;
  toggleChat(true);
  if (asked(st().chat)[card]) return;
  // Answers kept for this draft and not drafted with yet (a chat cleared half-way): the questions pick up there.
  const kept = keptAnswers(card);
  const from = kept?.answers?.step === step ? kept : undefined;
  const asking = from?.answers ? fromBuckets(from.answers.buckets) : emptyAsking(o.thin ? [openQuestion(c.kind)] : []);
  const role = from?.quotes.find((q) => q.role)?.role ?? null;
  const id = addTurn(`${DRAFT_LABEL[step]} for “${c.title}”`, { kind: "draft", card, title: c.title, step, phase: currentRound(asking) ? "asking" : "thinking", asking, source: from?.id ?? null, role, levers: o.levers ?? [] });
  if (!currentRound(asking)) void runDraftAsk(id, (signal) => goOn(draftHost(id), signal));
}

/** The cards whose draft is being asked about in a chat, each with its turn. */
function asked(c: CanvasChat): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of c.turns) if (t.job.kind === "draft" && t.job.phase !== "done" && t.job.phase !== "failed") out[t.job.card] = t.id;
  return out;
}

// The cards being asked about here: their next steps say they're answered in the chat (../../discovery/ask.ts).
useCanvasChat.subscribe((s, prev) => {
  if (s.chat === prev.chat) return;
  const cards = asked(s.chat);
  const was = useAskingIn.getState().cards;
  if (Object.keys(cards).length !== Object.keys(was).length || Object.entries(cards).some(([k, v]) => was[k] !== v)) useAskingIn.setState({ cards });
});

export const keepDraftRound = (id: string, form: FlowState) => keepRound(draftHost(id), form);
export function answerDraft(id: string, form: FlowState) {
  keepRound(draftHost(id), form);
  searchWhatTheyKnow(id);
  void runDraftAsk(id, (signal) => answer(draftHost(id), form, signal));
}
export function picksDraft(id: string, form: FlowState) {
  keepRound(draftHost(id), form);
  searchWhatTheyKnow(id);
  void runDraftAsk(id, (signal) => picks(draftHost(id), form, signal));
}
export const stopAskingDraft = (id: string, form: FlowState | null) => void runDraftAsk(id, (signal) => stopAsking(draftHost(id), form, signal));
export const confirmDraft = (id: string) => void runDraftAsk(id, (signal) => confirm(draftHost(id), signal));
export const lookItUpDraft = (id: string) => void runDraftAsk(id, (signal) => lookItUp(draftHost(id), signal));
export const askMeInsteadDraft = (id: string) => void runDraftAsk(id, (signal) => askMeInstead(draftHost(id), signal));
export const stopDraftLookup = (id: string, lookup: string) => stopLookup(id, lookup);
export function offDraft(id: string) {
  off(draftHost(id));
  setDraftJob(id, (j) => ({ ...j, phase: "asking" }));
}
export function retryDraft(id: string) {
  setDraftJob(id, (j) => ({ ...j, phase: "thinking", error: undefined, asking: loaded(j.asking) }));
  void runDraftAsk(id, (signal) => goOn(draftHost(id), signal));
}

/** A term a draft's conversation settled: added to the project's words, or left out. */
export async function decideDraftTerm(id: string, term: string, keep: boolean) {
  const t = draftJob(id)?.asking.terms.find((x) => x.id === term);
  if (!t) return;
  draftHost(id).set((s) => decideTerm(s, term, keep));
  if (keep && !(await editTerm({ op: "add", term: t.term, means: t.means, avoid: t.avoid, by: "qalam" }))) draftHost(id).set((s) => ({ ...s, terms: s.terms.map((x) => (x.id === term ? { ...x, state: undefined } : x)) }));
}

/** A decision an interview offered (lab "decisions"): kept with the decisions, on its card's board else the chat's, or left out. */
function decideChoiceIn(h: AskingHost, choice: string, keep: boolean, card: string | null) {
  const c = h.get()?.choices.find((x) => x.id === choice);
  if (!c || c.state) return;
  h.set((s) => decideChoice(s, choice, keep));
  if (keep) recordChoice({ choice: c.choice, why: c.why, instead: c.instead, card });
}
export const decidePlanChoice = (id: string, choice: string, keep: boolean) => decideChoiceIn(planHost(id), choice, keep, null);
export const decideDraftChoice = (id: string, choice: string, keep: boolean) => decideChoiceIn(draftHost(id), choice, keep, draftJob(id)?.card ?? null);
export const decideBriefChoice = (id: string, choice: string, keep: boolean) => decideChoiceIn(briefHost(id), choice, keep, briefCard(id));
export const decideScanChoice = (id: string, choice: string, keep: boolean) => decideChoiceIn(scanPlanHost(id), choice, keep, null);

/** Its proposals brought back to the canvas (a reload, or another review that was in the way). */
export function showCanvasPlan(id: string) {
  const j = canvasPlan(id);
  if (j?.proposals?.length) startReview({ kind: "plan", turn: id }, j.proposals);
}

/** After a reload: the proposals a plan waited on come back on the canvas. */
export function resumePlans() {
  // A scan a conversation asked for reads on in the core: its lookup follows its job again.
  for (const t of st().chat.turns) if (t.job.kind === "plan" && t.job.asking?.lookups.some((l) => l.kind === "scan" && l.state === "running")) startLookups(planHost(t.id));
  if (useReview.getState().proposals.length) return;
  const t = [...st().chat.turns].reverse().find((x) => x.job.kind === "plan" && x.job.step === "review" && !!x.job.proposals?.length);
  if (t) showCanvasPlan(t.id);
}

/** The review on the canvas is what settles a plan: what's left is kept on its turn, and once nothing is, it says what was taken. Started with the chat, once. */
let watchingReview = false;
function watchReview() {
  if (watchingReview) return;
  watchingReview = true;
  useReview.subscribe((s, prev) => {
    const origin = prev.origin?.kind === "plan" ? prev.origin : s.origin?.kind === "plan" ? s.origin : null;
    if (!origin || s.proposals === prev.proposals || !canvasPlan(origin.turn)) return;
    setCanvasPlan(origin.turn, (j) => (s.proposals.length ? { ...j, proposals: s.proposals } : { ...j, proposals: [], step: "placed" }));
  });
}

// ---------------------------------------------------------------------------
// A brain dump

/** Their own thinking, read as a brain dump (src/ui/discovery/dump.ts): their words and their own docs as one text. */
async function dumpIt(at: string | null, said: string, docs: readonly SentDoc[], asOwn = false) {
  const source = newId();
  const whole = joinParts([...(said ? [{ body: said }] : []), ...docs.map((d) => docPart({ via: d.via, title: d.title, text: d.ingested.text, blocks: d.ingested.blocks }))]).text;
  // A doc that read as their thinking can be longer than a dump takes: its start, and the reply says so.
  const cut = asOwn && whole.length > DUMP_MAX_CHARS;
  const text = cut ? whole.slice(0, DUMP_MAX_CHARS) : whole;
  const id = jobAt(at, said, { kind: "dump", source, ...(asOwn ? { asOwn: { title: docs[0]?.ingested.title ?? docs[0]?.title ?? "It", ...(cut ? { cut: true as const } : {}) } } : {}) }, docs.map(docRef));
  try {
    await startDump(text, { id: source });
    sourceCame(sourceOf(source)?.title ?? "Your thinking");
  } catch (e) {
    change((c) => withJob(c, id, (j) => (j.kind === "dump" ? { ...j, error: message(e) } : j)));
  }
}

// ---------------------------------------------------------------------------
// Help me find one

const FIND_SAID: Record<FindWhat, string> = { goal: "Help me find a goal", problem: "Help me find a problem" };

/** "Help me find one" on `space`'s canvas: code's opening questions in the box (one at a time: an open one is kept). */
export async function findWith(what: FindWhat, space: string | null): Promise<void> {
  toggleChat(true);
  const key = chatKey(space);
  if (st().key !== key || !st().loaded) return void useCanvasChat.setState({ pending: { key, what } });
  const open = st().chat.turns.find((t) => t.job.kind === "find");
  if (open?.job.kind === "find" && open.job.what === what) return;
  // Before they answer anything: it would be read by what isn't there.
  if (await engineMissing()) return void addTurn(FIND_SAID[what], { kind: "noEngine", mode: null });
  if (open) dropTurn(open.id);
  // Qalam AI asks from what's known, however little; code's own questions when it can't.
  const id = addTurn(FIND_SAID[what], { kind: "find", what, loading: true });
  void askFrom(id, what);
}

/** Qalam AI's opening questions, from what's known (code's own stand in when it has none). */
async function askFrom(id: string, what: FindWhat) {
  const questions = await orgJson<{ questions: PlanQuestion[] }>("/find/questions", { method: "POST", json: { what } }).then((r) => r.questions, () => []);
  if (!questions.length) return codeOpening(id);
  change((c) => withJob(c, id, (j) => (j.kind === "find" ? { kind: "find", what: j.what, questions } : j)));
}

/** Code's own opening questions, each with what was said before to one like it (src/memory/known.ts). */
async function codeOpening(id: string) {
  const j = turnOf(id)?.job;
  if (j?.kind !== "find") return;
  const questions = await withKnownAnswers(openingMemory(id, j.goal), j.goal ? focusRound() : findRound(j.what));
  change((c) => withJob(c, id, (x) => (x.kind === "find" ? { kind: "find", what: x.what, ...(x.goal ? { goal: x.goal } : {}), ...(x.look ? { look: x.look } : {}), ...(x.error ? { error: x.error } : {}), questions } : x)));
}

/** The opening questions a find turn asks: Qalam AI's from the domain (and, for a goal, what the web says gets in its way), else code's. */
export const findQuestionsOf = (j: { what: FindWhat; questions?: PlanQuestion[]; goal?: FocusGoal }) => (j.questions?.length ? j.questions : j.goal ? focusRound() : findRound(j.what));

// ---------------------------------------------------------------------------
// The problem to focus on for a goal (its next steps' "Find the problem to focus on")

/** A conversation for the goal still going in the chat: its questions, or its dump not placed yet. */
function focusing(goal: string): ChatTurn | undefined {
  const sources = useSources.getState().list;
  return [...st().chat.turns].reverse().find((t) => {
    if (t.job.kind === "find") return t.job.goal?.id === goal;
    if (t.job.kind !== "dump" || t.job.find?.goal?.id !== goal || t.job.error) return false;
    const phase = sources.find((x) => x.id === (t.job as { source: string }).source)?.dump?.phase;
    return !!phase && phase !== "placed" && phase !== "failed";
  });
}

/**
 * Find the problem to focus on for a goal: Qalam AI looks on the web for what usually gets in the
 * way of goals like it (server/org/focus.ts), asks from what it read, reads their answers as a brain
 * dump aimed under the goal's card, looks again where their answers call for it, and proposes 1 to
 * 3 problems under it. One conversation per goal at a time: an open one is carried on.
 */
export function focusWith(card: string, goal: string) {
  toggleChat(true);
  if (!st().loaded || focusing(goal)) return;
  const title = goalById(goalsNow(), goal)?.title ?? cardTitle(card);
  const g: FocusGoal = { card, id: goal, title };
  const id = addTurn(`Find the problem to focus on for “${title}”`, { kind: "find", what: "problem", goal: g, loading: true });
  void openFocus(id, g);
}

/** The opening look and the questions from it (none held, or no web here: code's own questions). */
async function openFocus(id: string, g: FocusGoal) {
  const ctrl = begin(id);
  try {
    const r = await lookForGoal(g.id, { open: true }, step(id), ctrl.signal);
    change((c) => withJob(c, id, (j) => (j.kind === "find" ? { kind: "find", what: j.what, goal: j.goal, look: r.look, ...(r.questions.length ? { questions: r.questions } : {}) } : j)));
    if (!r.questions.length) await codeOpening(id);
  } catch (e) {
    // Stopped, or it failed: code's own questions, and it says why (a turn let go is gone already).
    const stopped = (e as Error).name === "AbortError" || ctrl.signal.aborted;
    change((c) => withJob(c, id, (j) => (j.kind === "find" ? { kind: "find", what: j.what, goal: j.goal, error: stopped ? "You stopped the look, so I'll go by what you tell me." : `I couldn't look it up (${message(e)}), so I'll go by what you tell me.` } : j)));
    await codeOpening(id);
  } finally {
    end(id);
  }
}

/** Where the project's memory keeps an opening's answers (src/memory/): the find or focus conversation, by its turn. */
function openingMemory(id: string, goal?: FocusGoal | null) {
  return { flow: goal ? ("focus" as const) : ("find" as const), key: id, about: { product: useSpaceView.getState().space ?? null, ...(goal ? { goal: goal.id, card: goal.card } : {}) } };
}

/**
 * The opening round answered: their answers read as a brain dump that's asked for a goal or a problem.
 * Each answer as it was given (their words, Qalam AI's pick, a don't-know); one with `before` they gave
 * in another conversation, not asked now.
 */
export async function answerFind(id: string, answers: OpeningAnswers) {
  const t = turnOf(id);
  if (t?.job.kind !== "find") return;
  const what = t.job.what;
  const questions = findQuestionsOf(t.job);
  // The opening questions remembered as they're answered (src/memory/), whatever comes of them; what they said before isn't said again.
  const opened = t.job.goal;
  void rememberRound({
    ...openingMemory(id, opened),
    answers: questions.flatMap((q) => {
      const a = openingAnswer(answers[q.id]);
      return a.before ? [] : [{ qid: q.id, q: q.title, a: a.text, how: a.how }];
    }),
  });
  const { text: words, asked, said } = findText(questions, answers);
  if (words.length < FIND_MIN) return change((c) => withJob(c, id, (j) => (j.kind === "find" ? { ...j, error: "Say a little more in your answers, so there's something to go on." } : j)));
  const source = newId();
  const { goal, look } = t.job;
  change((c) => withJob(c, id, () => ({ kind: "dump", source, find: { what, said, ...(goal ? { goal } : {}) } })));
  try {
    // The source reads on its own: each question asked and their answer (for a goal, what the web said first), pieces from the answers alone.
    const org = useMarket.getState().org || undefined;
    const record = goal ? focusTranscript(questions, answers, { goal: goal.title, org, look }) : findTranscript(questions, answers, { what, org });
    // A goal whose card went meanwhile: the problems go where problems go.
    const under = goal && studio().doc.nodes[goal.card] ? goal : null;
    await startDump(record.text, {
      id: source,
      aim: { find: what, asked, ...(under ? { goal: { card: under.card, id: under.id } } : {}) },
      title: goal ? `Your answers: the problem to focus on for “${goal.title.slice(0, 80)}”` : `Your answers: finding ${what === "goal" ? "a goal" : "a problem"}`,
      parts: record.parts,
      ...(look ? { looks: [{ ...look, after: -1 }] } : {}),
    });
    sourceCame(sourceOf(source)?.title ?? "Your answers");
  } catch (e) {
    change((c) => withJob(c, id, (j) => (j.kind === "dump" ? { ...j, error: message(e) } : j)));
  }
}

// ---------------------------------------------------------------------------
// The goal a problem could move (its next steps' "Find the goal it could move")

const goalJob = (id: string, fn: (j: GoalForJob) => GoalForJob) => change((c) => withJob(c, id, (j) => (j.kind === "goalfor" ? fn(j) : j)));
const goalForOf = (id: string): GoalForJob | null => {
  const j = turnOf(id)?.job;
  return j?.kind === "goalfor" ? j : null;
};

/** The goals' cards on the canvas now: each goal's id, by its card. */
function goalsOnCanvas(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [card, t] of useSpaceView.getState().things) if (t.type === "goal" && studio().doc.nodes[card]) out.set(t.goal, card);
  return out;
}

/** The problem's own words: what backs its card. */
function backingOf(card: string): string[] {
  const n = studio().doc.nodes[card];
  return isOstCard(n) ? backing(n.meta.ost).map((e) => e.text) : [];
}

/**
 * Find the goal a problem could move: the goals on the canvas first (server/org/moves.ts), then the
 * web when none fits, then that goal's number, theirs or one suggested. One conversation per problem
 * at a time: an open one is carried on.
 */
export function goalWith(card: string, topic?: string) {
  toggleChat(true);
  if (!st().loaded) return void useCanvasChat.setState({ pendingGoal: { card, ...(topic ? { topic } : {}) } });
  const open = st().chat.turns.some((t) => t.job.kind === "goalfor" && t.job.card === card && t.job.step !== "done" && t.job.step !== "failed");
  if (open) return;
  const title = cardTitle(card);
  const id = addTurn(`Find the goal “${title}” could move`, { kind: "goalfor", card, title, ...(topic ? { topic } : {}), step: "looking" });
  void lookForGoals(id, false);
}

/** A problem's page put on the canvas as a card, and the chat finding a goal it could move. */
export async function goalForProblem(topic: string) {
  const { workOnNeed } = await import("../SpacePanel");
  const card = await workOnNeed(topic);
  if (card) goalWith(card, topic);
}

/** The same from the best-backed problem, for where nothing has been picked. */
export async function goalForTopProblem() {
  const top = await needsDb.list().then((n) => n.needs[0]?.topic, () => undefined);
  if (top) await goalForProblem(top);
  else openProblems();
}

/** Look for the goals it could move (`look`: the ones on the canvas are ruled out, so the web). */
async function lookForGoals(id: string, look: boolean) {
  const j = goalForOf(id);
  if (!j) return;
  goalJob(id, (x) => ({ ...x, step: "looking", error: undefined }));
  const ctrl = begin(id);
  try {
    const r = await goalsForProblem({ title: j.title, ...(j.topic ? { topic: j.topic } : {}), words: backingOf(j.card), goals: [...goalsOnCanvas().keys()], look, product: st().space }, step(id), ctrl.signal);
    goalJob(id, (x) => ({ ...x, step: r.fits.length ? "fits" : "ideas", fits: r.fits, ideas: r.ideas, looked: r.looked }));
  } catch (e) {
    const stopped = (e as Error).name === "AbortError" || ctrl.signal.aborted;
    goalJob(id, (x) => ({ ...x, step: "failed", error: stopped ? "You stopped it." : message(e) }));
  } finally {
    end(id);
  }
}

/** Look for it again, after it failed. */
export const retryGoalFor = (id: string) => void lookForGoals(id, !!goalForOf(id)?.fits);

/** None of the goals it fits is the one: on to the web. */
export const lookPastFits = (id: string) => void lookForGoals(id, true);

/** The problem's card under a goal's card, one undo step with whatever else `also` does. */
function hangUnder(card: string, goalCard: string) {
  studio().mutate((d) => {
    if (!d.nodes[card] || !d.nodes[goalCard]) return;
    delete d.nodes[goalCard].meta.ost!.collapsed;
    moveCardsIn(d, [card], goalCard);
  });
  show(card, { select: false });
}

/** A goal on the canvas it fits, taken: the problem goes under it, then its number if it lacks one. */
export function takeFit(id: string, goal: string) {
  const j = goalForOf(id);
  const fit = j?.fits?.find((f) => f.goal === goal);
  const goalCard = goalsOnCanvas().get(goal);
  if (!j || !fit || !goalCard) return;
  hangUnder(j.card, goalCard);
  if (j.topic) void orgFetch("/bearings", { method: "POST", json: { need: j.topic, goal, on: true, how: fit.how, bears: fit.bears } }).catch(() => {});
  const m = goalById(goalsNow(), goal)?.metric;
  const on: GoalForOn = { card: goalCard, title: fit.title, goal, ...(m?.name ? { metric: { name: m.name, ...(m.unit ? { unit: m.unit } : {}), direction: m.direction } } : {}), now: m?.current ?? m?.baseline ?? null };
  askNumber(id, on);
}

/** A goal it fits, left out: a person's word stands (Qalam AI won't link them again). With none left, on to the web. */
export function leaveFit(id: string, goal: string) {
  const j = goalForOf(id);
  if (!j) return;
  if (j.topic) void orgFetch("/bearings", { method: "POST", json: { need: j.topic, goal, on: false } }).catch(() => {});
  const fits = (j.fits ?? []).filter((f) => f.goal !== goal);
  goalJob(id, (x) => ({ ...x, fits }));
  if (!fits.length) void lookForGoals(id, true);
}

/** A goal proposed for it, taken: written on the canvas with the problem under it, then its number. */
export function takeIdea(id: string, idea: string) {
  const j = goalForOf(id);
  const g = j?.ideas?.find((x) => x.id === idea);
  if (!j || !g) return;
  const node = makeCardNode(newCard("outcome", { title: g.title, metric: { ...g.metric, baseline: null, current: null, target: null } }));
  studio().mutate((d) => {
    addCardIn(d, node, null);
    if (d.nodes[j.card]) moveCardsIn(d, [j.card], node.id);
  });
  show(node.id, { select: false });
  askNumber(id, { card: node.id, title: g.title, metric: g.metric, now: null, others: g.others });
}

/** What the box asks about the goal's number; nothing to ask: it's done. */
function askNumber(id: string, on: GoalForOn) {
  const n = studio().doc.nodes[on.card];
  const asked = numberRound(isOstCard(n) ? n.meta.ost.metric : undefined);
  goalJob(id, (x) => ({ ...x, on, step: asked.length ? "asking" : "done" }));
}

/** The questions the box asks now, for a goal's number. */
export function numberQuestions(id: string): PlanQuestion[] {
  const on = goalForOf(id)?.on;
  const n = on && studio().doc.nodes[on.card];
  return numberRound(isOstCard(n) ? n.meta.ost.metric : on?.metric ? { name: on.metric.name } : undefined);
}

/** A goal's card given its number (it reaches goals.md as the canvas settles). */
function writeNumber(card: string, patch: Partial<OstMetric>) {
  studio().mutate((d) => updateCardIn(d, card, (c) => void (c.metric = { name: "", direction: "increase", baseline: null, current: null, target: null, ...c.metric, ...patch })));
}

/** Their answers about the number: what they gave goes on the goal; with no number in mind, one's suggested. */
export async function answerNumber(id: string, answers: Readonly<Record<string, string>>) {
  const j = goalForOf(id);
  const on = j?.on;
  if (!j || !on || !studio().doc.nodes[on.card]) return;
  const name = answers.name?.trim().slice(0, 80);
  const metric = on.metric ?? (name ? { name, direction: "increase" as const } : undefined);
  // Nothing to measure it by: it stays without a number.
  if (!metric) return goalJob(id, (x) => ({ ...x, step: "done" }));
  const now = answers.now ? nowFrom(answers.now) : (on.now ?? null);
  const said = answers.target ? targetFrom(answers.target, { now, unit: metric.unit, direction: metric.direction }) : null;
  writeNumber(on.card, { ...metric, ...(now !== null ? { current: now, baseline: now } : {}), ...(said?.target !== null && said?.target !== undefined ? { target: said.target } : {}) });
  const placed: GoalForOn = { ...on, metric, now };
  if (said?.target !== null && said?.target !== undefined) return goalJob(id, (x) => ({ ...x, on: placed, step: "done" }));
  // “Up 20%” with nothing to apply it to: theirs, and only where it stands is missing.
  if (said?.move) return goalJob(id, (x) => ({ ...x, on: placed, step: "suggested", suggestion: { target: null, move: said.move, why: "", others: [] } }));
  goalJob(id, (x) => ({ ...x, on: placed, step: "suggesting" }));
  const ctrl = begin(id);
  try {
    const r = await suggestGoalNumber({ goal: on.title, ...(on.goal ? { goalId: on.goal } : {}), metric, now, problem: j.title, others: on.others ?? [] }, step(id), ctrl.signal);
    goalJob(id, (x) => ({ ...x, step: "suggested", suggestion: r.suggestion }));
  } catch (e) {
    const stopped = (e as Error).name === "AbortError" || ctrl.signal.aborted;
    goalJob(id, (x) => ({ ...x, step: "suggested", suggestion: null, error: stopped ? undefined : message(e) }));
  } finally {
    end(id);
  }
}

/** The number they chose, suggested or their own, as the goal's target (none: it stays without one). */
export function settleNumber(id: string, target: number | null, timeframe?: string) {
  const on = goalForOf(id)?.on;
  if (!on) return;
  if (target !== null && studio().doc.nodes[on.card]) writeNumber(on.card, { target, ...(timeframe ? { timeframe } : {}) });
  goalJob(id, (x) => ({ ...x, step: "done" }));
}

// ---------------------------------------------------------------------------
// A file for a card ("Add a file for it", the card's next steps)

const cardTitle = (id: string) => {
  const n = studio().doc.nodes[id];
  return isOstCard(n) ? n.meta.ost.title.trim() : "";
};

/**
 * Files added for a card. What customers said in their own words (an interview, who said what) is
 * read as their quotes and mapped under the card, as before; any other file is read in the chat
 * against the card, as a brain dump of the file's words: what Qalam AI took from it and its
 * questions, then what bears on the card proposed under it. Or, when nothing in it does, the kind
 * of file that would help.
 */
export async function fileFor(card: string, files: readonly File[]) {
  if (!files.length || !studio().doc.nodes[card]) return;
  toggleChat(true);
  const read: { file: File; ing?: Ingested; error?: string }[] = await Promise.all(files.map((file) => ingestFile(file).then((ing) => ({ file, ing }), (e: unknown) => ({ file, error: message(e) }))));
  const customers = read.filter((x) => x.ing && guessVoice({ kind: x.ing.kind, text: x.ing.text, title: x.ing.title }) === "customers");
  if (customers.length) {
    void addSources(customers.map((x) => ({ kind: "read" as const, ingested: x.ing! })), { under: card });
    for (const x of customers) sourceCame(x.ing!.title);
  }
  const title = cardTitle(card);
  for (const x of read) {
    if (customers.includes(x)) continue;
    const name = x.ing?.title || x.file.name;
    const said = title ? `A file for “${title}”` : "A file for this card";
    const docs: ChatDoc[] = [{ from: "computer", title: name, at: new Date(x.file.lastModified).toISOString(), ...(x.ing?.pages?.length ? { pages: x.ing.pages.length } : {}), voice: "own" }];
    const source = newId();
    const id = addTurn(said, { kind: "dump", source, file: { card, title: name } }, docs);
    try {
      if (!x.ing) throw new Error(x.error ?? "It couldn't be read.");
      await startDump(x.ing.text, { id: source, file: { title: name, card } });
      sourceCame(name);
    } catch (e) {
      change((c) => withJob(c, id, (j) => (j.kind === "dump" ? { ...j, error: message(e) } : j)));
    }
  }
}

/** A file read for a card, left out: its source goes (nothing rests on it yet). */
export async function leaveFile(id: string) {
  const j = turnOf(id)?.job;
  if (j?.kind !== "dump" || !j.file) return;
  stopTurn(id);
  change((c) => withJob(c, id, (x) => (x.kind === "dump" && x.file ? { ...x, file: { ...x.file, left: true } } : x)));
  await orgFetch(`/sources/${encodeURIComponent(j.source)}`, { method: "DELETE" }).then(
    () => useSources.setState((st) => ({ list: st.list.filter((x) => x.id !== j.source) })),
    () => {},
  );
}

/** Another file in place of one that doesn't bear on its card. */
export async function anotherFile(id: string, files: readonly File[]) {
  const j = turnOf(id)?.job;
  if (j?.kind !== "dump" || !j.file || !files.length) return;
  const card = j.file.card;
  await leaveFile(id);
  await fileFor(card, files);
}

/** A turn taken out of the chat (what it made stays where it is). */
export function dropTurn(id: string) {
  stopTurn(id);
  change((c) => ({ ...c, turns: c.turns.filter((t) => t.id !== id) }));
}

// ---------------------------------------------------------------------------
// Writing it on the canvas

/** Their words as a goal or a problem: Qalam AI's wording first, for them to use, edit or leave (no engine: their words, at once). */
async function addCard(at: string | null, said: string, what: "goal" | "problem") {
  const kind = what === "goal" ? "outcome" : "opportunity";
  const under = placeFor(kind);
  if (!(await aiStatus()).ai) return void jobAt(at, said, { kind: "add", what, card: writeCard(kind, { title: titleFrom(said), under }), under });
  const id = jobAt(at, said, { kind: "add", what, card: "", under, state: "suggesting" });
  const n = under ? studio().doc.nodes[under] : undefined;
  const above = isOstCard(n) ? n.meta.ost.title : null;
  const r = await orgJson<{ statement: { statement: string; why: string } | null }>("/statement", { method: "POST", json: { what, said, above } }).catch(() => ({ statement: null }));
  change((c) => withJob(c, id, (j) => (j.kind === "add" && j.state === "suggesting" ? { ...j, state: "suggested", ...(r.statement ? { suggestion: r.statement.statement, why: r.statement.why } : {}) } : j)));
}

/**
 * The card written in the words they chose (Qalam AI's, edited or not, or their own), under where
 * it was to go; their own words stay on it as a note when the title isn't them.
 */
export function placeStatement(id: string, title: string) {
  const t = turnOf(id);
  if (t?.job.kind !== "add" || t.job.state !== "suggested") return;
  const j = t.job;
  const kind = j.what === "goal" ? "outcome" : "opportunity";
  const words = title.replace(/\s+/g, " ").trim() || titleFrom(t.said);
  const under = j.under && studio().doc.nodes[j.under] ? j.under : placeFor(kind);
  const theirs = titleFrom(t.said);
  const card = writeCard(kind, { title: words, under, ...(words !== theirs ? { evidence: [{ id: newId(), kind: "note", text: t.said.slice(0, 1200), addedBy: "user", at: Date.now() }] } : {}) });
  change((c) => withJob(c, id, () => ({ kind: "add", what: j.what, card, under })));
}

// ---------------------------------------------------------------------------
// Taking in what customers said

/**
 * Material taken in as the organization's sources (server/capture.ts): each doc, read for what it
 * states, and what they pasted when it reads as who said what. A doc they said is their own, and long
 * text that came with it, are kept as their thinking (read as what they believe). A doc nobody said
 * anything about that holds only their thinking goes on to a brain dump: its pushback and rounds.
 */
async function takeIn(at: string | null, said: string, docs: readonly TakeDoc[]) {
  const id = jobAt(at, said, { kind: "take", state: "taking", sources: [], pages: [], quotes: 0 }, docs.map(docRef));
  const ctrl = begin(id);
  const parts: { ing: () => Promise<Ingested>; own: boolean; basis?: Basis; doc?: SentDoc; title: string; picture?: true }[] = [];
  const voice = said ? guessVoice({ text: said, title: "" }) : "own";
  if (said && (voice === "customers" || wordsIn(said) >= DUMP_WORDS)) parts.push({ ing: () => ingestPaste(said), own: voice !== "customers", title: "Your words" });
  for (const d of docs) {
    // A picture kept in the project before it could be read (the start page's box): read now.
    if (d.asset) parts.push({ ing: () => import("../../discovery/ingest").then((m) => m.readHeldImage(d.asset!.hash, d.title, { onStep: step(id), signal: ctrl.signal })), own: false, title: d.title, picture: true });
    else if (d.ingested) parts.push({ ing: async () => d.ingested!, own: d.basis === "own", ...(d.basis ? { basis: d.basis } : {}), doc: d as SentDoc, title: d.title });
  }
  const sources: string[] = [];
  const taken: TakenDoc[] = [];
  const held: SentDoc[] = [];
  const left: { title: string; why: string }[] = [];
  const pages = new Map<string, FiledPage>();
  let quotes = 0;
  try {
    for (const p of parts) {
      // One that can't be read or kept is said so, and the rest go on.
      let ing: Ingested;
      try {
        ing = await p.ing();
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        left.push({ title: p.title, why: message(e) });
        change((c) => withJob(c, id, (j) => (j.kind === "take" ? { ...j, left: [...left] } : j)));
        continue;
      }
      sourceCame(ing.title);
      const r = await captureIngested(ing, { product: st().space, own: p.own, ...(p.basis ? { basis: p.basis } : {}), holdOwn: !!p.doc && !p.basis, proposeGoals: !!p.doc, onActivity: step(id), signal: ctrl.signal });
      if (r.heldOwn) {
        held.push(p.doc!);
        continue;
      }
      sources.push(r.sourceId);
      quotes += r.quotes;
      taken.push({ source: r.sourceId, title: r.title, ...(r.about ? { about: r.about } : {}), points: r.points ?? {}, ...(p.basis ? { basis: p.basis } : {}), ...numbersOf(r), ...(r.foundGoals?.length ? { found: r.foundGoals } : {}), ...(r.pictures ? { pictures: r.pictures } : {}), ...(ing.image ? { image: ing.image.asset } : {}) });
      for (const f of r.filed?.pages ?? []) if (f.kind === "need") pages.set(f.id, { id: f.id, title: f.title });
      change((c) => withJob(c, id, (j) => (j.kind === "take" ? { ...j, sources: [...sources], pages: [...pages.values()], quotes, docs: [...taken] } : j)));
    }
    change((c) => withJob(c, id, (j) => (j.kind === "take" ? (left.length && !sources.length && !held.length ? { ...j, state: "failed", error: "Nothing could be taken in." } : { ...j, state: "done" }) : j)));
  } catch (e) {
    const stopped = (e as Error).name === "AbortError";
    change((c) => withJob(c, id, (j) => (j.kind === "take" ? { ...j, state: "failed", error: stopped ? `You stopped it${sources.length ? `, after keeping ${sources.length}` : ""}.` : `It couldn't be taken in: ${message(e)}` } : j)));
  } finally {
    end(id);
  }
  // What reads as their own thinking gets a brain dump's conversation: in this turn when it's all there was.
  for (const [i, d] of held.entries()) void dumpIt(i === 0 && !taken.length ? id : null, i === 0 && !taken.length ? said : `“${d.title}”`, [d], true);
}

/** The numbers a document measured for goals, by the goals' words (a goal since gone is left out). */
function numbersOf(r: { goalNumbers?: { goal: string; value: number }[] }): { numbers?: NonNullable<TakenDoc["numbers"]> } {
  const numbers = (r.goalNumbers ?? []).flatMap((n) => {
    const g = goalById(goalsNow(), n.goal);
    return g ? [{ goal: n.goal, title: g.title, value: n.value }] : [];
  });
  return numbers.length ? { numbers } : {};
}

/** A number a document measured, taken as its goal's: as a read from a tool is, so it isn't a decision. */
export async function takeGoalNumber(turn: string, doc: TakenDoc, n: NonNullable<TakenDoc["numbers"]>[number]) {
  const g = goalById(goalsNow(), n.goal);
  if (!g?.metric) return;
  await changeGoal(n.goal, { metric: { ...g.metric, current: n.value, source: { connector: "document", ref: doc.source, label: doc.title }, readAt: Date.now() } });
  change((c) => withJob(c, turn, (j) => (j.kind === "take" && j.docs ? { ...j, docs: j.docs.map((d) => (d.source === doc.source ? { ...d, numbers: d.numbers?.map((x) => (x.goal === n.goal ? { ...x, used: true as const } : x)) } : d)) } : j)));
}

/** A goal a document pointed to, accepted (it goes on the canvas, its problems under it) or left out. */
export async function decideDocGoal(turn: string, source: string, found: string, accept: boolean) {
  const r = await decideFoundGoal(source, found, accept);
  change((c) => withJob(c, turn, (j) => (j.kind === "take" && j.docs ? { ...j, docs: j.docs.map((d) => (d.source === source ? { ...d, found: d.found?.map((g) => (g.id === found ? { ...g, state: accept ? ("accepted" as const) : ("left" as const), ...(r.goal ? { goal: r.goal } : {}) } : g)) } : d)) } : j)));
}

/** What a document they took in rests on, as they say: its points go by that, and the page lines citing them move. */
export async function changeDocBasis(turn: string, source: string, basis: Basis) {
  await setSourceBasis(source, basis);
  change((c) =>
    withJob(c, turn, (j) => {
      if (j.kind !== "take" || !j.docs) return j;
      return { ...j, docs: j.docs.map((d) => { if (d.source !== source) return d; const n = Object.values(d.points).reduce((a, b) => a + (b ?? 0), 0); return { ...d, basis, points: n ? { [basis]: n } : {} }; }) };
    }),
  );
}

/** A doc that read as their own thinking, taken in as what they say it is instead: the brain dump stops, its source goes. */
export async function takeAsBasis(id: string, basis: Basis) {
  const t = turnOf(id);
  if (t?.job.kind !== "dump" || !t.job.asOwn) return;
  const { source, asOwn } = t.job;
  const text = sourceOf(source)?.text;
  if (!text) return;
  stopTurn(id);
  await orgFetch(`/sources/${encodeURIComponent(source)}`, { method: "DELETE" }).then(
    () => useSources.setState((st) => ({ list: st.list.filter((x) => x.id !== source) })),
    () => {},
  );
  const doc = { key: source, from: "computer", via: "this computer", title: asOwn.title, state: "ready", basis, ingested: { kind: "text", title: asOwn.title, text } } as SentDoc;
  await takeIn(id, t.said, [doc]);
}

/** What they're looking at on the canvas, for Qalam AI to hear: the card picked, else the page open, in its own words. */
export function aboutNow(): string | null {
  const s = studio();
  const doc = s.doc;
  const card = (id: string | undefined) => {
    const c = id && isOstCard(doc.nodes[id]) ? doc.nodes[id].meta.ost : undefined;
    return c?.title.trim() ? `${KIND_LABEL[c.kind]}: ${c.title.trim()}` : null;
  };
  if (s.selection.length === 1) {
    const picked = card(s.selection[0]);
    if (picked) return picked;
  }
  const open = pageOf(window.location.search);
  if (!open) return null;
  const shown = card(cardForPage(open.ref, useSpaceView.getState().things));
  if (shown) return `${shown} (its page is open)`;
  const g = "goal" in open.ref ? goalById(goalsNow(), open.ref.goal) : undefined;
  return g ? `Goal: ${g.title} (its page is open)` : null;
}

// ---------------------------------------------------------------------------
// Look in your tools: every connected tool searched for it at once (src/connectors/everywhere.ts)

const setTools = (id: string, fn: (j: ToolsJob) => ToolsJob) => change((c) => withJob(c, id, (j) => (j.kind === "tools" ? fn(j) : j)));

/** A card's words, as a look hears what to find: its title, and the start of what it says. */
function cardWords(id: string): string {
  const n = studio().doc.nodes[id];
  if (!isOstCard(n)) return "";
  const c = n.meta.ost;
  const more = c.description?.replace(/\s+/g, " ").trim().slice(0, 300);
  return [c.title.trim(), more].filter(Boolean).join("\n");
}

/**
 * A look across every connected tool, in the thread: each tool's searcher as it goes, then what they
 * found for them to tick (Qalam AI's picks ticked). Nothing is taken in until they bring it in. `card`:
 * a card's look, its finds placed only under it; `from`: the question it looks further for; `typed`:
 * their own words, sent with the box set to look.
 */
export async function lookInTools(at: string | null, about: string, o: { card?: string; from?: string; typed?: boolean; lookup?: ToolsJob["lookup"] } = {}): Promise<string | null> {
  // A card's look hears its words, unless something more particular is asked (an interview's lookup).
  const words = (about.trim() || (o.card ? cardWords(o.card) : "")).replace(/[ \t]+/g, " ").trim();
  if (words.length < 3) return null;
  toggleChat(true);
  const card = o.card ? { id: o.card, title: cardTitle(o.card) || words } : undefined;
  const board = card ? boardOfCard(card.id) : null;
  // A card whose board isn't made yet: its finds are kept and filed, and placed nowhere.
  const scope = card ? (board ? { [board]: [card.id] } : {}) : undefined;
  const said = o.typed ? words : `Look in your tools for “${about.trim() || card?.title || words}”`;
  const job: ToolsJob = { kind: "tools", about: words, state: "looking", runs: [], ...(card ? { card } : {}), ...(scope ? { scope } : {}), ...(o.from ? { from: o.from } : {}), ...(o.lookup ? { lookup: o.lookup } : {}) };
  const id = jobAt(at, said, job);
  if (await engineMissing()) {
    jobAt(id, said, { kind: "noEngine", mode: "tools" });
    return id;
  }
  const ctrl = begin(id);
  const started = Date.now();
  try {
    const r = await everywhereDb.look(words, {
      signal: ctrl.signal,
      // Each tool's searcher as it goes, in the order the look started them.
      onRun: (run) => setTools(id, (j) => ({ ...j, runs: j.runs.some((x) => x.tool === run.tool) ? j.runs.map((x) => (x.tool === run.tool ? run : x)) : [...j.runs, run] })),
    });
    setTools(id, (j) => ({ ...j, state: "found", runs: r.runs, found: r.candidates, ticked: r.candidates.filter((c) => c.picked && !c.inSources).map((c) => c.key), secs: Math.round((Date.now() - started) / 1000) }));
  } catch (e) {
    const stopped = (e as Error).name === "AbortError" || ctrl.signal.aborted;
    setTools(id, (j) => ({ ...j, state: "failed", error: stopped ? "You stopped it." : message(e) }));
  } finally {
    end(id);
  }
  return id;
}

/** A card's look, from its next steps: in the chat, its finds placed only under it. */
export const lookInToolsFor = (card: string) => void lookInTools(null, "", { card });

/** Until a look's ticked ones are brought in, it's left, it fails, or it found nothing new to bring in (rejected when the interview stops waiting). */
function settledTools(id: string, signal: AbortSignal): Promise<ToolsJob> {
  return new Promise((resolve, reject) => {
    let unsub = () => {};
    const off = () => {
      unsub();
      signal.removeEventListener("abort", stop);
    };
    const stop = () => {
      off();
      reject(new DOMException("Stopped", "AbortError"));
    };
    const check = () => {
      const j = turnOf(id)?.job;
      if (j?.kind !== "tools") return (off(), reject(new Error("The look in your tools went away.")));
      // Nothing they could bring in (none found, or all of it a source already): nothing to wait for.
      const nothingNew = j.state === "found" && !(j.found ?? []).some((c) => !c.inSources);
      if (j.state === "brought" || j.state === "left" || j.state === "failed" || nothingNew) {
        off();
        resolve(j);
      }
    };
    unsub = useCanvasChat.subscribe(check);
    signal.addEventListener("abort", stop, { once: true });
    check();
  });
}

/** Whose words a source's point holds, as an interview's lookups say it. */
const WHOSE_IS: Record<string, string> = { said: "people said", measured: "measured", studied: "studied", read: "read elsewhere", own: "the team's" };

/**
 * A look in their tools an interview asked for and they said yes to: it runs in the chat, where they
 * tick what to bring in. It lands with the points of what they brought in, each under its own piece, so
 * the next turn reads them and a draft may rest on them; nothing brought in, nothing found.
 */
async function toolsLookup(l: Pick<Lookup, "id" | "query">, signal: AbortSignal, o: { turn: string; card?: string }): Promise<{ lines: FoundLine[] }> {
  const id = await lookInTools(null, l.query, { ...(o.card ? { card: o.card } : {}), lookup: { turn: o.turn, id: l.id } });
  if (!id) return { lines: [] };
  const j = await settledTools(id, signal);
  if (j.state === "failed") throw new Error(j.error ?? "The look in your tools failed.");
  const sources = j.state === "brought" ? (j.brought?.sources ?? []) : [];
  const read = await Promise.all(sources.map((s) => sourcesDb.get(s).catch(() => null)));
  const lines = read.flatMap((s) => (s ? s.quotes.map((q) => ({ s, q })) : [])).slice(0, 8);
  return { lines: lines.map(({ s, q }, i): FoundLine => ({ ref: `${l.id}-${i + 1}`, text: q.text, from: s.title, whose: WHOSE_IS[basisOf(s, q)] ?? "people said", piece: quotePiece(q.id) })) };
}

/** One found item ticked or not. */
export function tickFound(id: string, key: string, on: boolean) {
  setTools(id, (j) => ({ ...j, ticked: on ? [...new Set([...(j.ticked ?? []), key])] : (j.ticked ?? []).filter((k) => k !== key) }));
}

/**
 * The ticked ones taken in, tool by tool, as the canvas's product's (a card's look: only under the
 * card). It goes on in the core to its end, whatever the window does, so it has no Stop.
 */
export async function bringFound(id: string): Promise<void> {
  const j = turnOf(id)?.job;
  if (j?.kind !== "tools" || j.state !== "found") return;
  const ticked = new Set(j.ticked ?? []);
  const picks = (j.found ?? []).filter((c) => ticked.has(c.key) && !c.inSources).map((c) => ({ tool: c.tool, hit: c.hit }));
  if (!picks.length) return;
  setTools(id, (x) => ({ ...x, state: "bringing" }));
  begin(id);
  step(id)(`Taking in ${picks.length === 1 ? `“${picks[0].hit.title}”` : `${picks.length} items`}`);
  await saveNow();
  try {
    const r = await everywhereDb.bring(picks, { ...(j.scope ? { scope: j.scope } : {}), product: st().space, onActivity: step(id) });
    for (const t of r.added) sourceCame(t);
    setTools(id, (x) => ({ ...x, state: "brought", brought: { added: r.added, skipped: r.skipped, failed: r.failed, sources: r.sources ?? [], pages: r.pages ?? [] } }));
  } catch (e) {
    setTools(id, (x) => ({ ...x, state: "failed", error: `They couldn't be taken in: ${message(e)}` }));
  } finally {
    end(id);
  }
}

/** None taken: nothing came in. */
export const leaveFound = (id: string) => setTools(id, (j) => (j.state === "found" ? { ...j, state: "left" } : j));

/** The same look again, in its turn. */
export function lookAgain(id: string) {
  const j = turnOf(id)?.job;
  if (j?.kind !== "tools") return;
  const t = turnOf(id)!;
  void lookInTools(id, j.about, { ...(j.card ? { card: j.card.id } : {}), ...(j.from ? { from: j.from } : {}), typed: t.said === j.about });
}

// ---------------------------------------------------------------------------
// Ask

/** A question for the organization, answered in the thread (the answer is kept with it); `at`: a turn asked instead. */
export async function ask(question: string, at: string | null = null): Promise<void> {
  const q = question.replace(/\s+/g, " ").trim();
  if (q.length < 3) return;
  const id = jobAt(at, q, { kind: "ask", state: "asking" });
  if (!(await aiStatus()).ai) return change((c) => withJob(c, id, () => ({ kind: "ask", state: "failed", error: "Qalam AI isn't set up here. Connections says how." })));
  const ctrl = begin(id);
  const started = Date.now();
  try {
    const answer = await askOrganization(q, { product: st().space, about: aboutNow(), signal: ctrl.signal, onActivity: step(id) });
    change((c) => withJob(c, id, () => ({ kind: "ask", state: "answered", answer, secs: Math.round((Date.now() - started) / 1000) })));
  } catch (e) {
    const stopped = (e as Error).name === "AbortError";
    change((c) => withJob(c, id, () => ({ kind: "ask", state: "failed", error: stopped ? "You stopped it." : message(e) })));
  } finally {
    end(id);
  }
}

/** Stop what a turn is running (a brain dump's call too). */
export function stopTurn(id: string) {
  ctrls.get(id)?.abort();
  const j = turnOf(id)?.job;
  if (j?.kind === "plan") stopLookups(id);
  if (j?.kind === "dump" && useDump.getState().busy?.sourceId === j.source) stopDump(j.source);
  if (j?.kind === "scan" && (!j.session || j.session.state === "reading")) void stopScan().catch(() => {});
}
