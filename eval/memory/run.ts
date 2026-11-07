import { readFileSync } from "node:fs";
import path from "node:path";
import { matchQuestions } from "@/memory/match";

/**
 * pnpm eval:memory: how the memory's question matcher (src/memory/match.ts) reads question pairs the
 * persona bench asked, each labelled by hand: the same question (in other words), a related one (same
 * subject, another ask), or a different one. No model calls. What matters: an exact match is only ever
 * the same question (only exact may stand in for asking), and a near one is rarely a different one
 * (near only shows what was said beside the question). Change the matcher only with this before and after.
 */

type Label = "same" | "related" | "different";
const pairs = JSON.parse(readFileSync(path.resolve("eval/memory/pairs.json"), "utf8")) as { person: string; a: string; b: string; label: Label }[];
const table: Record<Label, Record<string, number>> = { same: {}, related: {}, different: {} };
const wrong: string[] = [];
for (const p of pairs) {
  const m = matchQuestions(p.a, p.b) ?? "none";
  table[p.label][m] = (table[p.label][m] ?? 0) + 1;
  if ((m === "exact" && p.label !== "same") || (m !== "none" && p.label === "different")) wrong.push(`${m} on ${p.label}: “${p.a.slice(0, 70)}” / “${p.b.slice(0, 70)}”`);
}
const n = (l: Label, m: string) => table[l][m] ?? 0;
console.log(`${pairs.length} pairs from the bench, labelled by hand\n`);
console.log("            exact   near   none");
for (const l of ["same", "related", "different"] as const) console.log(`${l.padEnd(10)}  ${String(n(l, "exact")).padStart(5)}  ${String(n(l, "near")).padStart(5)}  ${String(n(l, "none")).padStart(5)}`);
const exact = n("same", "exact") + n("related", "exact") + n("different", "exact");
const shown = exact + n("same", "near") + n("related", "near") + n("different", "near");
console.log(`\nExact is the same question: ${n("same", "exact")} of ${exact}`);
console.log(`Shown beside a different question: ${n("different", "near") + n("different", "exact")} of ${shown}`);
console.log(`Same questions found (exact or near): ${n("same", "exact") + n("same", "near")} of ${n("same", "exact") + n("same", "near") + n("same", "none")}`);
if (wrong.length) console.log(`\nMisreadings:\n  ${wrong.join("\n  ")}`);
