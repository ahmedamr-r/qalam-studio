import { newId } from "@/doc/factory";
import type { FollowUp } from "@/design-system/interview/sanitize";
import { isPartial, partialKey } from "@/ai/partial-json";
import { mentions, verbatim } from "./quotes";
import type { InterviewAnswer } from "./interview";
import type { AssumptionCategory, OstAssumption, OstCard, OstEvidence, OstMetric } from "./types";

/*
 * Qalam AI's draft of a tree, made safe to put on the board (pure). Code decides what counts:
 *   - a quote is kept only if the builder's answer really says it, and the card stores their
 *     words, not the model's;
 *   - a metric number is kept only if the builder wrote it;
 *   - opportunities hang under the outcome or another opportunity, solutions under an
 *     opportunity, nothing deeper than three opportunities, a handful per card;
 *   - solutions are the builder's own ideas (their words quoted) or at most three of Qalam AI's,
 *     only under the opportunity it recommends targeting;
 *   - everything is marked as drafted, so an opportunity with no quote shows as Assumed.
 */

export interface DraftCard {
  /** The model's id for it (o1, s2…), for its children to point at. */
  ref: string;
  /** The ref of the card it hangs under; null = the outcome. */
  parent: string | null;
  card: OstCard;
}

export interface Draft {
  summary: string;
  outcome: OstCard | null;
  /** Parents before their children. */
  cards: DraftCard[];
}

export const LIMITS = { topLevel: 8, perParent: 4, depth: 3, solutionsPer: 4, aiIdeas: 3, total: 40, title: 90, description: 280 } as const;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const items = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []).map(rec);
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const CATEGORIES: AssumptionCategory[] = ["desirability", "viability", "feasibility", "usability", "ethical"];

/** Qalam AI's follow-up questions: at most three, short, each with a few likely answers. */
export function sanitizeFollowups(raw: unknown): FollowUp[] {
  return items(rec(raw).followUps)
    .map((f, i) => ({
      id: clip(f.id, 30).replace(/[^a-z0-9-]/gi, "").toLowerCase() || `follow-${i + 1}`,
      question: clip(f.question, 160),
      why: clip(f.why, 160),
      options: (Array.isArray(f.options) ? f.options : [])
        .map((o) => clip(o, 80))
        .filter(Boolean)
        .filter((o, j, a) => a.indexOf(o) === j)
        .slice(0, 4),
    }))
    .filter((f) => f.question)
    .filter((f, i, a) => a.findIndex((x) => x.id === f.id) === i)
    .slice(0, 3);
}

/** The builder's words for a quote from one of their answers, as evidence; null when they didn't say it. */
function evidenceFrom(answers: Map<string, string>, answerId: unknown, quote: unknown, now: number): OstEvidence | null {
  const id = typeof answerId === "string" ? answerId : "";
  const text = answers.get(id);
  const words = text && typeof quote === "string" ? verbatim(text, quote) : null;
  return words ? { id: newId(), kind: "answer", text: words, answerId: id, addedBy: "ai", at: now } : null;
}

/**
 * `hub`: customers' quotes from the organization's knowledge the draft was given, by their ids
 * (k…), each made into evidence for the opportunity that lists it.
 */
