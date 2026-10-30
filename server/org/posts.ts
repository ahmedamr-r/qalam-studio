import { research } from "@/ai/server";
import { isDiscussion, postAddress, type LookedOnline } from "@/discovery/ingest/posts";
import { SECTION_HEADING } from "@/hub/topics";
import { captureSource } from "../capture";
import { flushBearings } from "./goals";
import { readPosts } from "./pages";
import { NotFoundError, type OrgStore } from "./store";

/**
 * What people say online about a problem, in the core: the research step searches the web for
 * public pages where people describe it (purpose "posts"), code reads them itself (./pages.ts: a
 * Reddit thread and App Store reviews by role, never by handle), and each is taken in like any
 * material, as a source of kind `post`. What's filed from it is people online's: it backs the
 * problem below its own customers' words, and alone never makes "We know" (src/hub/needs.ts).
 */

export const ONLINE_LIMITS = { pages: 5, lines: 6 } as const;

export type { LookedOnline } from "@/discovery/ingest/posts";

const one = (s: string) => s.replace(/\s+/g, " ").trim();

export async function lookOnline(store: OrgStore, topicId: string, emit: (label: string) => void, signal: AbortSignal): Promise<LookedOnline> {
  const topic = await store.getTopic(topicId);
  if (!topic || topic.kind !== "need") throw new NotFoundError("No such problem");
  const about = await store.getAbout();
  const products = (await store.listProducts()).filter((p) => topic.products.includes(p.id));
  const lines = topic.lines.filter((l) => l.section !== "against").slice(0, ONLINE_LIMITS.lines);
  const task = [
    `The problem: “${one(topic.title)}”`,
    ...(lines.length ? ["What the team's page says about it:", ...lines.map((l) => `- ${SECTION_HEADING[l.section]}: ${one(l.text)}`)] : []),
    ...(products.length ? [`The product it's about: ${products.map((p) => `${p.name}${p.audience ? ` (for ${one(p.audience).slice(0, 200)})` : ""}`).join("; ")}`] : []),
    ...(about.context.trim() ? [`The organization: ${one(about.context).slice(0, 400)}`] : []),
    "Find public pages where people describe this problem in their own words.",
  ].join("\n");
  const info = await research({ purpose: "posts", task, connectors: ["web"] }, emit, signal);
  if (!info) return { read: 0, added: 0, quotes: 0, skipped: 0, error: "Web search isn't on here." };
  // Only where people speak for themselves: an article about them isn't their words.
  const found = [...new Map(info.sources.filter((s) => /^https?:\/\//i.test(s.url)).map((s) => [s.url, s])).values()];
  const links = found.filter((s) => isDiscussion(s.url)).slice(0, ONLINE_LIMITS.pages);
  const why = { before: 0, articles: found.length - found.filter((s) => isDiscussion(s.url)).length, unreadable: 0, reddit: 0 };
  if (!links.length) return { read: 0, added: 0, quotes: 0, skipped: why.articles, why, error: info.error ?? (found.length ? "It found only articles about this, not threads or reviews where people say it themselves." : "The web had no threads or reviews where people talk about this.") };
  // A page taken in before isn't taken in again.
  const kept = new Set((await store.listSources()).filter((s) => s.kind === "post" && s.origin).map((s) => s.origin!));
  const out: LookedOnline = { read: 0, added: 0, quotes: 0, skipped: why.articles, why };
  const filed = new Set<string>();
  for (const link of links) {
    if (signal.aborted) break;
    if (kept.has(link.url)) {
      out.skipped++;
      why.before++;
      continue;
    }
    emit(`Reading ${link.title?.trim() || new URL(link.url).hostname}`);
    const page = await readPosts(link, signal);
    if (!page) {
      out.skipped++;
      if (postAddress(link.url).kind === "reddit") why.reddit++;
      else why.unreadable++;
      continue;
    }
    out.read++;
    const r = await captureSource(store, { kind: "post", title: page.title.slice(0, 200), origin: link.url, text: page.text }, { product: topic.products[0] ?? null, emit, signal });
    out.added++;
    out.quotes += r.quotes;
    for (const p of r.filed?.pages ?? []) filed.add(p.id);
  }
  // What was filed bears on the goals now.
  if (filed.size) {
    emit("Linking what it says to the goals");
    await flushBearings(store, [...filed]).catch(() => null);
  }
  return out;
}
