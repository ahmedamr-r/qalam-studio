import type { ScanSession } from "@/scan/session";

/*
 * What the researcher is doing while a scan reads (pure): its pose, what it says and how far the bar
 * has got. The bar is an impression, not a measure: it moves with time since the scan started, jumps
 * when a real step starts, never fills before the scan is done, and shows no number. The jokes never
 * hold a figure or a finding, so nothing in them can be taken for what was found.
 */

export type ReadingPhase = "starting" | "apps" | "reviews" | "forums" | "pages" | "published" | "offers" | "keeping" | "filing" | "done" | "thin" | "failed";

export type ReadingPose = "idle" | "reading" | "writing" | "found" | "shrug";

/** Each step the scan reports, the bar's floor once it's reached, and what's being done. Latest match wins. */
const STEPS: readonly { re: RegExp; phase: ReadingPhase; floor: number }[] = [
  { re: /^Starting|^Working out where/, phase: "starting", floor: 0.03 },
  { re: /^Looking for /, phase: "apps", floor: 0.07 },
  { re: /App Store/, phase: "reviews", floor: 0.12 },
  { re: /Hacker News/, phase: "forums", floor: 0.18 },
  { re: /^Reading pages/, phase: "pages", floor: 0.24 },
  { re: /^Reading what's been published/, phase: "published", floor: 0.3 },
  { re: /^Reading what each|^Looking at what others/, phase: "offers", floor: 0.36 },
  { re: /^Keeping |^Reading “|^Reading what it says/, phase: "keeping", floor: 0.5 },
  { re: /^Filing /, phase: "filing", floor: 0.8 },
];

/** How long a scan usually takes, which only sets how the bar moves. */
const TYPICAL_MS = 5 * 60 * 1000;

/** It stops here until the scan is done, however long that takes. */
const HOLD = 0.95;

/** The newest step it knows: a step new to it doesn't take it back to the start. */
const stepOf = (s: Pick<ScanSession, "steps">) => {
  for (let i = s.steps.length - 1; i >= 0; i--) {
    const known = STEPS.find((x) => x.re.test(s.steps[i]));
    if (known) return known;
  }
  return null;
};

export function phaseOf(s: Pick<ScanSession, "state" | "steps" | "thin">): ReadingPhase {
  if (s.state === "failed" || s.state === "stopped") return "failed";
  if (s.state === "done") return s.thin ? "thin" : "done";
  return stepOf(s)?.phase ?? "starting";
}

export const POSE_OF: Readonly<Record<ReadingPhase, ReadingPose>> = {
  starting: "idle",
  apps: "reading",
  reviews: "reading",
  forums: "reading",
  pages: "reading",
  published: "reading",
  offers: "reading",
  keeping: "writing",
  filing: "writing",
  done: "found",
  thin: "shrug",
  failed: "shrug",
};

/** 0 to 1. Time alone keeps it moving; a step reached lifts it at once and it never goes back. */
export function scanProgress(s: Pick<ScanSession, "state" | "steps" | "at">, now: number): number {
  if (s.state === "done") return 1;
  const floor = Math.max(...s.steps.map((label) => STEPS.find((x) => x.re.test(label))?.floor ?? 0), 0);
  const left = 1 - Math.exp((-2.2 * Math.max(0, now - s.at)) / TYPICAL_MS);
  return Math.min(HOLD, floor + (HOLD - floor) * left * 0.85);
}

const LINES: Readonly<Record<ReadingPhase, readonly string[]>> = {
  starting: ["Working out where people complain. It's usually everywhere.", "Finding my magnifier. It's the one thing here with a job."],
  apps: ["Looking for what people use today. There's always something.", "Someone has already built this. Badly, I hope."],
  reviews: ["Reading App Store reviews. The honest ones are short and angry.", "Five stars tell me nothing. I'm reading the other ones."],
  forums: ["On Hacker News. Everyone here built it in a weekend.", "Reading the comments, so you don't have to."],
  pages: ["Reading threads. Nobody's happy. That's useful.", "People explain their problems at length online. For free."],
  published: ["Reading what's been published. Skeptically.", "Articles. Somebody had a deadline."],
  offers: ["Checking what others charge. Bold of them.", "Reading pricing pages. “Contact us” is a price, apparently."],
  keeping: ["Writing down what people actually said.", "Keeping their words. Mine aren't evidence."],
  filing: ["Sorting it into problems. Some of these people should talk to each other.", "Nearly there. I said nearly."],
  done: ["Done. Try not to take it personally."],
  thin: ["Not much out there. That's a finding too."],
  failed: ["That didn't work."],
};

/** What it says now: a new line every so often, the same one for the same moment so a redraw doesn't change it. */
export function lineOf(phase: ReadingPhase, since: number): string {
  const lines = LINES[phase];
  return lines[Math.floor(Math.max(0, since) / LINE_MS) % lines.length];
}

export const LINE_MS = 12000;

/** The places listed as it reads, and how much it has read: only what the session says. */
export function readSoFar(s: Pick<ScanSession, "read" | "competitors">) {
  const reviews = s.read.reduce((n, r) => n + (r.reviews?.read ?? 0), 0);
  const quotes = s.read.reduce((n, r) => n + (r.quotes ?? 0), 0);
  return { places: s.read.length, reviews, quotes, apps: s.competitors.length };
}
