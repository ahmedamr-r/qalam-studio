import { isOstCard } from "@/doc/board";
import type { Doc, FrameNode } from "@/doc/schema";
import type { BriefAsked, BriefKind } from "@/discovery/brief";
import { isProblemPage } from "@/space/compose";
import { useSpaceInputs } from "@/space/session";
import type { OstCard } from "@/discovery/types";
import { sameTopic } from "@/hub/topics";
import { sentEvidence } from "./solutions";

/** What a brief is sent (server/org/briefs.ts): the card, and what's above and under it on the canvas. */

const cardOf = (doc: Doc, id: string) => (isOstCard(doc.nodes[id]) ? doc.nodes[id].meta.ost : null);
const kidsOf = (doc: Doc, id: string) => (doc.nodes[id] as FrameNode).children.filter((c) => isOstCard(doc.nodes[c]));

/** A card's problem page: a faint card is one, else the page its board's card came from, else the one of its name. */
function topicOf(doc: Doc, id: string): string | null {
  if (isProblemPage(id)) return id.split(":").slice(2).join(":") || null;
  const card = cardOf(doc, id);
  if (card?.kind !== "opportunity") return null;
  const needs = useSpaceInputs.getState().inputs?.needs ?? [];
  // Its own name first: a card can share a few quotes with many pages. Else the page it shares the most with.
  const named = needs.find((n) => sameTopic(n.title, card.title));
  if (named) return named.topic;
  const shared = (n: (typeof needs)[number]) => n.boards.find((b) => b.card === id)?.shared ?? 0;
  return [...needs].sort((a, b) => shared(b) - shared(a)).find((n) => shared(n) > 0)?.topic ?? null;
}

/** A goal's number in words: what it measures, where it stands and where it's going, only what's known. */
function metricWords(m: NonNullable<OstCard["metric"]>): string {
  const unit = m.unit ? ` ${m.unit}` : "";
  return [m.name, m.current != null ? `now ${m.current}${unit}` : "", m.target != null ? `target ${m.target}${unit}` : ""].filter(Boolean).join(", ");
}

function words(doc: Doc, id: string) {
  const c = cardOf(doc, id)!;
  return {
    title: c.title,
    description: c.description ?? "",
    assumptions: [...(c.assumptions ?? [])].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0)).map((a) => a.text),
    tests: kidsOf(doc, id).flatMap((k) => {
      const t = cardOf(doc, k);
      return t?.kind === "test" ? [{ what: t.title, how: t.test?.method ?? "", suggested: t.test?.suggested?.criterion ?? null }] : [];
    }),
    evidence: sentEvidence(c.evidence),
    topic: topicOf(doc, id),
  };
}

export function briefRequest(doc: Doc, id: string, asked: BriefAsked) {
  const card = cardOf(doc, id);
  if (!card || card.kind === "test") return null;
  const kind = card.kind as BriefKind;
  const parent = doc.nodes[id].parentId;
  let at: string | null | undefined = parent;
  while (at && isOstCard(doc.nodes[at]) && cardOf(doc, at)?.kind !== "outcome") at = doc.nodes[at].parentId;
  const goal = kind === "outcome" ? card : at ? cardOf(doc, at) : null;
  const above = parent ? cardOf(doc, parent) : null;
  // A goal's problems, not the goals under it; a problem's solutions.
  const want = kind === "outcome" ? "opportunity" : "solution";
  return {
    card: { ...words(doc, id), id, kind },
    goal: goal?.kind === "outcome" ? { title: goal.title, metric: goal.metric ? metricWords(goal.metric) : null } : null,
    problem: kind === "solution" && above?.kind === "opportunity" ? words(doc, parent!) : null,
    under: kidsOf(doc, id).filter((k) => cardOf(doc, k)?.kind === want).map((k) => words(doc, k)),
    others: kind === "solution" && parent ? kidsOf(doc, parent).filter((k) => k !== id && cardOf(doc, k)?.kind === "solution").map((k) => cardOf(doc, k)!.title) : [],
    asked,
  };
}
