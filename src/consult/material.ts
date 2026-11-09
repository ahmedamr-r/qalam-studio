import { canvasLines, type OutlineCard } from "@/space/plan";
import { situationLine, type Level, type Situation } from "./situation";

/*
 * What a consultant's turn reads (pure): what they said, who's asking and how much they know, how the
 * business works as the page has it, the company, and what's on their canvas. Before they've answered
 * anything, it's told to ask first.
 */

const one = (s: string) => s.replace(/\s+/g, " ").trim();

export function consultMaterial(o: { org: string; said: string; situation: Situation; level: Level; business: string; company: string; outline: readonly OutlineCard[]; answered: boolean }): string {
  const ids = new Map(o.outline.map((c, i) => [c.id, `c${i + 1}`]));
  return [
    `What they said: “${one(o.said)}”`,
    "",
    situationLine({ ...o.situation, level: o.level }),
    "",
    o.business.trim() || "How the business works: nothing kept yet. Learn only what this needs.",
    "",
    `The company or project: “${o.org}”`,
    ...(o.company.trim() ? [o.company.trim()] : []),
    "",
    "What's on their canvas:",
    ...(o.outline.length ? canvasLines(o.outline, (id) => ids.get(id)) : ["(nothing yet)"]),
    ...(o.answered ? [] : ["", "They haven't answered anything yet: ask first, and look nothing up this turn."]),
  ].join("\n");
}
