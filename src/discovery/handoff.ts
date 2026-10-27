import type { BriefAnswer, BriefTopic, Doc, ProjectBrief } from "@/doc/schema";
import { isOstCard } from "@/doc/board";
import { cardOf } from "./ops";
import { opportunityPath, outcomeOf, outcomePath } from "./tree";
import { ASSUMPTION_LABEL } from "./kinds";
import type { DesignHandoff, ServesLink } from "./types";

/*
 * "Design this" (pure): what a solution carries to a Screens project. The lineage (outcome →
 * opportunities → solution), what customers said, the riskiest assumptions and the product's
 * context go along as the chat's context, so Qalam AI plans the screens with it; the Screens
 * project's Knowledge hub is seeded from it, so critiques judge the screens against the need.
 */

const SOURCE = { answer: "the builder's interview", note: "a team note", quote: "a source", dump: "the builder's brain dump" } as const;
const metricLine = (m: NonNullable<ReturnType<typeof cardOf>>["metric"]) =>
  m?.name ? `${m.name}${m.baseline !== null && m.target !== null ? `, ${m.baseline} → ${m.target}${m.unit ? ` ${m.unit}` : ""}` : ""}${m.timeframe ? ` ${m.timeframe}` : ""}` : "";

/** A short request for Qalam AI to plan from (the details travel as context). */
export function designPrompt(h: Pick<DesignHandoff, "solution" | "path" | "outcome">): string {
  const need = h.path[h.path.length - 1];
  return `Design “${h.solution.title}”${need ? `, a solution to “${need}”` : ""}${h.outcome.title ? `, to move “${h.outcome.title}”` : ""}.`.slice(0, 600);
}

/** Everything a solution takes to design, from the board as it is. */
export function buildHandoff(doc: Doc, cardId: string, from: { projectId: string; projectName: string }, now = Date.now()): DesignHandoff | null {
  const sol = cardOf(doc, cardId);
  if (!sol || sol.kind !== "solution") return null;
  const outcomeId = outcomeOf(doc, cardId);
  const outcome = outcomeId ? cardOf(doc, outcomeId) : null;
  const above = outcomePath(doc, cardId)
    .slice(0, -1)
    .map((id) => cardOf(doc, id)?.title.trim() ?? "")
    .filter(Boolean);
  const path = opportunityPath(doc, cardId);
  const evidence = [cardId, ...path.slice().reverse()]
    .flatMap((id) => (cardOf(doc, id)?.evidence ?? []).map((e) => ({ e, about: id === cardId ? ("solution" as const) : ("need" as const) })))
    // What backs the need and the solution (words against them aren't a brief to design from).
    .filter(({ e }) => e.stance !== "against")
    .filter(({ e }, i, a) => a.findIndex((x) => x.e.text === e.text) === i)
    .slice(0, 6)
    .map(({ e, about }) => ({ text: e.text, source: e.kind === "quote" && e.sourceTitle ? `${e.sourceTitle}${e.speaker ? `, ${e.speaker}` : ""}` : SOURCE[e.kind], about }));
  const assumptions = [...(sol.assumptions ?? [])]
    .sort((a, b) => (b.importance ?? 2) * (4 - (b.evidence ?? 1)) - (a.importance ?? 2) * (4 - (a.evidence ?? 1)))
    .slice(0, 6)
    .map((a) => ({ category: a.category, text: a.text }));
  const brief = doc.brief;
  const said = (id: string) => brief?.answers.find((a) => a.id === `interview:${id}`)?.answer;
  const h: DesignHandoff = {
    v: 1,
    from: { ...from, cardId },
    prompt: "",
    outcome: { title: outcome?.title ?? "", metric: metricLine(outcome?.metric) || undefined },
    ...(above.length ? { outcomes: above } : {}),
    path: path.map((id) => cardOf(doc, id)?.title ?? "").filter(Boolean),
    solution: { title: sol.title, ...(sol.description ? { description: sol.description } : {}) },
    assumptions,
    evidence,
    product: { summary: said("product"), audience: said("audience"), stage: said("stage") },
    brief: [],
    at: now,
  };
  h.prompt = designPrompt(h);
  h.brief = handoffBrief(h);
  return h;
}

/** "part of “Grow orders” › “Win back lapsed customers”": the goals a sub-outcome serves. */
const partOf = (h: Pick<DesignHandoff, "outcomes">) => (h.outcomes?.length ? `part of ${h.outcomes.map((t) => `“${t}”`).join(" › ")}` : "");

