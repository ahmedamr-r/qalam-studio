import { create } from "zustand";
import { setMe, setMine, useGoals } from "@/goals/client";
import { codeDb } from "@/org/code";
import { connectorsDb, type ConnectorState } from "@/org/connectors";
import { createOrg, currentOrg, type OrgRef } from "@/org/client";
import { orgShape, type OrgShape } from "@/org/words";
import { engineDb, type EngineKind, type EngineTest, type EngineView } from "@/org/engine";
import { isKeyed } from "@/ai/engine-kinds";
import { chooseVoice, loadVoice } from "@/org/voice";
import { loadYou, setYourName, type Me } from "@/org/you";
import { voiceSettled, type VoiceChoice } from "@/voice/model";
import { firstRunDb } from "@/org/first-run";
import { setupHref } from "@/projects/model";
import type { FoundGoal } from "@/goals/found";
import { captureIngested, decideFoundGoal } from "@/org/capture";
import { ingestPaste, ingestUrl } from "../discovery/ingest";
import { docRef, type DocRef, type SentDoc } from "../chat/attach";
import type { ProblemPart } from "./canvas";
import { isAddress } from "./thread";
import { openKnow, useKnow } from "../setup/know";
import { openSetup, useSetup } from "../setup/setup";
import { changesThings, setupStep, stepAfter, welcomeMode, type SetupStep, type WelcomeMode } from "../welcome/steps";
import { engineShown, lab } from "@/lab";
import { loadMarket, lookForCompetitors, lookUpCompany, settleCompany, settleCompetitors, useMarket } from "@/org/market";
import { loadOrgContext } from "@/org/context";
import { orgFetch } from "@/org/client";
import { orgHref } from "@/projects/model";
import { handWords } from "../space/handoff";
import { projectName, scanInput } from "@/scan/input";

/*
 * The first run as state, apart from the pages that show it: Qalam AI found and tested, the
 * organization named (the welcome), then on the setup page who they are, the way into its goals (a
 * door), which goals are theirs, and what to connect. The goals themselves are the setup's (../setup/setup.ts)
 * and the know door's (../setup/know.ts). The step and the door are in the address, so a reload
 * and Back come back to them.
 */

export type Door = "know" | "find" | "problems" | "idea";

/** What one part of what was sent at the problems door became: its source, and the problem pages it was filed into. */
export type ProblemSource = ProblemPart;
const DOORS: readonly Door[] = ["know", "find", "problems", "idea"];

export interface FirstRun {
  route: "welcome" | "setup";
  mode: WelcomeMode;
  /** The setup page as the first run's last three steps (?first=1). */
  first: boolean;
  org: OrgRef | null;
  /** A company or team, or just them: picked on the welcome before the name (`?for=`), then the organization's. */
  shape: OrgShape | null;
  engine: { view: EngineView | null; test: EngineTest | null; checking: boolean; error: string | null; keyOpen: boolean; skipped: boolean };
  naming: { name: string | null; busy: boolean; error: string | null };
  step: SetupStep;
  door: Door | null;
  /** The setup page has found what it shows. */
  opened: boolean;
  /** The goals they pick as theirs (null: not touched, so the ones kept already). */
  picked: string[] | null;
  /** What's connected, for the Connect step and the So far panel. */
  tools: ConnectorState[] | null;
  /** Who this Mac's GitHub CLI is (or Qalam's own sign-in); null: neither. */
  gh: string | null | undefined;
  /** The problems door: what they sent (words and docs), and what was filed from it (for this tab): the problem pages it went into. */
  problems: { sent: string | null; docs?: DocRef[]; result: { pages: number; quotes: number; needs?: { id: string; title: string }[] } | null; error: string | null; found?: { source: string; goal: FoundGoal }[]; sources?: ProblemSource[] };
  /** What a door is doing while it reads or makes something. */
  working: { label: string } | null;
  /** They asked to set it up properly, not through the one box. */
  full?: boolean;
  /** They said there's no website yet: the company step asks for a line about it instead (this tab). */
  noSite: boolean;
  /** Competitors they added by name while checking the ones found (this tab). */
  rivalsAdded: string[];
}

