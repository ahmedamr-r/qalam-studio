import { marketContext } from "@/market/text";
import { contextText } from "@/org/context-md";
import { termsText } from "@/terms/text";
import type { OrgStore } from "./store";

/**
 * What a draft hears about the company: its About, the project's own words, and the facts and
 * competitors known beyond it. The words come before the market, so a long market is what's cut.
 */
export async function companyContext(store: OrgStore, o: { near?: string } = {}): Promise<string> {
  const org = store.info.name;
  const about = contextText(await store.getAbout(), `${org}:`);
  const words = termsText(await store.getTerms(), { max: 800, near: o.near });
  return [about, words, marketContext(await store.getMarket(), { org, told: about })].filter(Boolean).join("\n").slice(0, 2400);
}