/** What seeds the Screens project's Knowledge hub (the critic reads it). */
export function handoffBrief(h: DesignHandoff): { topic: BriefTopic; question: string; answer: string }[] {
  const out: { topic: BriefTopic; question: string; answer: string }[] = [];
  const add = (topic: BriefTopic, question: string, answer: string | undefined) => answer?.trim() && out.push({ topic, question, answer: answer.trim().slice(0, 600) });
  add("goal", "What outcome should these screens move?", [h.outcome.title, h.outcome.metric, partOf(h)].filter(Boolean).join(" · "));
  add("audience", "Who is it for?", h.product.audience);
  add("problem", "What customer need does it address?", [h.path.join(" › "), ...h.evidence.filter((e) => e.about !== "solution").map((e) => `“${e.text}”`)].filter(Boolean).join(" — "));
  add("primary-action", "What's the solution?", [h.solution.title, h.solution.description].filter(Boolean).join(": "));
  add("constraints", "What has to be true for it to work?", h.assumptions.map((a) => `${ASSUMPTION_LABEL[a.category]}: ${a.text}`).join("; "));
  add("other", "What's the product?", h.product.summary);
  return out;
}

/** Merge the hand-off into a Screens project's brief: its own answers are kept, these replace earlier ones for the same solution. */
export function seedBrief(b: ProjectBrief | undefined, h: DesignHandoff, now: number): ProjectBrief {
  const base: ProjectBrief = b ?? { summary: "", answers: [], screens: {}, updatedAt: 0 };
  const prefix = `ost:${h.from.cardId}:`;
  const mine: BriefAnswer[] = h.brief.map((a, i) => ({ id: `${prefix}${a.topic}-${i}`, topic: a.topic, question: a.question, answer: a.answer, screenIds: [], at: now }));
  const summary = base.summary || [h.product.summary, h.outcome.title && `Working toward: ${h.outcome.title}.`].filter(Boolean).join(" ").slice(0, 2000);
  return { ...base, summary, answers: [...base.answers.filter((a) => !a.id.startsWith(prefix)), ...mine].slice(-40), updatedAt: now };
}

const said = (label: string, list: DesignHandoff["evidence"]) => (list.length ? `${label}: ${list.map((e) => `“${e.text}” (${e.source})`).join("; ")}` : "");

/** The hand-off as the chat's context for the plan and the screens (see chatContext.ts). */
export function handoffLines(h: DesignHandoff): string[] {
  const lines = [
    `Solution to design: “${h.solution.title}”${h.solution.description ? `: ${h.solution.description}` : ""}`,
    h.path.length ? `It addresses the customers' need “${h.path[h.path.length - 1]}”${h.path.length > 1 ? ` (within: ${h.path.slice(0, -1).map((p) => `“${p}”`).join(" › ")})` : ""}` : "",
    h.outcome.title ? `Outcome it should move: “${h.outcome.title}”${h.outcome.metric ? ` (${h.outcome.metric})` : ""}${h.outcomes?.length ? `, ${partOf(h)}` : ""}` : "",
    said("Said about the need, word for word", h.evidence.filter((e) => e.about !== "solution")),
    said("Said about this solution, word for word", h.evidence.filter((e) => e.about === "solution")),
    h.assumptions.length ? `Riskiest assumptions, to make testable in the screens: ${h.assumptions.map((a) => `${ASSUMPTION_LABEL[a.category].toLowerCase()}: ${a.text}`).join("; ")}` : "",
    h.product.summary ? `Product: ${h.product.summary}` : "",
    h.product.audience ? `For: ${h.product.audience}` : "",
  ];
  return lines.filter(Boolean).map((l) => l.slice(0, 700));
}

/** Screens made for Discovery solutions, from a Screens document (counted on its record). */
export function servesSummary(doc: Doc): ServesLink[] {
  const by = new Map<string, ServesLink>();
  for (const id of doc.roots) {
    const s = doc.nodes[id]?.meta.serves;
    if (!s || isOstCard(doc.nodes[id])) continue;
    const k = `${s.projectId}:${s.cardId}`;
    const cur = by.get(k) ?? { projectId: s.projectId, cardId: s.cardId, frames: 0, first: id };
    cur.frames++;
    by.set(k, cur);
  }
  return [...by.values()];
}
