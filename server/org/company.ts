import { businessText } from "@/business/text";
import { marketContext } from "@/market/text";
import { contextText } from "@/org/context-md";
import { termsText } from "@/terms/text";
import type { OrgStore } from "./store";

/**
 * How the business works (business.md), as a call hears it, or as a web search may: what the business
 * is and how it reaches people, with no costs, numbers or figures (`research`). Callers put it after
 * what quotes and numbers are checked against: it's context, never evidence.
 */
export async function businessFor(store: OrgStore, o: { for: "call" | "research"; max: number }): Promise<string> {
  return businessText(await store.getBusiness(), { org: store.info.name, max: o.max, research: o.for === "research" });
}

/** What a web search hears of the organization: its About line, then what the business is, with no figures. */
export async function researchAbout(store: OrgStore, about: string): Promise<string> {
  return [about, await businessFor(store, { for: "research", max: 400 })].filter((x) => x.trim()).join("\n");
}

/**
 * What a draft hears about the company: its About, how the business works, the project's own words,
 * and the facts and competitors known beyond it. The market comes last, so a long market is what's cut.
 */
export async function companyContext(store: OrgStore, o: { near?: string; business?: false } = {}): Promise<string> {
  const org = store.info.name;
  const about = contextText(await store.getAbout(), `${org}:`);
  // A call that reads the whole business page on its own (a consultant's turn) doesn't hear it twice.
  const business = o.business === false ? "" : await businessFor(store, { for: "call", max: 600 });
  const words = termsText(await store.getTerms(), { max: 800, near: o.near });
  return [about, business, words, marketContext(await store.getMarket(), { org, told: about })].filter(Boolean).join("\n").slice(0, 2400);
}
