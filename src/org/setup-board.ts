import { CARD_WIDTH } from "@/discovery/kinds";
import { LANE_GAP, LANE_W } from "@/discovery/lane";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import { TREE_GAP } from "@/discovery/pass";
import { quoteEvidence, type SourceRecord, type SourceQuote } from "@/discovery/sources";
import { makeSticky } from "@/discovery/sticky";
import type { OstMetric } from "@/discovery/types";
import { emptyDoc, type Doc } from "@/doc/schema";
import type { SetupLine, SetupSession } from "./setup";

/*
 * A board started from the setup, built by code from what the setup read (pure): the goal as its
 * outcome, each problem the goal rests on under it (and the problems no goal took: a need it found,
 * or what customers said), and the idea (what was read as one, else at the idea door what they
 * wrote) as a solution under the problem it shares the most words with. Every card rests on the setup
 * source's own quotes, in their own words, so nothing is read or asked again, and the problem pages
 * and the index connect to the same pieces. With no problem to put it under, the idea waits on a
 * sticky beside the goal.
 */

export interface SetupBoardInput {
  source: Pick<SourceRecord, "id" | "title" | "kind" | "quotes"> & { text?: string };
  session: Pick<SetupSession, "proposal" | "idea" | "docs" | "said">;
  /** The goal the board is for (none: the idea's own board, its problems at the top). */
  goal?: { line: SetupLine; title: string; metric?: OstMetric | null } | null;
  now?: number;
}

const TITLE_MAX = 160;
/** From one tree's left edge to the next one's, when problems start trees of their own. */
const ROOT_STEP = CARD_WIDTH.opportunity + TREE_GAP + LANE_GAP + LANE_W;

/** A card's title from someone's words: whole words, the first sentence when it's long. */
export function titleOf(words: string): string {
  const one = words.replace(/\s+/g, " ").trim();
  if (one.length <= TITLE_MAX) return one;
  const first = one.split(/(?<=[.!?])\s/)[0];
  if (first.length <= TITLE_MAX) return first;
  const cut = one.slice(0, TITLE_MAX);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 80 ? cut.lastIndexOf(" ") : TITLE_MAX).trim()}…`;
}

const STOP = new Set("about after also and are because been but can could did does for from had has have her his how into its just like more most much not now only our out over some such than that the their them then there these they this those very was were what when where which while who why will with would your you".split(" "));
const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)));

/** The need an idea answers: the one sharing the most words with it, else the first. */
export function needFor(idea: Pick<SourceQuote, "text">, needs: readonly Pick<SourceQuote, "text">[]): number {
  const mine = words(idea.text);
  let best = 0;
  let score = 0;
  needs.forEach((n, i) => {
    const shared = [...words(n.text)].filter((w) => mine.has(w)).length;
    if (shared > score) {
      score = shared;
      best = i;
    }
  });
  return best;
}

export function boardFromSetup(input: SetupBoardInput): { doc: Doc; outcome: string | null; problems: string[]; ideas: string[] } {
  const { source, goal } = input;
  const now = input.now ?? Date.now();
  const byId = new Map(source.quotes.map((q) => [q.id, q]));
  const ev = (q: SourceQuote) => quoteEvidence(source, q, "user", { now });
  const doc = emptyDoc();

  const lines = input.session.proposal?.lines.filter((l) => l.field === "goals") ?? [];
  const cited = new Set(lines.flatMap((l) => l.pieces));
  const needs = source.quotes
    // A need it found, or what customers said: their words are the problem in their terms.
    .filter((q) => q.role === "need" || q.role === "evidence")
    // The goal's own problems, and those no goal took; another goal's stay for its board.
    .filter((q) => !goal || goal.line.pieces.includes(q.id) || !cited.has(q.id))
    .sort((a, b) => a.span[0] - b.span[0]);
  const ideas = source.quotes.filter((q) => q.role === "idea").sort((a, b) => a.span[0] - b.span[0]);
  // The idea door: with nothing read as an idea, what they wrote is the idea (resting on what was read in it).
  const said = input.session.docs?.find((d) => d.from === "said" && d.span);
  const ownIdea = !ideas.length && input.session.idea && said?.span ? (source.text?.slice(said.span[0], said.span[1]).trim() || input.session.said?.trim() || "") : "";

  let outcome: string | null = null;
  if (goal) {
    const node = makeCardNode(newCard("outcome", { title: goal.title, ...(goal.metric ? { metric: goal.metric } : {}), evidence: goal.line.pieces.flatMap((id) => (byId.has(id) ? [ev(byId.get(id)!)] : [])) }));
    addCardIn(doc, node, null);
    outcome = node.id;
  }
  // With no goal above them, each problem is a tree of its own: side by side, with room for each one's sources lane.
  const problems = needs.map((q, i) => {
    const node = makeCardNode(newCard("opportunity", { title: titleOf(q.text), evidence: [ev(q)] }), outcome ? undefined : { x: i * ROOT_STEP, y: 0 });
    addCardIn(doc, node, outcome);
    return node.id;
  });
  const placed: string[] = [];
  // Each idea read, or what they wrote when nothing was: its words, and the pieces it rests on.
  const asIdeas = ideas.length ? ideas.map((q) => ({ text: q.text, rests: [q] })) : ownIdea ? [{ text: ownIdea, rests: source.quotes.filter((q) => said!.span && q.span[0] >= said!.span[0] && q.span[0] < said!.span[1]) }] : [];
  if (problems.length) {
    for (const idea of asIdeas) {
      const node = makeCardNode(newCard("solution", { title: titleOf(idea.text), evidence: idea.rests.map(ev) }));
      addCardIn(doc, node, problems[needFor(idea, needs)]);
      placed.push(node.id);
    }
  } else
    asIdeas.forEach((idea, i) => {
      // No problem to put it under yet: it waits beside the goal, in their words.
      const { frame, text } = makeSticky({ x: -260, y: 80 + i * 160 });
      text.text = { ...text.text, content: `Your idea: ${titleOf(idea.text)}` };
      doc.nodes[frame.id] = frame;
      doc.nodes[text.id] = text;
      doc.roots.push(frame.id);
      placed.push(frame.id);
    });
  return { doc, outcome, problems, ideas: placed };
}
