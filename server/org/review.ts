import { REVIEW_SYSTEM, reviewSchema } from "@/ai/review";
import { structured } from "@/ai/server";
import { contextText } from "@/org/context-md";
import type { CheckBoard, Notice } from "@/hub/checks";
import { reviewMaterial, sanitizeReview } from "@/hub/review";
import { voicesByQuote } from "@/hub/people";
import { noticesNow } from "./notices";
import type { OrgStore } from "./store";

/** Reviews run on the generation model (Opus 5.5 by default), like the boards' calls. */
const REVIEW_MODEL = process.env.DISCOVERY_MODEL || process.env.GENERATE_MODEL || "claude-opus-5-5";

/**
 * Review now: Qalam AI reads the organization (its topic pages, boards and recent decisions) for
 * what needs a look that code's checks can't count, told what they already found so it doesn't
 * repeat them. Code keeps a finding only when it rests on what was sent (src/hub/review.ts), and
 * the findings join the organization's notices, replacing the last review's.
 */
export async function reviewOrg(store: OrgStore, opts: { tab?: string } = {}): Promise<Notice[]> {
  const boards: CheckBoard[] = [];
  for (const p of store.listProjects()) {
    if (p.type !== "discovery") continue;
    boards.push({ id: p.id, name: p.name, product: p.product ?? null, createdAt: p.createdAt, doc: (await store.getDoc(p.id).catch(() => null))?.doc ?? null });
  }
  const products = await store.listProducts();
  const flagged = (await noticesNow(store)).notices.filter((n) => n.kind !== "review").map((n) => n.title);
  const org = [contextText(await store.getAbout(), `${store.info.name}:`), ...products.map((p) => contextText(p, `${p.name} (a product):`))].filter(Boolean).join("\n\n");
  const voices = voicesByQuote(await store.listSources(), await store.listPeople());
  const m = reviewMaterial({ org: org.slice(0, 4000), topics: await store.listTopics(), boards, decisions: store.listDecisions(), flagged, productName: (id) => products.find((p) => p.id === id)?.name, voices });
  const { data } = await structured<unknown>({ model: REVIEW_MODEL, system: REVIEW_SYSTEM, schema: reviewSchema(m), effort: "high", maxTokens: 16000, content: [{ type: "text", text: m.text }] });
  const findings = sanitizeReview(data, m, Date.now());
  await store.addFindings(findings, opts);
  return findings;
}
