/*
 * What people see in a product (pure types): its screens, from the person's own screenshots, and
 * the flows they make. A screenshot is an asset; this Mac reads its words (qalam-see, macOS's text
 * recognition), and code keeps what Qalam AI says about a screen only where those words back it:
 * a control's label is on the screen, word for word, and so is every quoted word and number. A move
 * from one screen to the next names the control that makes it, as the screen it leaves shows it, or
 * a person says which. Kept in hub/seen/<key>.md (src/seen/seen-md.ts), one per product (or "org").
 */

/** A screenshot's words, as this Mac read them: each line with its box (0..1, from the top left). */
export interface SeenLine {
  text: string;
  box: [number, number, number, number];
  conf: number;
}

/** What this Mac read off a screenshot: its size, a difference hash (16 hex) and its lines. */
export interface SeenText {
  w: number;
  h: number;
  dhash: string;
  lines: SeenLine[];
}

/** A screenshot added to a reading. */
export interface Shot {
  /** The picture: asset:<hash>. */
  ref: string;
  /** Its file's name, as it was added. */
  name: string;
  /** When its file was last changed (File.lastModified), when the window knew. */
  modified?: number;
}

export type ScreenKind =
  | "home"
  | "list"
  | "detail"
  | "form"
  | "sheet"
  | "dialog"
  | "menu"
  | "search"
  | "settings"
  | "sign-in"
  | "onboarding"
  | "dashboard"
  | "map"
  | "media"
  | "empty"
  | "error"
  | "loading"
  | "success"
  | "other";

export const SCREEN_KINDS: readonly ScreenKind[] = ["home", "list", "detail", "form", "sheet", "dialog", "menu", "search", "settings", "sign-in", "onboarding", "dashboard", "map", "media", "empty", "error", "loading", "success", "other"];

/** A control on a screen: its label as the screen shows it, and what it does. */
export interface ScreenCan {
  label: string;
  does?: string;
}

/** What Qalam AI read off one screenshot, as code kept it. */
export interface ShotNote {
  name: string;
  kind: ScreenKind;
  /** What the screen is for. */
  does?: string;
  /** What's on it. */
  on?: string;
  can: ScreenCan[];
  /** Navigation on it: a tab bar's or a menu's labels. */
  nav: string[];
  /** What this screenshot shows of the screen (empty, an error, filled in), when it's one state of several. */
  state?: string;
  /** How it's laid out: described, never judged. */
  design?: string;
}

export interface SeenScreen {
  /** Its name in its file: what flows, pieces and links name it by. */
  key: string;
  name: string;
  /** Its screenshots: the first is how it usually looks, the others its other states. */
  shots: string[];
  /** What each other state shows, by its screenshot. */
  states: Record<string, string>;
  kind: ScreenKind;
  does?: string;
  on?: string;
  can: ScreenCan[];
  nav: string[];
  design?: string;
  /** The step of a code map it shows (`stepRef`), once a person said so. */
  step?: string;
  by: "qalam" | "you";
  at: number;
}

/** How one screen leads to the next: a tap on a control, going back, the product moving on by itself (after paying), a swipe, typing. */
export type MoveHow = "tap" | "back" | "system" | "swipe" | "type";

export const MOVE_HOWS: readonly MoveHow[] = ["tap", "back", "system", "swipe", "type"];

export interface SeenMove {
  /** Screen keys. */
  from: string;
  to: string;
  /** The control that makes it, as the screen it leaves shows it. */
  via?: string;
  how: MoveHow;
}

export interface SeenFlow {
  key: string;
  name: string;
  /** What the person using it is trying to do ("to pay for the basket"). */
  aim: string;
  /** The goal it serves. */
  goal?: string;
  /** Its screens in order: the way through when all goes well. */
  steps: string[];
  /** The moves between them, and the branches off them. */
  moves: SeenMove[];
  /** Where it's reached from. */
  entry?: string;
  /** What the screenshots don't show yet ("what happens when a payment fails"). */
  notShown: string[];
  note?: string;
  by: "qalam" | "you";
  at: number;
}

export interface SeenMap {
  /** The product's id, or "org" for the whole organization. */
  key: string;
  product: string | null;
  readAt: number;
  screens: SeenScreen[];
  flows: SeenFlow[];
  /** What a person took out: screenshots (asset:…) and flows (flow:<key>). Qalam AI never brings them back. */
  gone: string[];
}

export const SEEN_LIMITS = { shots: 60, batch: 10, screens: 160, flows: 12, steps: 15, moves: 40, can: 12, nav: 8, label: 60, name: 60, line: 400, notShown: 4, questions: 4, rounds: 3 } as const;

/** The key of the organization's own map. */
export const ORG_SEEN = "org";

/** A map's key: a product's id or "org". */
export const SEEN_KEY = /^[A-Za-z0-9_-]{1,64}$/;

// ---------------------------------------------------------------------------
// A reading: a batch of screenshots on its way to the map

/** Which screen a question is about, so its answer can be applied: two screenshots that may be one screen, or a move whose control isn't shown. Nodes are screenshots (asset:…) or screens already kept (screen:<key>). */
export type QuestionAbout = { same: [string, string] } | { move: { from: string; to: string } };

export interface SeenQuestion {
  id: string;
  ask: string;
  why: string;
  /** The screenshots it's about (asset:…), shown with it. */
  shots: string[];
  /** Words on them the question points at, with their box (0..1). */
  marks: { shot: string; words: string; box: [number, number, number, number] }[];
  /** The answers to pick from; none for an open question. */
  options: string[];
  about?: QuestionAbout;
  /** Qalam AI asked it, or code (a grouping the screenshots don't back, a move whose control isn't shown). */
  by: "qalam" | "code";
}

export interface SeenAnswer {
  question: string;
  ask: string;
  answer: string;
  about?: QuestionAbout;
}

export type ReadingPhase = "reading" | "placing" | "asking" | "review" | "done" | "failed";

export interface SeenReading {
  key: string;
  product: string | null;
  started: number;
  phase: ReadingPhase;
  shots: Shot[];
  /** What was read off each screenshot, by its ref. */
  notes: Record<string, ShotNote>;
  /** Whether this Mac read the words on them (qalam-see); without it nothing on a screen is checked, and nothing unchecked is kept. */
  words: boolean;
  rounds: { questions: SeenQuestion[]; answers: SeenAnswer[] }[];
  /** The map as it would be: what's kept merged with what's proposed. */
  proposal?: SeenMap;
  /** Code steps proposed for screens (screen key → step ref). */
  steps: Record<string, string>;
  /** What the person decided on: flows by key, code steps by screen key. */
  settled: { flows: Record<string, "accepted" | "discarded">; steps: Record<string, "accepted" | "discarded"> };
  /** What it's doing now, in a few words. */
  activity?: string;
  error?: string;
}