export function sanitizeDraft(raw: unknown, answers: InterviewAnswer[], now = Date.now(), hub?: Map<string, () => OstEvidence>): Draft {
  const r = rec(raw);
  const said = new Map(answers.map((a) => [a.id, a.answer]));
  const everything = answers.map((a) => a.answer).join("\n");

  // The outcome, with only the builder's own numbers.
  const o = rec(r.outcome);
  let outcome: OstCard | null = null;
  if (Object.keys(o).length) {
    const m = rec(o.metric);
    const theirs = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && mentions(everything, v) ? v : null);
    const baseline = theirs(m.baseline);
    const metric: OstMetric = {
      name: clip(m.name, 80),
      direction: m.direction === "decrease" ? "decrease" : "increase",
      baseline,
      current: theirs(m.current) ?? baseline,
      target: theirs(m.target),
    };
    const unit = clip(m.unit, 24);
    if (unit) metric.unit = unit;
    const timeframe = clip(m.timeframe, 40);
    if (timeframe) metric.timeframe = timeframe;
    const rationale = clip(o.rationale, LIMITS.description);
    outcome = { v: 1, kind: "outcome", title: clip(o.title, LIMITS.title), stage: "active", createdBy: "ai", evidence: [], metric, ...(rationale ? { description: rationale } : {}) };
  }

  const cards: DraftCard[] = [];
  const known = new Map<string, { kind: "opportunity" | "solution"; parent: string | null; depth: number }>();
  const childCount = new Map<string | null, number>();
  const titles = new Map<string | null, Set<string>>();
  const fits = (parent: string | null, title: string, cap: number) => {
    const t = key(title);
    const seen = titles.get(parent) ?? new Set<string>();
    if (!t || seen.has(t) || (childCount.get(parent) ?? 0) >= cap || cards.length >= LIMITS.total) return false;
    seen.add(t);
    titles.set(parent, seen);
    childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
    return true;
  };

  for (const x of items(r.opportunities)) {
    const ref = clip(x.id, 24);
    const title = clip(x.title, LIMITS.title);
    if (!ref || !title || known.has(ref)) continue;
    // Under the outcome, or an earlier opportunity; never deeper than three levels of opportunities.
    let parent: string | null = typeof x.parent === "string" && known.get(x.parent)?.kind === "opportunity" ? x.parent : null;
    while (parent && known.get(parent)!.depth >= LIMITS.depth) parent = known.get(parent)!.parent;
    if (!fits(parent, title, parent ? LIMITS.perParent : LIMITS.topLevel)) continue;
    const evidence = items(x.evidence)
      .slice(0, 2)
      .map((e) => evidenceFrom(said, e.answerId, e.quote, now))
      .filter((e): e is OstEvidence => !!e)
      .filter((e, i, a) => a.findIndex((y) => y.text === e.text) === i);
    // What customers said elsewhere in the organization that shows the need.
    for (const id of (Array.isArray(x.pieces) ? x.pieces : []).slice(0, 3)) {
      const e = hub?.get(String(id))?.();
      if (e && !evidence.some((y) => y.text === e.text)) evidence.push(e);
    }
    const description = clip(x.description, LIMITS.description);
    known.set(ref, { kind: "opportunity", parent, depth: parent ? known.get(parent)!.depth + 1 : 1 });
    cards.push({ ref, parent, card: { v: 1, kind: "opportunity", title, stage: "exploring", createdBy: "ai", evidence, ...(description ? { description } : {}) } });
  }

  // One target at most, and only an opportunity that made it.
  const target = typeof r.recommendedTarget === "string" && known.get(r.recommendedTarget)?.kind === "opportunity" ? r.recommendedTarget : null;
  if (target) cards.find((c) => c.ref === target)!.card.stage = "target";

  let aiIdeas = 0;
  for (const x of items(r.solutions)) {
    const ref = clip(x.id, 24);
    const parent = typeof x.opportunity === "string" ? x.opportunity : "";
    const title = clip(x.title, LIMITS.title);
    if (!ref || !title || known.has(ref) || known.get(parent)?.kind !== "opportunity") continue;
    // The builder's idea when their words name it; otherwise Qalam AI's, only under the target.
    const named = evidenceFrom(said, x.answerId, x.quote, now);
    if (!named && (parent !== target || aiIdeas >= LIMITS.aiIdeas)) continue;
    if (!fits(parent, title, LIMITS.solutionsPer)) continue;
    if (!named) aiIdeas++;
    const assumptions: OstAssumption[] = items(x.assumptions)
      .slice(0, 3)
      .map((a) => ({
        id: newId(),
        category: CATEGORIES.includes(a.category as AssumptionCategory) ? (a.category as AssumptionCategory) : "desirability",
        text: clip(a.text, 200),
        importance: (a.importance === 1 || a.importance === 2 || a.importance === 3 ? a.importance : 2) as 1 | 2 | 3,
        addedBy: "ai" as const,
      }))
      .filter((a) => a.text);
    const description = clip(x.description, LIMITS.description);
    known.set(ref, { kind: "solution", parent, depth: known.get(parent)!.depth + 1 });
    cards.push({
      ref,
      parent,
      card: { v: 1, kind: "solution", title, stage: "idea", createdBy: "ai", evidence: named ? [named] : [], ...(assumptions.length ? { assumptions } : {}), ...(description ? { description } : {}) },
    });
  }

  return { summary: clip(r.summary, 600), outcome, cards };
}

/**
 * What a draft still being written already settles: the outcome once it's complete, then each
 * opportunity and solution once its object has closed (a half-written card never shows).
 */
export function partialDraft(partial: unknown, answers: InterviewAnswer[], hub?: Map<string, () => OstEvidence>): Draft {
  const r = rec(partial);
  const done = (v: unknown) => !!v && !isPartial(v);
  const closed = (v: unknown) => (Array.isArray(v) ? v.filter(done) : []);
  return sanitizeDraft(
    {
      summary: "",
      outcome: done(r.outcome) ? r.outcome : undefined,
      opportunities: closed(r.opportunities),
      solutions: closed(r.solutions),
      // Written before the solutions (Qalam AI's own ideas go under it); not while it's cut off mid-way.
      recommendedTarget: typeof r.recommendedTarget === "string" && !(isPartial(r) && partialKey(r) === "recommendedTarget") ? r.recommendedTarget : null,
    },
    answers,
    Date.now(),
    hub,
  );
}
