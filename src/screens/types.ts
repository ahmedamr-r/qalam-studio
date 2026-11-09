/*
 * Screens in the conversation (pure types): the screenshots an answer gave, as the core kept them
 * (server/org/screens.ts). Each is one of the product's screens in What people see (src/seen/) and a
 * picture source whose printed words are the product's own copy, never anyone's words.
 */

/** A screenshot as an answer gave it: the asset ("asset:<hash>" or the bare hash) and its name. */
export interface ShownShot {
  asset: string;
  title: string;
}

export interface KeptShot {
  /** The asset's bare hash. */
  asset: string;
  title: string;
  /** The source that holds it. */
  source: string;
  /** The screen it's kept as; none: it isn't a screen of theirs, and it's an ordinary picture source. */
  screen?: { map: string; key: string; name: string };
  /** What Qalam AI read it as (a screen, a chart…), and what it's about, checked against its print. */
  shows?: string;
  about?: string;
  /** What's printed on it, read on this computer (none off a Mac). */
  printed: string;
  /** It couldn't be read at all here: kept by its name alone. */
  unread?: true;
}

export interface KeptShots {
  /** The map they're kept in: the product's, or the organization's own. */
  map: string;
  /** The flow they make, when they're two screens or more. */
  flow?: { key: string; name: string };
  shots: KeptShot[];
}

/** Most screenshots kept from one answer. */
export const KEEP_MAX = 12;

// ---------------------------------------------------------------------------
// The review: what on the screens bears on the problem, from the customer's side and the business's

export type FindingSide = "customer" | "business";
export const FINDING_SIDES: readonly FindingSide[] = ["customer", "business"];
export type ChangeDoes = "remove" | "reword" | "move" | "replace" | "add";
export const CHANGE_DOES: readonly ChangeDoes[] = ["remove", "reword", "move", "replace", "add"];

/** One change, the smallest that would fix it. `insteadOf`: what it takes away or replaces there, as the screen prints it. */
export interface FindingChange {
  does: ChangeDoes;
  what: string;
  insteadOf?: string;
}

/** What a finding rests on beside the screen: how their business works, a goal, or what they said. */
export interface FindingRest {
  kind: "business" | "goal" | "answer";
  text: string;
}

export interface ScreenFinding {
  /** The screenshot it's on and what it says: the same finding on the same screenshot keeps it. */
  key: string;
  /** The screenshot it's on (the asset's bare hash), the screen it's kept as, and that screen's name. */
  shot: string;
  screen?: string;
  name: string;
  side: FindingSide;
  /** What goes wrong, and for whom. */
  title: string;
  /** How it bears on the problem they're working out. */
  why: string;
  /** The printed words it points at, as the screen prints them, and where they are (0..1, from the top left). */
  on?: { words: string; box: [number, number, number, number] };
  /** Left out when it would add to the screen without taking anything away, or acts on what isn't printed there. */
  change?: FindingChange;
  rests?: FindingRest[];
}

export interface ScreenReview {
  v: 1;
  id: string;
  at: number;
  /** The map the screens are in, and the flow they make. */
  map: string;
  flow?: { key: string; name: string };
  /** What it was looked at for: the problem they're working out, as they put it. */
  focus: string;
  shots: { asset: string; name: string; screen?: string; source: string }[];
  /** Ranked: what costs the problem most first. */
  findings: ScreenFinding[];
  /** Nothing on them bears on the problem, as Qalam AI found. */
  none?: true;
  /** Not looked at: the engine can't see pictures (the screens are kept all the same). */
  unseen?: true;
  /** Off a Mac nothing printed could be checked: no marks, nothing quoted as printed. */
  unread?: true;
  /** What code left out of Qalam AI's answer, and why. */
  left: { what: string; why: string }[];
}

/** A review's guards on size: every finding that bears on the problem is kept, ranked, up to these. */
export const REVIEW_LIMITS = { perScreen: 12, all: 24, title: 90, why: 220, what: 200, on: 120, screens: 6 } as const;
