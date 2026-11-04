import { isKeyed, type EngineKind } from "@/ai/engine-kinds";
import type { OrgShape } from "@/org/words";
import { lab } from "@/lab";

/*
 * The welcome's steps (pure): Qalam AI found and tested, the organization named, who they are
 * (their name and position there), talking instead of typing (once per Mac), its goals (written down, or found in what they write about it),
 * which are theirs, and what to connect for them (from who they are on, the setup page, src/ui/setup). Like OpenClaw's QuickStart: everything
 * else is "set up later", and running it again only checks. On your own there's no "which are
 * theirs": every goal is yours.
 */

export type WelcomeStep = "engine" | "name" | "you" | "voice" | "company" | "competitors" | "goals" | "yours" | "connect";

export const WELCOME_STEPS: readonly { id: WelcomeStep; label: string }[] = [
  { id: "engine", label: "Qalam AI" },
  { id: "name", label: "Name it" },
  { id: "you", label: "You" },
  { id: "voice", label: "Voice" },
  // What the web says about it, checked with them (src/market/), before any goal or problem.
  { id: "company", label: "The company" },
  { id: "competitors", label: "Competitors" },
  { id: "goals", label: "Start" },
  { id: "yours", label: "Yours" },
  { id: "connect", label: "Connect" },
];

/** Whether a step is asked: v0.1 hides You, Voice, Yours and Connect (src/lab.ts), and on your own there's no Yours. */
export function stepShown(id: WelcomeStep, shape?: OrgShape | null): boolean {
  if (id === "you") return lab("you");
  if (id === "voice") return lab("voice");
  if (id === "yours") return shape !== "solo" && lab("yours");
  if (id === "connect") return lab("connectors");
  return true;
}

/** The steps for a team, or for one person on their own. */
export const stepsFor = (shape?: OrgShape | null) => WELCOME_STEPS.filter((s) => stepShown(s.id, shape));

/** The setup page's next step after `step` that's asked; null: Finish. */
export function stepAfter(step: WelcomeStep, shape?: OrgShape | null): SetupStep | null {
  const after = WELCOME_STEPS.slice(WELCOME_STEPS.findIndex((s) => s.id === step) + 1);
  return (after.find((s) => s.id !== "engine" && s.id !== "name" && stepShown(s.id, shape))?.id as SetupStep | undefined) ?? null;
}

export type StepState = "done" | "now" | "next";

/** Each step's state while `at` is the one being done. */
export function stepStates(at: WelcomeStep): Record<WelcomeStep, StepState> {
  const i = WELCOME_STEPS.findIndex((s) => s.id === at);
  return Object.fromEntries(WELCOME_STEPS.map((s, k) => [s.id, k < i ? "done" : k === i ? "now" : "next"])) as Record<WelcomeStep, StepState>;
}

/** The setup page's steps, as its address names them (`?step=`): the goals unless it says. */
export type SetupStep = Extract<WelcomeStep, "you" | "voice" | "company" | "competitors" | "goals" | "yours" | "connect">;
export const setupStep = (search: string): SetupStep => {
  const s = new URLSearchParams(search).get("step");
  return s === "you" || s === "voice" || s === "company" || s === "competitors" || s === "yours" || s === "connect" ? s : "goals";
};

/** What the first run left behind here, read from what's kept (nothing about where they stopped is saved but Finish). */
export interface FirstRunKept {
  /** Their name on this Mac, and their position at the organization. */
  you: boolean;
  /** How this Mac talks instead of typing is settled, or there's nothing to choose. */
  voice: boolean;
  /** What the company does was checked with them (unknown: taken as done). */
  company?: boolean;
  /** Goals in the organization's tree. */
  goals: number;
  /** A brain dump about the organization is still being set up. */
  settingUp: boolean;
  /** Which goals are theirs was answered on this computer. */
  picked: boolean;
  /** Finish was clicked on this computer. */
  finished: boolean;
  /** A team's, or one person's own (none: a team). */
  shape?: OrgShape | null;
}

/** Where the first run picks up again (the home's card), and how many steps are behind it; null: it's finished. */
export function firstRunLeft(k: FirstRunKept): { step: SetupStep; done: number; of: number } | null {
  if (k.finished) return null;
  const shown = (s: WelcomeStep) => stepShown(s, k.shape);
  const step: SetupStep = !k.you && shown("you") ? "you" : !k.voice && shown("voice") ? "voice" : k.company === false && shown("company") ? "company" : k.settingUp || !k.goals ? "goals" : !k.picked && shown("yours") ? "yours" : shown("connect") ? "connect" : "goals";
  const steps = stepsFor(k.shape);
  return { step, done: steps.findIndex((s) => s.id === step), of: steps.length };
}

/**
 * What to connect for the goals, the most useful first: their numbers (once a goal has one), what
 * customers say about the problems behind them, the team's docs, and the product's code.
 */
export function connectFor(hasNumbers: boolean): { id: string; why: string }[] {
  const numbers = { id: "posthog", why: hasNumbers ? "Reads your goals' numbers from saved insights, so where each stands stays current." : "Once a goal has a number, Qalam reads it from a saved insight." };
  return [
    ...(hasNumbers ? [numbers] : []),
    { id: "intercom", why: "What customers tell support: the problems behind your goals." },
    { id: "slack", why: "What customers and the team say in channels." },
    { id: "notion", why: "Strategy docs, research and notes to read." },
    { id: "confluence", why: "The team's pages and specs, where they live in Confluence." },
    ...(hasNumbers ? [] : [numbers]),
    { id: "github", why: "What the app does today, and where its funnel leaks." },
  ];
}

/** first: no organization yet · new: another one (from the organization menu) · verify: check the setup again. */
export type WelcomeMode = "first" | "new" | "verify";

export const welcomeMode = (search: string): WelcomeMode => {
  const q = new URLSearchParams(search);
  return q.get("verify") === "1" ? "verify" : q.get("new") === "1" ? "new" : "first";
};

/** Checking again never names, makes or switches anything: it only tests and reports. */
export const changesThings = (mode: WelcomeMode) => mode !== "verify";

const RETRY_MS = [250, 500, 1000, 1500, 2000, 3000, 3000, 3000];

/** How long to wait before asking the core again while it starts (about 15 s in all); null: say it can't be reached. */
export const bootRetryDelay = (attempt: number): number | null => RETRY_MS[attempt] ?? null;

/**
 * Whether the live engine can't run, so the welcome looks for one that can: one that takes a key and
 * has none, or Claude Code or Codex that isn't here or is signed out. One whose sign-in can't be told
 * stays, as does a model on this computer that isn't running: someone chose that.
 */
export function engineGivesWay(v: { kind: EngineKind; key: unknown; claude: { found: boolean; signedIn: boolean | null }; codex?: { found: boolean; signedIn: boolean | null } }): boolean {
  if (isKeyed(v.kind)) return !v.key;
  const agent = v.kind === "cli" ? v.claude : v.kind === "codex" ? v.codex : null;
  return !!agent && (!agent.found || agent.signedIn === false);
}
