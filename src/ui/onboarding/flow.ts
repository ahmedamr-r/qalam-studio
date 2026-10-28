import { create } from "zustand";
import { setMine, useGoals } from "@/goals/client";
import { codeDb } from "@/org/code";
import { connectorsDb, type ConnectorState } from "@/org/connectors";
import { createOrg, currentOrg, type OrgRef } from "@/org/client";
import { engineDb, type EngineTest, type EngineView } from "@/org/engine";
import { setupHref } from "@/projects/model";
import { openKnow, useKnow } from "../setup/know";
import { openSetup, useSetup } from "../setup/setup";
import { changesThings, setupStep, welcomeMode, type SetupStep, type WelcomeMode } from "../welcome/steps";

/*
 * The first run as state, apart from the pages that show it: Qalam AI found and tested, the
 * organization named (the welcome), then on the setup page the way into its goals (a door), which
 * goals are theirs, and what to connect. The goals themselves are the setup's (../setup/setup.ts)
 * and the know door's (../setup/know.ts). The step and the door are in the address, so a reload
 * and Back come back to them.
 */

export type Door = "know" | "find";

export interface FirstRun {
  route: "welcome" | "setup";
  mode: WelcomeMode;
  /** The setup page as the first run's last three steps (?first=1). */
  first: boolean;
  org: OrgRef | null;
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
}

export const useFirstRun = create<FirstRun>(() => ({
  route: "welcome",
  mode: "first",
  first: true,
  org: null,
  engine: { view: null, test: null, checking: false, error: null, keyOpen: false, skipped: false },
  naming: { name: null, busy: false, error: null },
  step: "goals",
  door: null,
  opened: false,
  picked: null,
  tools: null,
  gh: undefined,
}));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const setEngine = (patch: Partial<FirstRun["engine"]>) => useFirstRun.setState((s) => ({ engine: { ...s.engine, ...patch } }));

/** Qalam AI is ready, or they left it for later. */
export const engineDone = (s: FirstRun) => !!s.engine.test?.ok || s.engine.skipped;

// ---------------------------------------------------------------------------
// The welcome

export function startWelcome(search: string) {
  useFirstRun.setState({ route: "welcome", mode: welcomeMode(search) });
  void checkEngine();
}

/** What this Mac has, tested with a short real call: Claude Code signed in, with no key set, is used. */
export async function checkEngine() {
  const { mode } = useFirstRun.getState();
  setEngine({ checking: true, error: null });
  try {
    let v = await engineDb.view();
    if (changesThings(mode) && v.kind === "api" && !v.key && v.claude.found && v.claude.signedIn) v = await engineDb.choose("cli");
    setEngine({ view: v });
    const testable = v.kind === "cli" ? v.claude.found && v.claude.signedIn !== false : !!v.key;
    setEngine({ test: testable ? await engineDb.test() : null });
  } catch (e) {
    setEngine({ error: message(e) });
  } finally {
    setEngine({ checking: false });
  }
}

export const skipEngine = () => setEngine({ skipped: true, keyOpen: false });
export const openKeyField = (keyOpen: boolean) => setEngine({ keyOpen });

/** A key was kept (tested first): check again with it. */
export async function keySaved() {
  setEngine({ keyOpen: false });
  await checkEngine();
}

/** The organization's name: a folder in ~/Qalam, then on to its goals (the setup page). */
export async function nameOrg(name: string): Promise<boolean> {
  useFirstRun.setState({ naming: { name, busy: true, error: null } });
  try {
    const org = await createOrg(name);
    window.location.assign(`${setupHref(org.id)}?first=1`);
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
  return { step: setupStep(search), door: door === "know" || door === "find" ? (door as Door) : null, source: q.get("source") };
}

export async function startSetupPage(search: string) {
  const at = fromAddress(search);
  const first = new URLSearchParams(search).get("first") === "1";
  useFirstRun.setState({ route: "setup", first, step: at.step, door: at.door });
  const org = await currentOrg().catch(() => null);
  useFirstRun.setState({ org });
  if (org) openKnow(org.id);
  // The engine as it was last tested here: never a new call just to show it.
  void engineDb.view().then((view) => setEngine({ view, test: view.test }), () => {});
  // A setup named in the address wins; then the know door; then the latest one not finished.
  if (at.source) await openSetup(at.source);
  else if (at.door !== "know") await openSetup(null);
  const door = useSetup.getState().source ? "find" : (at.door ?? (useKnow.getState().sent ? "know" : null));
  useFirstRun.setState({ door, opened: true });
  if (at.step === "connect") void loadConnect();
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
  useFirstRun.setState({ door });
}

export function goStep(step: SetupStep) {
  push({ step });
  useFirstRun.setState({ step });
  if (step === "connect") void loadConnect();
}

export function togglePick(id: string, on: boolean) {
  const s = useFirstRun.getState();
  const chosen = new Set(s.picked ?? useGoals.getState().mine);
  if (on) chosen.add(id);
  else chosen.delete(id);
  useFirstRun.setState({ picked: [...chosen] });
}

/** Their goals kept (on this computer), then on to what to connect. */
export async function saveYours(order: string[]) {
  const s = useFirstRun.getState();
  const chosen = new Set(s.picked ?? useGoals.getState().mine);
  await setMine(order.filter((id) => chosen.has(id))).catch(() => {});
  useFirstRun.setState({ picked: [...chosen] });
  goStep("connect");
}

export async function loadConnect() {
  void connectorsDb.list().then((v) => useFirstRun.setState({ tools: v.connectors }), () => useFirstRun.setState({ tools: [] }));
  void codeDb.view().then((v) => useFirstRun.setState({ gh: v.gh ?? (v.signedIn ? "Qalam's sign-in" : null) }), () => useFirstRun.setState({ gh: null }));
}
