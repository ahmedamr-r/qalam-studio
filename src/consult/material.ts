import { canvasLines, type OutlineCard } from "@/space/plan";
import { situationLine, type Level, type Situation } from "./situation";

/*
 * What a consultant's turn reads (pure): what they said, who's asking and how much they know, how the
 * business works as the page has it, the company, and what's on their canvas. Before they've answered
 * anything, it's told to ask first.
 */

const one = (s: string) => s.replace(/\s+/g, " ").trim();

export function consultMaterial(o: { org: string; said: string; situation: Situation; level: Level; business: string; company: string; outline: readonly OutlineCard[]; answered: boolean; screens?: readonly string[] }): string {
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
    // Screens they showed before: ask whether they still look so, rather than for them again.
    ...(o.screens?.length ? ["", "Screens they showed before (kept with their screens; ask whether they still look like this rather than for them again):", ...o.screens.map((s) => `- ${one(s)}`)] : []),
    ...(o.answered ? [] : ["", "They haven't answered anything yet: ask first, and look nothing up this turn."]),
  ].join("\n");
}

/** The screens kept for the project, a line a flow (its screens in order) and a line for the screens in none, at most a few. */
export function keptScreens(maps: readonly { flows: readonly { name: string; steps: readonly string[] }[]; screens: readonly { key: string; name: string }[] }[], max = 6): string[] {
  const out: string[] = [];
  for (const m of maps) {
    const name = (k: string) => m.screens.find((s) => s.key === k)?.name ?? k;
    for (const f of m.flows) out.push(`${f.name}: ${f.steps.map(name).join(" → ")}`);
    const inFlows = new Set(m.flows.flatMap((f) => f.steps));
    const alone = m.screens.filter((s) => !inFlows.has(s.key)).map((s) => s.name);
    if (alone.length) out.push(`Screens on their own: ${alone.slice(0, 8).join(", ")}`);
  }
  return out.slice(0, max);
}
