/*
 * The welcome's steps (pure): Qalam AI found and tested, the organization named, who they are
 * (their name and position there), talking instead of typing (once per Mac), its goals (written down, or found in what they write about it),
 * which are theirs, and what to connect for them (from who they are on, the setup page, src/ui/setup). Like OpenClaw's QuickStart: everything
 * else is "set up later", and running it again only checks.
 */

export type WelcomeStep = "engine" | "name" | "you" | "voice" | "goals" | "yours" | "connect";

export const WELCOME_STEPS: readonly { id: WelcomeStep; label: string }[] = [
  { id: "engine", label: "Qalam AI" },
  { id: "name", label: "Name it" },
  { id: "you", label: "You" },
  { id: "voice", label: "Voice" },
  { id: "goals", label: "Goals" },
  { id: "yours", label: "Yours" },
  { id: "connect", label: "Connect" },
];

export type StepState = "done" | "now" | "next";

/** Each step's state while `at` is the one being done. */
export function stepStates(at: WelcomeStep): Record<WelcomeStep, StepState> {
  const i = WELCOME_STEPS.findIndex((s) => s.id === at);
  return Object.fromEntries(WELCOME_STEPS.map((s, k) => [s.id, k < i ? "done" : k === i ? "now" : "next"])) as Record<WelcomeStep, StepState>;
}

/** The setup page's steps, as its address names them (`?step=`): the goals unless it says. */
export type SetupStep = Extract<WelcomeStep, "you" | "voice" | "goals" | "yours" | "connect">;
export const setupStep = (search: string): SetupStep => {
  const s = new URLSearchParams(search).get("step");
  return s === "you" || s === "voice" || s === "yours" || s === "connect" ? s : "goals";
};

/** What the first run left behind here, read from what's kept (nothing about where they stopped is saved but Finish). */
export interface FirstRunKept {
  /** Their name on this Mac, and their position at the organization. */
  you: boolean;
  /** How this Mac talks instead of typing is settled, or there's nothing to choose. */
  voice: boolean;
  /** Goals in the organization's tree. */
  goals: number;
  /** A brain dump about the organization is still being set up. */
  settingUp: boolean;
  /** Which goals are theirs was answered on this computer. */
  picked: boolean;
  /** Finish was clicked on this computer. */
  finished: boolean;
}

/** Where the first run picks up again (the home's card), and how many steps are behind it; null: it's finished. */
export function firstRunLeft(k: FirstRunKept): { step: SetupStep; done: number; of: number } | null {
  if (k.finished) return null;
  const step: SetupStep = !k.you ? "you" : !k.voice ? "voice" : k.settingUp || !k.goals ? "goals" : !k.picked ? "yours" : "connect";
  return { step, done: WELCOME_STEPS.findIndex((s) => s.id === step), of: WELCOME_STEPS.length };
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
