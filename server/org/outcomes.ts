import { OUTCOMES_SYSTEM, outcomesSchema } from "@/ai/outcomes";
import { structured } from "@/ai/server";
import { metricText } from "@/discovery/dump";
import { voicesByQuote } from "@/hub/people";
import { outcomesMaterial, sanitizeOutcomes, type OutcomeCandidate } from "@/hub/outcomes";
import { contextText } from "@/org/context-md";
import { statedGoals } from "@/org/goals";
import { NotFoundError, type OrgStore } from "./store";

const MODEL = process.env.DISCOVERY_MODEL || process.env.GENERATE_MODEL || "claude-opus-5-5";

/** A customer's words a need page rests on, as a board's card would carry them. */
export interface NeedQuote {
  piece: string;
  text: string;
  sourceId: string;
  sourceTitle: string;
  speaker?: string;
  span: [number, number];
}

export interface OutcomeProposal {
  candidates: OutcomeCandidate[];
  /** Each need the candidates rest on: its title and the quotes its "We know" lines cite. */
  needs: Record<string, { title: string; quotes: NeedQuote[] }>;
  note?: string;
}

/**
 * Which outcomes would move a stated goal: Qalam AI reads the goal, what the organization says
 * about itself, the outcomes boards already work on and the need pages (with how many people raise
 * each), and proposes a few; code keeps those resting on what it cites (src/hub/outcomes.ts).
 * Each comes with its needs' quotes, so a board started from it rests on customers' words.
 */
export async function proposeOutcomes(store: OrgStore, o: { product: string | null; goal: string }): Promise<OutcomeProposal> {
  const about = await store.getAbout();
  const products = await store.listProducts();
  const g = statedGoals(about, products).find((x) => x.goal.id === o.goal && x.product === o.product);
  if (!g) throw new NotFoundError("No such goal");
  const product = g.product ? products.find((p) => p.id === g.product) : undefined;
  const context = [product ? contextText(product, `The product (${product.name}):`) : "", contextText(about, `The organization (${store.info.name}):`)].filter(Boolean).join("\n\n");
  const sources = await store.listSources();
  const voices = voicesByQuote(sources, await store.listPeople());
  const topics = await store.listTopics();
  const outcomes = (await store.listGoals()).filter((x) => !x.parent && (!g.product || !x.product || x.product === g.product)).map((x) => ({ title: x.title, board: x.boardName, ...(metricText(x.metric) ? { metric: metricText(x.metric)! } : {}) }));
  const m = outcomesMaterial({ goal: g.goal, owner: product?.name ?? store.info.name, context, topics, voices, outcomes, product: g.product });
  const { data } = await structured<unknown>({ model: MODEL, system: OUTCOMES_SYSTEM, schema: outcomesSchema({ ids: m.ids, needs: [...m.needs.keys()] }), effort: "high", maxTokens: 12000, content: [{ type: "text", text: m.text }] });
  const { candidates, note } = sanitizeOutcomes(data, m);

  // The quotes behind each need: what its "We know" lines cite, found in the sources.
  const quoteOf = new Map<string, { s: (typeof sources)[number]; q: (typeof sources)[number]["quotes"][number] }>(sources.flatMap((s) => s.quotes.map((q) => [`hub:quote:${q.id}`, { s, q }] as const)));
  const needs: OutcomeProposal["needs"] = {};
  for (const id of new Set(candidates.flatMap((c) => c.needs))) {
    const t = topics.find((x) => x.id === id);
    if (!t) continue;
    const refs = [...new Set(t.lines.filter((l) => l.section === "know").flatMap((l) => l.cites))];
    const quotes = refs.flatMap((ref): NeedQuote[] => {
      const hit = quoteOf.get(ref);
      if (!hit || hit.s.kind === "dump") return [];
      return [{ piece: ref, text: hit.q.text, sourceId: hit.s.id, sourceTitle: hit.s.title, span: hit.q.span, ...(hit.q.speaker ? { speaker: hit.q.speaker } : {}) }];
    });
    needs[id] = { title: t.title, quotes: quotes.slice(0, 8) };
  }
  return { candidates, needs, ...(note ? { note } : {}) };
}
