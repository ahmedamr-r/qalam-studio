import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { setEngineState } from "@/ai/engine";
import { briefRound } from "@/discovery/brief";
import { sanitizePlace, type PlaceContext } from "@/discovery/place";
import { saysNoIdea } from "@/scan/input";
import { answerOf, answerWords, initialFlow, reduceFlow, summarize, type FlowState } from "@/ui/ai/questionFlow";
import { sanitizeAsked, toQuestion } from "@/ui/ai/plan";
import { findClaude } from "../../server/claude";
import { writeCardBrief } from "../../server/org/briefs";
import { OrgStore } from "../../server/org/store";
import { planLimits } from "../../server/limits";

/**
 * What the stress tests found, each held with no model call, so they can be run again whenever the
 * code changes. "fixed" is what's true now; "OPEN" is what the first run of these tests found and is
 * still so. Not fixed yet on purpose: the brief still drops all but the riskiest assumption, and has no
 * non-goals, rollout or edge cases, since a fresh reader had about as many blockers on it as on a PRD.
 */

const line = (fixed: boolean, what: string, got: unknown) => console.log(`${fixed ? "fixed" : "OPEN "}  ${what}\n       ${JSON.stringify(got)}`);

async function main() {
  // A hard-coded question with no recommendation shows none.
  const [who] = briefRound("steps");
  const shown = toQuestion(who);
  line(!("suggested" in shown) && !("recommended" in shown), `"${who.title}" has no recommendation, and shows none`, { written: who.recommended });

  // Enter on a card nobody touched records nothing.
  const q = toQuestion({ id: "q", title: "Do first orders often have problems?", why: "", multi: false, options: [{ value: "a", label: "Yes, often", description: "" }, { value: "b", label: "Rarely", description: "" }], recommended: ["a"], allowOther: true });
  const flow: FlowState = initialFlow([q]);
  const after = reduceFlow(flow, { type: "next" }, [q], false);
  const said = summarize(q, answerOf(q, after.state.answers));
  line(said === "—" && !after.error, "Enter on a card nobody touched answers nothing, and isn't refused", { said, error: after.error ?? null });

  // "I don't know", pressed or typed, is an answer of its own, and never words a card may quote.
  const open = toQuestion({ id: "o", title: "What's the failure rate by segment?", why: "", multi: false, options: [], recommended: [], allowOther: true });
  const pressed = answerWords(open, answerOf(open, reduceFlow(initialFlow([open]), { type: "unknown" }, [open], false).state.answers));
  const typedIt = answerWords(open, { kind: "text", text: "I don't know yet, I've only been here two weeks" });
  line(pressed.how === "unknown" && typedIt.how === "unknown" && !pressed.typed && !typedIt.typed, "\"I don't know\" is its own answer, pressed or typed, and never a quote", { pressed, typed: typedIt });

  // A number is asked for, not bucketed.
  const asked = sanitizeAsked([{ id: "c", title: "Monthly churn?", why: "", multi: false, options: ["Under 3%", "3–7%", "Over 7%", "Don't know"].map((label, i) => ({ value: `o${i}`, label, description: "" })), recommended: [], allowOther: false }])[0];
  line(!asked.options.length, "A question of number is asked open, so 3.1% stays 3.1%", { options: asked.options.length });

  // What the focus flow proposes under a goal stays, with or without words behind it.
  const goal = { ref: "c1", id: "goal", kind: "outcome", title: "More parents reorder", parentRef: null, depth: 0, outcomeDepth: 1, root: "goal", childTitles: [], description: "", assumptions: [], designs: false };
  const ctx = { cards: [goal], pieces: [], sourceId: "s", answers: [{ ref: "a1", answerId: "dump:s:q", words: "Freshness or substitutions" }], said: "", settled: new Set<string>(), has: () => false, anchor: "goal", looseProblems: false, keepBare: true } as unknown as PlaceContext;
  const need = (id: string, title: string, answers: unknown[]) => ({ id, kind: "opportunity", parentCard: "c1", parentNew: null, title, description: "", fragmentIds: [], answers, why: "their tickets" });
  const kept = sanitizePlace({ cards: [need("n1", "Fresh food arrives in poor condition", [{ answerId: "a1", quote: "Freshness or substitutions" }]), need("n2", "Items get swapped or go missing", [])] }, ctx, new Map());
  line(kept.length === 2, "Problems asked for under a goal stay: one on a choice they picked, one with nothing behind it", { kept: kept.length });

  // Lines read on the web stay others' words.
  const base = path.resolve(".qalam-dev/stress");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, "proof-"));
  const store = await OrgStore.create(dir, { id: "proof", name: "Proof", createdAt: Date.now() } as never);
  try {
    const card = { title: "A solution", description: "It does a thing.", assumptions: ["It might not work", "Nor this", "Nor that"], tests: [], evidence: [{ text: "Sales-assisted products see much higher activation rates.", kind: "read", sourceTitle: "A vendor's blog", url: "https://v.example/post" }], topic: null };
    const meta = await writeCardBrief(store, { card: { ...card, id: "c", kind: "solution" }, goal: { title: "A goal", metric: "A metric, now 31, target 40" }, problem: null, under: [], others: [], asked: {} }, undefined, { structured: (async () => ({ data: { features: [] } })) as never });
    const body = (await store.getBrief(meta.id))?.body ?? "";
    line(!/Sales-assisted[^\n]*Your words/.test(body) && body.includes("Read elsewhere"), "A line read on a vendor's blog reaches the brief as read elsewhere, with its page", { line: body.split("\n").find((l) => l.includes("Sales-assisted")) });
    line(body.includes("Nor this"), "The brief keeps every assumption, not only the riskiest", { kept: body.includes("It might not work"), others: body.includes("Nor this") });
    line(/non-goal|rollout|edge case/i.test(body), "The brief has non-goals, rollout and edge cases", { headings: body.split("\n").filter((l) => /^#{1,3} /.test(l)) });
  } finally {
    store.dispose();
  }

  // Plain words saying there's no idea need no call. The rest is the small call's to say (server/org/scan.ts).
  line(saysNoIdea("no idea"), `"no idea" isn't read as an idea`, { said: "no idea" });

  // What the plan has left, read with no model call.
  setEngineState({ kind: "cli", bin: process.env.CLAUDE_CLI_PATH || findClaude() || "claude" });
  const l = await planLimits(true).catch(() => null);
  console.log("\nPlan:", l ? JSON.stringify({ plan: l.plan, rows: l.rows.map((r) => ({ label: r.label, percent: r.percent, resets: r.resetsAt ? new Date(r.resetsAt).toISOString() : null })), reached: l.reached ?? null }) : "couldn't read it");
}

process.env.QALAM_HOME ??= path.resolve(".qalam-dev/stress/home");
process.env.QALAM_NO_MODELS ??= "1";
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  },
);
