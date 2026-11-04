import { create } from "zustand";
import { engineShown } from "@/lab";
import { engineDb, type EngineKind, type EngineTest, type EngineView } from "@/org/engine";
import { engineGivesWay, welcomeMode, type WelcomeMode } from "../welcome/steps";

/*
 * Whether Qalam AI can answer on this computer, for the first run: the engine found and tested with
 * a short real call, and what's picked instead when it can't run.
 */

export interface EngineCheck {
  mode: WelcomeMode;
  view: EngineView | null;
  test: EngineTest | null;
  checking: boolean;
  error: string | null;
  keyOpen: boolean;
  skipped: boolean;
}

export const useEngineCheck = create<EngineCheck>(() => ({ mode: "first", view: null, test: null, checking: false, error: null, keyOpen: false, skipped: false }));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const setEngine = (patch: Partial<EngineCheck>) => useEngineCheck.setState(patch);

/** Which engine the welcome picks when the live one can't run (`engineGivesWay`): Claude Code signed in, then Codex, then a key kept here, then a model on this computer. */
const FIRST_CHOICE: EngineKind[] = ["cli", "codex", "api", "openai", "gemini", "openrouter", "ollama", "lmstudio"];

/** How long an engine's passed test counts for a new organization on the same computer. */
const RECENT = 60 * 60 * 1000;

export function startWelcome(search: string) {
  setEngine({ mode: welcomeMode(search) });
  void checkEngine();
}

/** What this computer has, tested with a short real call: an engine that can't run gives way to the first that's ready. */
export async function checkEngine() {
  const { mode } = useEngineCheck.getState();
  setEngine({ checking: true, error: null });
  try {
    let v = await engineDb.view();
    const stateOf = (k: EngineKind) => (k === "cli" ? (v.claude.found && v.claude.signedIn ? "ready" : null) : (v.options?.find((o) => o.kind === k)?.state ?? null));
    if (engineGivesWay(v)) {
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
