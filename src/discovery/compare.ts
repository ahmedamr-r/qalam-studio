import type { Doc } from "@/doc/schema";
import { isOstCard } from "@/doc/board";
import { checkWords } from "@/hub/topics";
import { evidenceVoice, STRENGTH_LABEL, strengthOf, type Strength } from "@/hub/strength";
import type { Voice } from "@/hub/people";
import { metricText } from "./dump";
import { stageLabel } from "./kinds";
import type { OstCard } from "./types";

/*
 * Comparing the needs under an outcome (or a broad need) side by side, to choose the one to
 * target (pure). Code computes what can be counted: how strong each need's evidence is (voices,
 * segments, sources, rows of a table, how recent, what's against it) and what's under it
 * (solutions, tests). The team rates what can't be counted (how often it happens, how much it
 * hurts, how it fits the strategy). Qalam AI may then argue for one, citing what it was sent: code
 * keeps its argument only when every quote and number in it is in what it cites.
 */

export type RatingKey = "often" | "hurts" | "fit";
export type Rating = Partial<Record<RatingKey, 1 | 2 | 3>>;

export const RATING_LABEL: Record<RatingKey, string> = { often: "How often it happens", hurts: "How much it hurts", fit: "Fits the strategy" };
export const RATING_STEPS: Record<RatingKey, [string, string, string]> = {
  often: ["Rarely", "Sometimes", "Often"],
  hurts: ["A little", "Some", "A lot"],
  fit: ["Weakly", "Partly", "Well"],
};
export const RATING_KEYS: RatingKey[] = ["often", "hurts", "fit"];

export interface Compared {
  id: string;
  card: OstCard;
  strength: Strength;
  /** Solutions under it (all depths), and their tests by how they went. */
  solutions: number;
  tests: { passed: number; failed: number; running: number };
}

/** The needs directly under a card (an outcome's, or a broad need's finer ones). */
export function needsUnder(doc: Doc, parentId: string): { id: string; card: OstCard }[] {
  const n = doc.nodes[parentId];
  if (!n) return [];
  return n.children.flatMap((id) => {
    const c = doc.nodes[id];
    return isOstCard(c) && c.meta.ost.kind === "opportunity" ? [{ id, card: c.meta.ost }] : [];
  });
}

/** Two needs or more under it: worth comparing. */
export const canCompare = (doc: Doc, id: string) => needsUnder(doc, id).length >= 2;

/** The needs under a card, side by side, with what code counts about each. */
export function compareUnder(doc: Doc, parentId: string, o: { now: number; voices?: ReadonlyMap<string, Voice> }): Compared[] {
  return needsUnder(doc, parentId).map(({ id, card }) => {
    let solutions = 0;
    const tests = { passed: 0, failed: 0, running: 0 };
    const walk = (nid: string) => {
      for (const k of doc.nodes[nid]?.children ?? []) {
        const c = doc.nodes[k];
        if (!isOstCard(c)) continue;
        if (c.meta.ost.kind === "solution") solutions++;
        if (c.meta.ost.kind === "test" && (c.meta.ost.stage === "passed" || c.meta.ost.stage === "failed" || c.meta.ost.stage === "running")) tests[c.meta.ost.stage]++;
        walk(k);
      }
    };
    walk(id);
    return { id, card, strength: strengthOf(card, { now: o.now, voices: o.voices }), solutions, tests };
  });
}

// ---------------------------------------------------------------------------
// Asking Qalam AI which to target: what it's sent, and what code keeps of its answer