export const useFirstRun = create<FirstRun>(() => ({
  route: "welcome",
  mode: "first",
  first: true,
  org: null,
  shape: null,
  engine: { view: null, test: null, checking: false, error: null, keyOpen: false, skipped: false },
  naming: { name: null, busy: false, error: null },
  step: "goals",
  door: null,
  opened: false,
  picked: null,
  tools: null,
  gh: undefined,
  problems: { sent: null, result: null, error: null },
  working: null,
  noSite: false,
  rivalsAdded: [],
}));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const setEngine = (patch: Partial<FirstRun["engine"]>) => useFirstRun.setState((s) => ({ engine: { ...s.engine, ...patch } }));

/** Qalam AI is ready, or they left it for later. */
export const engineDone = (s: FirstRun) => !!s.engine.test?.ok || s.engine.skipped;

// ---------------------------------------------------------------------------
// The welcome

const shapeIn = (search: string) => orgShape(new URLSearchParams(search).get("for"));

export function startWelcome(search: string) {
  const fullIn = (q: string) => new URLSearchParams(q).has("full") || !!orgShape(new URLSearchParams(q).get("for"));
  useFirstRun.setState({ route: "welcome", mode: welcomeMode(search), shape: shapeIn(search), full: fullIn(search) });
  void checkEngine();
  window.addEventListener("popstate", () => useFirstRun.setState({ shape: shapeIn(window.location.search), full: fullIn(window.location.search) }));
}

/** Who it's for, before its name (in the address, so Back takes it back). */
export function pickShape(shape: OrgShape) {
  push({ for: shape });
  useFirstRun.setState({ shape });
}

/** Which engine the welcome picks when the live one has no key: Claude Code signed in, then a key kept here, then a model on this computer. */
const FIRST_CHOICE: EngineKind[] = ["cli", "codex", "api", "openai", "gemini", "openrouter", "ollama", "lmstudio"];

/** How long an engine's passed test counts for a new organization on the same computer. */
const RECENT = 60 * 60 * 1000;

/** What this computer has, tested with a short real call: an engine reached with a key that has none gives way to the first that's ready. */
export async function checkEngine() {
  const { mode } = useFirstRun.getState();
  setEngine({ checking: true, error: null });
  try {
    let v = await engineDb.view();
    const stateOf = (k: EngineKind) => (k === "cli" ? (v.claude.found && v.claude.signedIn ? "ready" : null) : (v.options?.find((o) => o.kind === k)?.state ?? null));
    if (changesThings(mode) && isKeyed(v.kind) && !v.key) {
      const next = FIRST_CHOICE.find((k) => k !== v.kind && engineShown(k) && stateOf(k) === "ready");
      if (next) v = await engineDb.choose(next);
    }
    setEngine({ view: v });
    // Another organization on a computer whose engine answered in the last hour: that answer stands.
    if (mode === "new" && v.test?.ok && Date.now() - v.test.at < RECENT) return void setEngine({ test: v.test });
    const testable = v.kind === "cli" ? v.claude.found && v.claude.signedIn !== false : stateOf(v.kind) === "ready" || (v.kind === "api" && !!v.key);
    setEngine({ test: testable ? await engineDb.test() : null });
  } catch (e) {
    setEngine({ error: message(e) });
  } finally {
    setEngine({ checking: false });
  }
}

export const skipEngine = () => setEngine({ skipped: true, keyOpen: false });
export const openKeyField = (keyOpen: boolean) => setEngine({ keyOpen });

/** Another engine was picked, a key kept (tested first) or a model chosen: once it's ready, check again with it. */
export async function engineChanged(view: EngineView) {
  setEngine({ view, test: null });
  if (!view.ready) return;
  setEngine({ keyOpen: false });
  await checkEngine();
}

/** They'd rather set it up properly: who it's for, its name and the steps after (in the address, so Back returns to the box). */
export function setUpProperly() {
  push({ full: "1" });
  useFirstRun.setState({ full: true });
}

/** The one box: a project named from their words, and on to its canvas, whose chat reads what people complain about. */
export async function startFromBox(said: string): Promise<boolean> {
  const target = scanInput(said);
  if (!target) return false;
  useFirstRun.setState({ naming: { name: said, busy: true, error: null } });
  try {
    const org = await createOrg(projectName(target), "solo");
    handWords(said);
    // The steps it skipped aren't left to pick up: the box is the first run.
    await fetch(`/api/org/${encodeURIComponent(org.id)}/first-run`, { method: "POST" }).catch(() => {});
    window.location.assign(`${orgHref(org.id)}?scan=1`);
    return true;
  } catch (e) {
    useFirstRun.setState({ naming: { name: null, busy: false, error: message(e) } });
    return false;
  }
}

