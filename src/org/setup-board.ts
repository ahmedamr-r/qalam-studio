import { CARD_WIDTH } from "@/discovery/kinds";
import { LANE_GAP, LANE_W } from "@/discovery/lane";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import { TREE_GAP } from "@/discovery/pass";
import { quoteEvidence, type SourceRecord, type SourceQuote } from "@/discovery/sources";
import { makeSticky } from "@/discovery/sticky";
import type { OstMetric } from "@/discovery/types";
import { emptyDoc, type Doc } from "@/doc/schema";
import type { SetupLine, SetupSession } from "./setup";
import type { QuoteHome } from "./setup-split";
import { needFor, setupGroups, titleOf } from "./setup-groups";

/*
 * A board started from the setup, built by code from what the setup read (pure): the goal as its
 * outcome, each problem the goal rests on under it (and the problems no goal took), each with every
 * quote the reading grouped under it (src/org/setup-groups.ts), and the idea (what was read as one, else at the idea door what they
 * wrote) as a solution under the problem it shares the most words with. Every card rests on the setup
 * setup's own quotes, in their own words (customers' where their doc became a source of its own), so
 * nothing is read or asked again, and the problem pages and the index connect to the same pieces. With no problem to put it under, the idea waits on a
 * sticky beside the goal.
 */

export interface SetupBoardInput {
  /** The setup's source, with every quote it read (`setupQuotes`: in its text, wherever each lives now). */
  source: Pick<SourceRecord, "id" | "title" | "kind" | "quotes"> & { text?: string };
  /** Where a quote lives now, once its doc became a source of its own: a card rests on it there. */
  homeOf?: (quoteId: string) => QuoteHome | null;
  session: Pick<SetupSession, "proposal" | "idea" | "docs" | "said" | "problems">;
  /** The goal the board is for (none: the idea's own board, its problems at the top). */
  goal?: { line: SetupLine; title: string; metric?: OstMetric | null } | null;
  now?: number;
}

/** From one tree's left edge to the next one's, when problems start trees of their own. */
const ROOT_STEP = CARD_WIDTH.opportunity + TREE_GAP + LANE_GAP + LANE_W;

export { needFor, titleOf };

export function boardFromSetup(input: SetupBoardInput): { doc: Doc; outcome: string | null; problems: string[]; ideas: string[] } {
  const { source, goal } = input;
  const now = input.now ?? Date.now();
  const byId = new Map(source.quotes.map((q) => [q.id, q]));
  const ev = (q: SourceQuote) => {
    const home = input.homeOf?.(q.id);
    return home ? quoteEvidence(home.source, home.quote, "user", { now }) : quoteEvidence(source, q, "user", { now });
  };
  const doc = emptyDoc();

  const lines = input.session.proposal?.lines.filter((l) => l.field === "goals") ?? [];
  const cited = new Set(lines.flatMap((l) => l.pieces));
  // The problems the reading saw, each with its quotes (needs it found, what customers said); a quote no group took is a problem of its own.
  const { groups, loose } = setupGroups(input.session, source.quotes);
  const all = [...groups.map((g) => ({ title: g.title, quotes: g.quotes.flatMap((id) => byId.get(id) ?? []) })), ...loose.flatMap((id) => (byId.has(id) ? [{ title: titleOf(byId.get(id)!.text), quotes: [byId.get(id)!] }] : []))];
  const needs = all
    .filter((n) => n.quotes.length)
    // The goal's own problems, and those no goal took; another goal's stay for its board.
    .filter((n) => !goal || n.quotes.some((q) => goal.line.pieces.includes(q.id)) || !n.quotes.some((q) => cited.has(q.id)))
    .sort((a, b) => a.quotes[0].span[0] - b.quotes[0].span[0]);
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
  const problems = needs.map((n, i) => {
    const node = makeCardNode(newCard("opportunity", { title: n.title, evidence: n.quotes.map(ev) }), outcome ? undefined : { x: i * ROOT_STEP, y: 0 });
    addCardIn(doc, node, outcome);
    return node.id;
  });
  const placed: string[] = [];
  // Each idea read, or what they wrote when nothing was: its words, and the pieces it rests on.
  const asIdeas = ideas.length ? ideas.map((q) => ({ text: q.text, rests: [q] })) : ownIdea ? [{ text: ownIdea, rests: source.quotes.filter((q) => said!.span && q.span[0] >= said!.span[0] && q.span[0] < said!.span[1]) }] : [];
  if (problems.length) {
    for (const idea of asIdeas) {
      const node = makeCardNode(newCard("solution", { title: titleOf(idea.text), evidence: idea.rests.map(ev) }));
      addCardIn(doc, node, problems[needFor(idea, needs.map((n) => ({ text: [n.title, ...n.quotes.map((q) => q.text)].join(" ") })))]);
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