export interface CompareSent {
  /** The material as the model reads it. */
  text: string;
  /** The needs, as the call names them (n1…), by card id. */
  needs: Map<string, string>;
  /** Everything a line may cite (n…, q…), with its words. */
  cited: Map<string, { text: string; card: string }>;
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const ratingText = (r: Rating | undefined) =>
  RATING_KEYS.filter((k) => r?.[k])
    .map((k) => `${RATING_LABEL[k].toLowerCase()}: ${RATING_STEPS[k][r![k]! - 1].toLowerCase()}`)
    .join("; ");

/** The needs to choose between, each with what backs it (its quotes, by voice) and the team's call. */
export function compareMaterial(o: { parent: OstCard; outcome: OstCard | null; goal?: string; context: string; rows: Compared[]; voices?: ReadonlyMap<string, Voice> }): CompareSent {
  const needs = new Map<string, string>();
  const cited = new Map<string, { text: string; card: string }>();
  const out: string[] = [];
  const oc = o.outcome;
  if (oc) out.push(`The outcome: “${one(oc.title)}”${oc.metric ? ` · ${metricText(oc.metric)}` : ""}${o.goal ? ` · it serves the goal “${one(o.goal)}”` : ""}`);
  if (o.parent !== oc) out.push(`The broad need they're finer cases of: “${one(o.parent.title)}”`);
  if (o.context.trim()) out.push("", o.context.trim());
  out.push("", "The needs to choose between (id · title · stage · how strong what backs it is · what's under it · the team's call), each with its customers' words (id · who: words):");
  let q = 0;
  for (const [i, r] of o.rows.entries()) {
    const nid = `n${i + 1}`;
    needs.set(nid, r.id);
    const s = r.strength;
    const under = `${r.solutions} ${r.solutions === 1 ? "solution" : "solutions"}${r.tests.passed || r.tests.failed ? `, tests ${r.tests.passed} passed and ${r.tests.failed} failed` : ""}`;
    const call = ratingText(r.card.rating);
    const line = [`“${one(r.card.title)}”`, stageLabel("opportunity", r.card.stage).toLowerCase(), `strength: ${STRENGTH_LABEL[s.level].toLowerCase()}${s.why ? ` (${s.why})` : ""}`, under, call ? `the team: ${call}` : "the team hasn't rated it"].join(" · ");
    cited.set(nid, { text: `${r.card.title}\n${line}\n${r.card.description ?? ""}`, card: r.id });
    out.push(`- ${nid} · ${line}`);
    for (const e of r.card.evidence.filter((x) => x.kind === "quote").slice(0, 12)) {
      const qid = `q${++q}`;
      const v = evidenceVoice(e, o.voices);
      const who = v.name ? `${v.name}${v.segments.length ? ` (${v.segments.join(", ")})` : ""}` : v.segments.length ? `a customer (${v.segments.join(", ")})` : "a customer";
      cited.set(qid, { text: e.text, card: r.id });
      out.push(`  - ${qid} · ${who}${e.stance === "against" ? ", against it" : ""}: “${one(e.text)}”`);
    }
  }
  out.push("", "Which need should the team target first, to move the outcome?");
  return { text: out.join("\n"), needs, cited };
}

export interface CompareAdvice {
  /** The card Qalam AI would target (null: it wouldn't pick one yet). */
  pick: string | null;
  why: string;
  /** What it says about each of the others. */
  others: { card: string; note: string }[];
  /** What would settle it, when it's close. */
  ask?: string;
  /** The ids its argument rests on, as the call named them. */
  cites: string[];
}

const items = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
const idList = (v: unknown, m: CompareSent) => [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && m.cited.has(x.trim())).map((x) => x.trim()))];

/**
 * What code keeps of Qalam AI's argument: a pick among the needs sent, and an argument whose quotes
 * and numbers are in what it cites (dropped whole when they aren't). Notes on the others are kept
 * one by one, on the same terms.
 */
export function sanitizeCompare(raw: unknown, m: CompareSent): CompareAdvice | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pick = typeof r.pick === "string" ? (m.needs.get(r.pick.trim()) ?? null) : null;
  const cites = idList(r.cites, m);
  if (!cites.length) return null;
  const why = checkWords(r.why, cites.map((id) => m.cited.get(id)!), "", 700);
  if (!why) return null;
  const others: CompareAdvice["others"] = [];
  for (const x of items(r.others)) {
    const card = typeof x.need === "string" ? m.needs.get(x.need.trim()) : undefined;
    if (!card || card === pick || others.some((y) => y.card === card)) continue;
    const own = idList(x.cites, m);
    const note = checkWords(x.note, [...own, ...cites].map((id) => m.cited.get(id)!), "", 400);
    if (note) others.push({ card, note });
  }
  const ask = typeof r.ask === "string" && r.ask.trim() ? checkWords(r.ask, cites.map((id) => m.cited.get(id)!), "", 300) : null;
  return { pick, why, others, ...(ask ? { ask } : {}), cites };
}