/** The organization's name: a folder in ~/Qalam, then on to who they are there (the setup page). */
export async function nameOrg(name: string): Promise<boolean> {
  useFirstRun.setState({ naming: { name, busy: true, error: null } });
  try {
    const shape = useFirstRun.getState().shape;
    const org = await createOrg(name, shape ?? undefined);
    window.location.assign(`${setupHref(org.id)}?first=1&step=${await nextAsked("name", shape)}`);
    return true;
  } catch (e) {
    useFirstRun.setState({ naming: { name: null, busy: false, error: message(e) } });
    return false;
  }
}

// ---------------------------------------------------------------------------
// The setup page: goals, then which are theirs, then what to connect

/** Where the address says the setup page is: its step and its door. */
function fromAddress(search: string) {
  const q = new URLSearchParams(search);
  const door = q.get("door");
  return { step: setupStep(search), door: DOORS.includes(door as Door) ? (door as Door) : null, source: q.get("source") };
}

export async function startSetupPage(search: string) {
  const at = fromAddress(search);
  const first = new URLSearchParams(search).get("first") === "1";
  useFirstRun.setState({ route: "setup", first, step: at.step, door: at.door });
  const org = await currentOrg().catch(() => null);
  useFirstRun.setState({ org, shape: org?.shape ?? null });
  if (org) openKnow(org.id);
  void loadMarket();
  void loadYou().catch(() => {});
  void loadVoice();
  // The engine as it was last tested here: never a new call just to show it.
  void engineDb.view().then((view) => setEngine({ view, test: view.test }), () => {});
  // A setup named in the address wins; then the know door; then the latest one not finished.
  if (at.source) await openSetup(at.source);
  else if (!at.door || at.door === "find") await openSetup(null);
  const kept = useSetup.getState().source;
  const door = at.door === "problems" || at.door === "idea" ? at.door : kept ? (kept.setup?.idea ? "idea" : "find") : (at.door ?? (useKnow.getState().sent ? "know" : null));
  useFirstRun.setState({ door, opened: true });
  // The canvas draws the tools connected here from the start (cheap: no Claude Code check).
  if (at.step === "connect") void loadConnect();
  // Connectors are hidden in v0.1 (src/lab.ts): no tool tiles.
  else if (lab("connectors")) void connectorsDb.list().then((v) => useFirstRun.setState({ tools: v.connectors }), () => {});
  window.addEventListener("popstate", () => {
    const now = fromAddress(window.location.search);
    useFirstRun.setState({ step: now.step, ...(now.door ? { door: now.door } : {}) });
    if (now.step === "connect") void loadConnect();
  });
}

function push(patch: Record<string, string>) {
  const u = new URL(window.location.href);
  for (const [k, v] of Object.entries(patch)) u.searchParams.set(k, v);
  history.pushState(null, "", u);
}


export function pickDoor(door: Door) {
  push({ door });
  useFirstRun.setState({ door, problems: { sent: null, result: null, error: null } });
}

/**
 * The problems door: what customers said (pasted, or a page, and each doc that came with it) is
 * kept, read and filed into problem pages like anything added to the organization
 * (server/capture.ts); then what comes up most.
 */
