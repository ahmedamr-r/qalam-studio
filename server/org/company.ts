import { marketContext } from "@/market/text";
import { contextText } from "@/org/context-md";
import type { OrgStore } from "./store";

/** What a draft hears about the company: its About, and the facts and competitors known beyond it. */
export async function companyContext(store: OrgStore): Promise<string> {
  const org = store.info.name;
  const about = contextText(await store.getAbout(), `${org}:`);
  return [about, marketContext(await store.getMarket(), { org, told: about })].filter(Boolean).join("\n").slice(0, 2400);
}
