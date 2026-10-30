import { LEARN_SYSTEM, learnSchema } from "@/ai/learn";
import { structured } from "@/ai/server";
import type { CheckBoard } from "@/hub/checks";
import { learnItems, learnMaterial, planToMarkdown, sanitizePlan, type LearnItem, type LearnPlan } from "@/hub/learn";
import { voicesByQuote } from "@/hub/people";
import { contextText } from "@/org/context-md";
import type { OrgStore } from "./store";

const MODEL = process.env.DISCOVERY_MODEL || process.env.GENERATE_MODEL || "claude-opus-5-5";

export interface LearnResult {
  /** What code found the organization doesn't know yet. */
  items: LearnItem[];
  /** Qalam AI's plan, as code kept it (null: nothing held up, or nothing to plan). */
  plan: LearnPlan | null;
  /** The plan as a page, ready to save. */
  markdown: string | null;
  title: string;
}

/**
 * What to learn next, for a product or the whole organization: code gathers the gaps
 * (src/hub/learn.ts), Qalam AI plans who to talk to, what to ask and what to test, code keeps
 * what rests on the gaps it cites. Without `plan`, or with nothing open, no call is made: the gaps
 * alone cost no tokens.
 */
export async function learnNext(store: OrgStore, o: { product: string | null; plan?: boolean }): Promise<LearnResult> {
  const products = await store.listProducts();
  const about = await store.getAbout();
  const product = o.product ? products.find((p) => p.id === o.product) : undefined;
  const boards: CheckBoard[] = [];
  for (const p of store.listProjects()) {
    if (p.type !== "discovery") continue;
    boards.push({ id: p.id, name: p.name, product: p.product ?? null, createdAt: p.createdAt, doc: (await store.getDoc(p.id).catch(() => null))?.doc ?? null });
  }
  const segments = [...(product?.segments ?? []), ...about.segments, ...(product ? [] : products.flatMap((p) => p.segments))];
  const voices = voicesByQuote(await store.listSources(), await store.listPeople());
  const now = Date.now();
  const items = learnItems({ boards, topics: await store.listTopics(), voices, segments, now, product: o.product });
  const title = `What to learn next${product ? ` for ${product.name}` : ""}`;
  if (!items.length || !o.plan) return { items, plan: null, markdown: null, title };
  const context = [product ? contextText(product, `The product (${product.name}):`) : "", contextText(about, `The organization (${store.info.name}):`)].filter(Boolean).join("\n\n");
  const m = learnMaterial({ items, context, segments });
  const { data } = await structured<unknown>({ model: MODEL, system: LEARN_SYSTEM, schema: learnSchema({ ids: m.ids }), effort: "high", maxTokens: 10000, content: [{ type: "text", text: m.text }] });
  const plan = sanitizePlan(data, m);
  return { items, plan, markdown: plan ? planToMarkdown(plan, { title, at: now, items: m.items }) : null, title };
}
