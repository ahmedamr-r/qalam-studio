import type { OstKind, OstMetric } from "@/discovery/types";

/**
 * Decision memory: what the team decided on a board, recorded by code as it happens (no model,
 * no tokens), with what the card rested on at that moment. "Why did we drop saved baskets?" is
 * answered with the words and tests of that day, not of today. A big decision asks for a one-line
 * why, which can be skipped and added later.
 */

export type DecisionKind =
  /** The tree's target opportunity changed. */
  | "target"
  /** A card's stage changed: parked, solved, dropped, shipped, a test's result… */
  | "stage"
  /** A card was deleted (with whatever was under it). */
  | "drop"
  /** A card was folded into another (its evidence and children went there). */
  | "merge"
  /** A card moved under another parent. */
  | "move"
  /** An outcome's number changed: its target, or where it is now. */
  | "metric"
  /** Qalam AI's proposals were accepted. */
  | "accept"
  /** Qalam AI's proposals were discarded. */
  | "discard";

export interface KnewThen {
  /** The card's evidence, as its chip says it ("3 quotes · 1 against", "Assumed · needs evidence"). */
  evidence: string;
  /** Up to five pieces it rested on: the words, where they came from, and their ref. */
  pieces: { text: string; from?: string; ref?: string }[];
  /** How many pieces spoke against it. */
  against: number;
  /** Tests under it, with their stage. */
  tests?: { title: string; stage: string }[];
  /** An outcome's number. */
  metric?: OstMetric;
  /** Cards under it. */
  children?: number;
}

export interface Decision {
  id: string;
  at: number;
  kind: DecisionKind;
  board: string;
  boardName: string;
  /** The product the board was for (none: the whole organization). */
  product?: string | null;
  /** The card it's about (none for a batch of Qalam AI's proposals). */
  card: string | null;
  cardTitle: string;
  cardKind?: OstKind;
  /** The line people read: "Made “X” the target", "Dropped the solution “Y”". */
  what: string;
  /** What changed exactly: stages from/to, parents, numbers, what it merged into, what was accepted. */
  detail?: Record<string, unknown>;
  /** You, or Qalam AI (its proposals, once you accepted them). */
  by: "you" | "qalam";
  /** The person who made it (or accepted Qalam AI's proposal), as this computer names them. */
  who?: string;
  /** Big enough to ask why. */
  big: boolean;
  why?: string;
  knew?: KnewThen;
  /** Undone afterwards: kept, marked. */
  undone?: boolean;
}

export const DECISION_KINDS: readonly DecisionKind[] = ["target", "stage", "drop", "merge", "move", "metric", "accept", "discard"];

/** The month file a decision goes in (decisions/<YYYY-MM>.md), in this computer's time. */
export function monthOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** A decision's day, in this computer's time ("2026-10-27"). */
export function dayOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A decision as it may go in the log, or null. What arrives over the network or from a file edited by hand is never written or shown as it is. */
export function sanitizeDecision(raw: unknown): Decision | null {
  if (!isObject(raw)) return null;
  const d = raw as Partial<Decision>;
  if (typeof d.id !== "string" || !ID.test(d.id) || typeof d.board !== "string" || !ID.test(d.board)) return null;
  if (!DECISION_KINDS.includes(d.kind as DecisionKind) || typeof d.at !== "number" || !Number.isFinite(d.at) || d.at <= 0) return null;
  const what = line(d.what, 300);
  if (!what) return null;
  const out: Decision = {
    id: d.id,
    at: Math.floor(d.at),
    kind: d.kind as DecisionKind,
    board: d.board,
    boardName: line(d.boardName, 120) || "Untitled board",
    card: typeof d.card === "string" && ID.test(d.card) ? d.card : null,
    cardTitle: line(d.cardTitle, 200),
    what,
    by: d.by === "qalam" ? "qalam" : "you",
    big: d.big === true,
  };
  if (d.product === null || (typeof d.product === "string" && ID.test(d.product))) out.product = d.product;
  if (["outcome", "opportunity", "solution", "test"].includes(d.cardKind as string)) out.cardKind = d.cardKind;
  if (isObject(d.detail) && JSON.stringify(d.detail).length <= 12_000) out.detail = d.detail;
  const why = line(d.why, 500);
  if (why) out.why = why;
  const who = line(d.who, 80);
  if (who) out.who = who;
  if (d.undone === true) out.undone = true;
  if (isObject(d.knew)) {
    const k = d.knew as Partial<KnewThen>;
    const pieces = (Array.isArray(k.pieces) ? k.pieces : [])
      .filter(isObject)
      .slice(0, 5)
      .map((p) => ({ text: line(p.text, 400), ...(line(p.from, 120) ? { from: line(p.from, 120) } : {}), ...(line(p.ref, 120) ? { ref: line(p.ref, 120) } : {}) }))
      .filter((p) => p.text);
    const knew: KnewThen = { evidence: line(k.evidence, 120), pieces, against: count(k.against) };
    const tests = (Array.isArray(k.tests) ? k.tests : []).filter(isObject).slice(0, 10).map((t) => ({ title: line(t.title, 200), stage: line(t.stage, 40) }));
    if (tests.length) knew.tests = tests;
    if (isObject(k.metric)) knew.metric = k.metric as unknown as OstMetric;
    if (count(k.children)) knew.children = count(k.children);
    out.knew = knew;
  }
  return out;
}
