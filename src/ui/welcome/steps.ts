/*
 * The welcome's steps (pure): Qalam AI found and tested, the organization named, what they write
 * about it, and what Qalam AI found in it (the last two are the setup page, src/ui/setup). Like
 * OpenClaw's QuickStart: everything else is "set up later", and running it again only checks.
 */

export type WelcomeStep = "engine" | "name" | "about" | "found";

export const WELCOME_STEPS: readonly { id: WelcomeStep; label: string }[] = [
  { id: "engine", label: "Qalam AI" },
  { id: "name", label: "Name it" },
  { id: "about", label: "Tell Qalam about it" },
  { id: "found", label: "See what it found" },
];

export type StepState = "done" | "now" | "next";

/** Each step's state while `at` is the one being done. */
export function stepStates(at: WelcomeStep): Record<WelcomeStep, StepState> {
  const i = WELCOME_STEPS.findIndex((s) => s.id === at);
  return Object.fromEntries(WELCOME_STEPS.map((s, k) => [s.id, k < i ? "done" : k === i ? "now" : "next"])) as Record<WelcomeStep, StepState>;
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