export async function sendProblems(text: string, docs: SentDoc[] = []) {
  const working = (label: string) => useFirstRun.setState({ working: { label } });
  const words = text.trim();
  useFirstRun.setState({ problems: { sent: words, ...(docs.length ? { docs: docs.map(docRef) } : {}), result: null, error: null } });
  working("Reading what you sent");
  try {
    const typed = words ? [isAddress(words) ? await ingestUrl(words) : await ingestPaste(text)] : [];
    const all = [...typed.map((ing) => ({ ing, doc: isAddress(words) ? { from: "page", title: ing.title, ...(ing.origin ? { origin: ing.origin } : {}) } : { from: "said", title: "Your words" } })), ...docs.map((d) => ({ ing: d.ingested, doc: docRef(d) }))];
    let quotes = 0;
    const found: { source: string; goal: FoundGoal }[] = [];
    const needs = new Map<string, { id: string; title: string }>();
    // Every part shows on the canvas at once, each filled in as it's taken in.
    const sources: ProblemSource[] = all.map(({ doc }) => ({ doc, sourceId: "", pages: [] }));
    useFirstRun.setState((s) => ({ problems: { ...s.problems, sources: [...sources] } }));
    for (const [i, { ing, doc }] of all.entries()) {
      const r = await captureIngested(ing, { proposeGoals: true, onActivity: working });
      found.push(...(r.foundGoals ?? []).map((goal) => ({ source: r.sourceId, goal })));
      quotes += r.quotes;
      const pages = (r.filed?.pages ?? []).filter((p) => p.kind === "need").map(({ id, title }) => ({ id, title }));
      for (const p of pages) needs.set(p.id, p);
      sources[i] = { doc, sourceId: r.sourceId, pages };
      useFirstRun.setState((s) => ({ problems: { ...s.problems, sources: [...sources] } }));
    }
    useFirstRun.setState((s) => ({ problems: { ...s.problems, result: { pages: needs.size, quotes, needs: [...needs.values()] }, found } }));
  } catch (e) {
    useFirstRun.setState((s) => ({ problems: { ...s.problems, error: `Qalam couldn't take it in: ${message(e)}` } }));
  } finally {
    useFirstRun.setState({ working: null });
  }
}

// ---------------------------------------------------------------------------
// The company: what the web says about it, checked with them (src/org/market.ts runs it in the core)

/** A goal what they sent pointed to, accepted (its problems come under it) or left out. */
export async function decideGoal(source: string, id: string, accept: boolean) {
  const r = await decideFoundGoal(source, id, accept);
  useFirstRun.setState((s) => ({ problems: { ...s.problems, found: s.problems.found?.map((f) => (f.goal.id === id ? { ...f, goal: { ...f.goal, state: accept ? ("accepted" as const) : ("left" as const), ...(r.goal ? { goal: r.goal } : {}) } } : f)) } }));
}

/** No website yet: the step asks for a line about it instead. */
export const noWebsite = () => useFirstRun.setState({ noSite: true });

/** Their website, or their line about it (with the website they gave before, if any): looked up in the core. */
export function sendCompany(text: string) {
  const t = text.trim();
  const look = useMarket.getState().session.company;
  // In their words instead of what was found: theirs, kept as it is, with nothing looked up again.
  if (look?.state === "ready" && look.facts.length && useFirstRun.getState().noSite) return keepFacts(look.facts.map((f) => ({ id: f.id, keep: false })), [t]);
  if (isAddress(t)) return lookUpCompany({ site: t });
  return lookUpCompany({ said: t, ...(look?.site && !useFirstRun.getState().noSite ? { site: look.site } : {}) });
}

/** The same look again, after it failed. */
export function lookAgain() {
  const look = useMarket.getState().session.company;
  if (look?.site || look?.said) void lookUpCompany({ ...(look.site ? { site: look.site } : {}), ...(look.said ? { said: look.said } : {}) });
}

/** What they kept, fixed and dropped of the company's facts, then on to the next step. */
export async function keepFacts(decisions: { id: string; keep: boolean; text?: string }[], added: string[] = []) {
  await settleCompany(decisions, added);
  if (useMarket.getState().error) return;
  // The About's empty fields were filled from them: the canvas's About place shows it.
  void loadOrgContext();
  goStep(stepAfter("company", useFirstRun.getState().shape) ?? "goals");
}

// ---------------------------------------------------------------------------
// Competitors: the ones they name, or found, checked with them

/** Names, as typed: "Oilio, Recycly and GreenOil" is three. */
export const namesIn = (t: string) =>
  t
    .split(/\s*(?:,|;|\n|\band\b|&)\s*/i)
    .map((n) => n.trim().replace(/^[-•*]\s*/, ""))
    .filter((n) => n.length > 1 && n.length <= 80)
    .slice(0, 6);

/** The names they gave (looked for), or, while they check what was found, one more of theirs. */
export function sendCompetitors(text: string) {
  const look = useMarket.getState().session.competitors;
  if (look?.state === "ready") {
    const add = namesIn(text).filter((n) => !useFirstRun.getState().rivalsAdded.some((a) => a.toLowerCase() === n.toLowerCase()));
    return void useFirstRun.setState((s) => ({ rivalsAdded: [...s.rivalsAdded, ...add] }));
  }
  useFirstRun.setState({ rivalsAdded: [] });
  return lookForCompetitors(namesIn(text));
}

