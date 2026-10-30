import { sameWords } from "@/hub/topics";
import { ASSUMPTION_CATEGORIES } from "./kinds";
import { newCard } from "./ops";
import type { Proposal } from "./proposals";
import { draftWords, type DraftAssumption, type DraftTest } from "./solutions";
import type { OstAssumption } from "./types";

/*
 * Drafting a solution's tests (pure): Qalam AI reads the solution, the problem it's under, the goal
 * and the words they rest on, and proposes what has to be true for it to work (its riskiest
 * assumptions, none it has already) and one cheap test of the riskiest. Code keeps an assumption
 * only when its quoted words and numbers are in what was sent; a test is a plan, so its own numbers
 * are Qalam AI's suggestion, and its pass line is never kept as fact (only the person sets the bar).
 * On the board they're proposals: the assumptions onto the solution, the test as a card under it.
 */

export const TEST_LIMITS = { assumptions: 4, pieces: 16, existing: 8, assumption: 240, what: 160, how: 360, pass: 240, note: 480 } as const;

export interface TestsInput {
  solution: { title: string; description: string; assumptions: string[]; tests: string[] };
  problem: { title: string } | null;
  goal: { title: string; metric: string | null } | null;
  /** The words the solution and its problem rest on: customers' and the team's. */
  pieces: { ref: string; text: string; label: string; evidence: boolean }[];
}

type Piece = TestsInput["pieces"][number];

export interface TestsSent {
  text: string;
  pieces: Map<string, Piece>;
  existing: string[];
  /** Every word it was sent: what an assumption's quoted words and numbers must come from. */
  hay: string;
}

export interface TestsDrafted {
  assumptions: DraftAssumption[];
  test: DraftTest | null;
  note: string;
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();

/** The material, the words with the ids the call cites them by (q…), customers' first. */
export function testsMaterial(o: TestsInput): TestsSent {
  const out = [`The solution: “${one(o.solution.title)}”`];
  if (o.solution.description.trim()) out.push(`What it does: ${one(o.solution.description)}`);
  if (o.problem) out.push(`The problem it's for: “${one(o.problem.title)}”`);
  if (o.goal) out.push(`The goal: “${one(o.goal.title)}”${o.goal.metric ? ` (${one(o.goal.metric)})` : ""}`);
  const pieces = new Map<string, Piece>();
  const cited = [...o.pieces.filter((p) => p.evidence), ...o.pieces.filter((p) => !p.evidence)].slice(0, TEST_LIMITS.pieces);
  out.push("", "The words they rest on (id · whose · where · words):");
  for (const p of cited) {
    const id = `q${pieces.size + 1}`;
    pieces.set(id, p);
    out.push(`- ${id} · ${p.evidence ? "customers" : "the team"} · ${one(p.label)} · “${one(p.text)}”`);
  }
  if (!pieces.size) out.push("(no words yet: it rests on what the team believes)");
  const existing = o.solution.assumptions.slice(0, TEST_LIMITS.existing);
  if (existing.length) out.push("", "What it assumes already (don't propose these again):", ...existing.map((a) => `- ${one(a)}`));
  if (o.solution.tests.length) out.push("", "Its tests already:", ...o.solution.tests.slice(0, TEST_LIMITS.existing).map((t) => `- ${one(t)}`));
  const text = out.join("\n");
  return { text, pieces, existing, hay: text.replace(/(^|\s)q\d+ ·/gm, "$1") };
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** What code keeps: new assumptions it can stand behind, the riskiest first, and a test of one of them. */
export function sanitizeTests(raw: unknown, m: TestsSent, o: { id: () => string }, dropped?: (why: string, item: unknown) => void): TestsDrafted {
  const drop = (why: string, x: unknown) => void dropped?.(why, x);
  const words = draftWords(m.hay, () => undefined, "q");
  const have = new Set(m.existing.map(sameWords));
  const assumptions: DraftAssumption[] = [];
  const kept = new Map<number, string>();
  (Array.isArray(rec(raw).assumptions) ? (rec(raw).assumptions as unknown[]) : []).forEach((x, i) => {
    const a = rec(x);
    if (assumptions.length >= TEST_LIMITS.assumptions) return drop("over the limit", x);
    const category = ASSUMPTION_CATEGORIES.find((c) => c === a.category);
    const text = words(a.text, TEST_LIMITS.assumption);
    if (!category || !text) return drop("its words or numbers aren't in what was sent", x);
    if (have.has(sameWords(text)) || assumptions.some((y) => sameWords(y.text) === sameWords(text))) return drop("it assumes that already", x);
    const id = o.id();
    kept.set(i + 1, id);
    assumptions.push({ id, category, text, importance: a.importance === "1" ? 1 : a.importance === "2" ? 2 : 3 });
  });
  const t = rec(rec(raw).test);
  const what = words(t.what, TEST_LIMITS.what, true);
  const how = words(t.how, TEST_LIMITS.how, true);
  const pass = words(t.pass, TEST_LIMITS.pass, true);
  const riskiest = [...assumptions].sort((a, b) => b.importance - a.importance)[0];
  const named = kept.get(Number(typeof t.assumption === "string" ? t.assumption : NaN));
  const target = named ?? riskiest?.id;
  const test: DraftTest | null = what && how && target ? { assumption: target, what, how, suggested: pass } : null;
  if (!test && rec(raw).test) drop("its test's words or numbers aren't in what was sent, or it tests nothing kept", rec(raw).test);
  const said = typeof rec(raw).note === "string" ? words(rec(raw).note, TEST_LIMITS.note) : null;
  const short = !assumptions.length ? "Qalam AI found nothing new it could stand behind." : "";
  return { assumptions, test, note: [said ?? "", short].filter(Boolean).join(" ") };
}

/** The drafted assumptions onto the solution, and the test as a card under it (one draft: accepting the test takes its assumptions along). */
export function testProposals(d: TestsDrafted, solutionId: string, newId: () => string, key = newId()): Proposal[] {
  if (!d.assumptions.length) return [];
  const assumptions: OstAssumption[] = d.assumptions.map((a) => ({ id: a.id, category: a.category, text: a.text, importance: a.importance, addedBy: "ai" }));
  const out: Proposal[] = [{ id: `assume:${key}`, kind: "assumption", cardId: solutionId, assumptions, why: "What has to be true for it to work, the riskiest first" }];
  if (d.test) {
    const card = newCard("test", { title: d.test.what, createdBy: "ai", test: { assumptionIds: [d.test.assumption], method: d.test.how, ...(d.test.suggested ? { suggested: { criterion: d.test.suggested } } : {}) } });
    out.push({ id: `test:${key}`, kind: "card", cardId: newId(), parentId: solutionId, card, backing: { quotes: [], words: [] }, why: d.test.how });
  }
  return out;
}