export const findCompetitors = () => {
  useFirstRun.setState({ rivalsAdded: [] });
  return lookForCompetitors([]);
};

/** The ones they keep, and the ones they added, then on to the start. */
export async function keepCompetitors(keep: string[]) {
  await settleCompetitors(keep, useFirstRun.getState().rivalsAdded);
  if (useMarket.getState().error) return;
  useFirstRun.setState({ rivalsAdded: [] });
  goStep(stepAfter("competitors", useFirstRun.getState().shape) ?? "goals");
}

/** No competitors for now: on to the start. */
export const skipCompetitors = () => goStep(stepAfter("competitors", useFirstRun.getState().shape) ?? "goals");

// ---------------------------------------------------------------------------
// Start: on to the canvas, where its chat helps with a first goal or problem

/** Finish onto the canvas, its chat finding a goal or a problem, open for one they have in mind, or as it is. */
export function startOnCanvas(how: "find-goal" | "find-problem" | "write" | "later") {
  const q = how === "find-goal" ? "?find=goal" : how === "find-problem" ? "?find=problem" : how === "write" ? "?write=1" : "";
  return finishFirstRun(`${orgHref()}${q}`);
}

/**
 * What they sent at the problems door held nothing to go on: their words go to the canvas's chat,
 * taken as a goal or a problem, and the sources kept from it go. Docs sent with no words of theirs
 * stay kept: nothing else holds them.
 */
export async function takeAs(what: "goal" | "problem") {
  const p = useFirstRun.getState().problems;
  if (p.sent) handWords(p.sent);
  if (p.sent) for (const s of p.sources ?? []) if (s.sourceId) await orgFetch(`/sources/${encodeURIComponent(s.sourceId)}`, { method: "DELETE" }).catch(() => {});
  await finishFirstRun(`${orgHref()}?take=${what}`);
}

export function goStep(step: SetupStep) {
  push({ step });
  useFirstRun.setState({ step });
  if (step === "connect") void loadConnect();
}

/** The step after `step` there's something to ask in: Voice only while this Mac hasn't chosen (the goals are always asked). */
async function nextAsked(step: "name" | "you" | "voice", shape: OrgShape | null): Promise<SetupStep> {
  const next = stepAfter(step, shape) ?? "goals";
  return next === "voice" && voiceSettled(await loadVoice()) ? (stepAfter("voice", shape) ?? "goals") : next;
}

/** Their name (this Mac's) and their position here (this organization's, on this computer), then voice if this Mac hasn't chosen, else the goals. */
export async function saveYou(name: string, me: Me): Promise<void> {
  await setYourName(name);
  await setMe(me);
  goStep(await nextAsked("you", useFirstRun.getState().shape));
}

/** How this Mac talks instead of typing, then on to the goals. */
export async function saveVoice(use: VoiceChoice): Promise<void> {
  await chooseVoice(use);
  goStep(stepAfter("voice", useFirstRun.getState().shape) ?? "goals");
}

export function togglePick(id: string, on: boolean) {
  const s = useFirstRun.getState();
  const chosen = new Set(s.picked ?? useGoals.getState().mine);
  if (on) chosen.add(id);
  else chosen.delete(id);
  useFirstRun.setState({ picked: [...chosen] });
}

/** Their goals kept (on this computer), then on to what to connect; the step it went to, null when there's none left (Finish). */
export async function saveYours(order: string[]): Promise<SetupStep | null> {
  const s = useFirstRun.getState();
  const chosen = new Set(s.picked ?? useGoals.getState().mine);
  await setMine(order.filter((id) => chosen.has(id))).catch(() => {});
  useFirstRun.setState({ picked: [...chosen] });
  const next = stepAfter("yours", s.shape);
  if (next) goStep(next);
  return next;
}

/** Finish: the first run is done here (the home stops offering to pick it up), then on to `href`. */
export async function finishFirstRun(href: string) {
  await firstRunDb.finish().catch(() => {});
  window.location.assign(href);
}

export async function loadConnect() {
  void connectorsDb.list().then((v) => useFirstRun.setState({ tools: v.connectors }), () => useFirstRun.setState({ tools: [] }));
  void codeDb.view().then((v) => useFirstRun.setState({ gh: v.gh ?? (v.signedIn ? "Qalam's sign-in" : null) }), () => useFirstRun.setState({ gh: null }));
}
