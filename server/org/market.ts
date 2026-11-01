import { NO_WEB } from "@/ai/abilities";
import { companyCall } from "@/ai/market";
import type { ResearchInfo, ResearchPurpose } from "@/ai/research-shared";
import { research, structured } from "@/ai/server";
import type { OutsidePage } from "@/goals/outside";
import { aboutFromFacts, companyMaterial, companyTask, MAX_PAGES, sanitizeFacts, siteUrl } from "@/market/facts";
import { sessionOf, type CompanyLook, type LookName, type MarketSession } from "@/market/session";
import type { MarketLine } from "@/market/types";
import { nanoid } from "nanoid";
import { readPage } from "./pages";
import type { OrgStore } from "./store";

/**
 * The first run's lookups, in the core: what the web says about the company (then, in turn, its
 * competitors and its domain). Each answers at once and goes on here: the research step searches
 * the web (src/ai/research.ts), code reads the pages itself (./pages.ts), one call proposes what to
 * check with them, and code keeps only what's on a page word for word (src/market/). Its progress
 * is kept in chats/market/session.json and announced, so the window's thread follows it and a
 * reload picks it up; what they keep goes into hub/market.md.
 */

export interface MarketDeps {
  research: (req: { purpose: ResearchPurpose; task: string; connectors: string[] }, emit: (label: string) => void, signal: AbortSignal) => Promise<ResearchInfo | null>;
  read: (link: { url: string; title?: string }, signal: AbortSignal) => Promise<OutsidePage | null>;
  structured: <T>(call: Parameters<typeof structured>[0], signal?: AbortSignal) => Promise<{ data: T; model?: string }>;
}

const realDeps: MarketDeps = { research, read: readPage, structured };

/** Lookups running in this process, by organization and look: one at a time each. */
const running = new Map<string, AbortController>();
const runKey = (store: OrgStore, look: LookName) => `${store.dir}|${look}`;

/** The session as the window sees it: a look this process isn't running any more says it stopped. */
export async function marketSession(store: OrgStore): Promise<MarketSession> {
  return sessionOf(await store.getMarketSession(), (look) => running.has(runKey(store, look)));
}

const STEPS = 6;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One look's part of the session changed. */
function changeLook<K extends LookName>(store: OrgStore, look: K, fn: (l: NonNullable<MarketSession[K]>) => NonNullable<MarketSession[K]>) {
  return store.changeMarketSession((s) => (s[look] ? { ...s, [look]: fn(s[look]!) } : s));
}

/** The links the research step's notes cite, the company's own site first. */
function linksOf(info: ResearchInfo | null, first: string | null): { url: string; title?: string }[] {
  const all = [...(first ? [{ url: first }] : []), ...(info?.sources ?? []).filter((s) => /^https?:\/\//i.test(s.url))];
  const seen = new Set<string>();
  return all.filter((l) => {
    const k = l.url.replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/i, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Look the company up: its site (when they gave one) and what the web says about it, read and
 * checked, then left for them to keep, fix or drop. `said` is their own line about it (no website,
 * or none found). Answers at once; the look goes on in the core.
 */
export async function lookUpCompany(store: OrgStore, o: { site?: string | null; said?: string | null }, opts: { tab?: string; deps?: MarketDeps } = {}): Promise<MarketSession> {
  const key = runKey(store, "company");
  running.get(key)?.abort();
  const ctrl = new AbortController();
  running.set(key, ctrl);
  const site = siteUrl(o.site);
  const said = o.said?.trim().slice(0, 1200) || undefined;
  const look: CompanyLook = { state: "looking", at: Date.now(), steps: ["Starting"], facts: [], ...(o.site?.trim() ? { site: o.site.trim().slice(0, 300) } : {}), ...(said ? { said } : {}) };
  const s = await store.changeMarketSession((x) => ({ ...x, company: look }), opts);
  void runCompany(store, site, said, opts.deps ?? realDeps, ctrl).finally(() => {
    if (running.get(key) === ctrl) running.delete(key);
  });
  return s;
}

async function runCompany(store: OrgStore, site: string | null, said: string | undefined, deps: MarketDeps, ctrl: AbortController) {
  const { signal } = ctrl;
  const step = (label: string) => void changeLook(store, "company", (l) => ({ ...l, steps: [...l.steps, label].slice(-STEPS) })).catch(() => {});
  try {
    const org = store.info.name;
    const task = companyTask({ org, site, said, solo: store.info.shape === "solo" });
    const info = await deps.research({ purpose: "company", task, connectors: ["web"] }, step, signal);
    if (signal.aborted) return;
    const noWeb = !info;
    step(site ? "Reading its website" : "Reading the pages it found");
    const pages = (await Promise.all(linksOf(info, site).slice(0, MAX_PAGES).map((l) => deps.read(l, signal)))).filter((p): p is OutsidePage => !!p);
    if (signal.aborted) return;
    if (!pages.length && !said) {
      await changeLook(store, "company", (l) => ({ ...l, state: "ready", facts: [], ...(noWeb ? { noWeb: true, error: NO_WEB } : {}), pages: [] }));
      return;
    }
    step("Qalam AI is checking each fact on its page");
    const m = companyMaterial({ org, site, said, notes: info?.notes ?? "", pages });
    const { data, model } = await deps.structured<unknown>(companyCall(m), signal);
    const now = Date.now();
    const dropped: { why: string; item: unknown }[] = [];
    const facts = sanitizeFacts(data, m, { now, id: () => `f${nanoid(8)}` }, (why, item) => dropped.push({ why, item }));
    await store
      .putTrace({ id: nanoid(10), projectId: "market", kind: "company", at: now, ...(model ? { model } : {}), pages: [...m.pages.values()].map((p) => ({ ref: p.ref, url: p.url })), answer: data, kept: facts.length, dropped } as { id: string; projectId: string })
      .catch(() => {});
    await changeLook(store, "company", (l) => ({ ...l, state: "ready", facts, ...(noWeb ? { noWeb: true } : {}), pages: pages.map((p) => ({ title: p.title, url: p.url })) }));
  } catch (e) {
    if (signal.aborted) return;
    await changeLook(store, "company", (l) => ({ ...l, state: "failed", error: message(e) })).catch(() => {});
  }
}

/** What they decided about each fact: kept as found, kept in their words, or dropped; and facts of their own. */
export interface FactDecision {
  id: string;
  keep: boolean;
  /** Their words, when they fixed it: the fact is theirs now. */
  text?: string;
}

/**
 * Settle the company's facts: those kept go into hub/market.md (a fixed one in their words, as
 * theirs), the About's empty fields are filled from them, and the look is settled. A person's own
 * lines already in the file stay; Qalam AI's from an earlier look give way to these.
 */
export async function settleCompany(store: OrgStore, decisions: FactDecision[], added: string[], opts: { tab?: string } = {}): Promise<MarketSession> {
  const s = await marketSession(store);
  const look = s.company;
  if (!look || look.state === "looking") throw new Error("Nothing about the company is waiting to be checked.");
  const now = Date.now();
  const by = new Map(decisions.map((d) => [d.id, d]));
  const kept: MarketLine[] = [];
  for (const f of look.facts) {
    const d = by.get(f.id);
    if (d && !d.keep) continue;
    const words = d?.text?.replace(/\s+/g, " ").trim().slice(0, 300);
    // Fixed: their words now, read where it was found.
    kept.push(words && words !== f.text ? { id: f.id, text: words, ...(f.field ? { field: f.field } : {}), ...(f.url ? { url: f.url, title: f.title } : {}), by: "you", at: now } : f);
  }
  for (const t of added) {
    const words = t.replace(/\s+/g, " ").trim().slice(0, 300);
    if (words) kept.push({ id: `f${nanoid(8)}`, text: words, field: "does", by: "you", at: now });
  }
  await store.changeMarket((m) => ({ ...m, company: [...m.company.filter((l) => l.by === "you" && !kept.some((k) => k.id === l.id)), ...kept] }), opts);
  const about = await store.getAbout();
  const fill = aboutFromFacts(kept, about);
  if (fill.context || fill.audience) await store.putAbout({ ...about, ...fill }, opts);
  return store.changeMarketSession((x) => (x.company ? { ...x, company: { ...x.company, state: "settled", kept: kept.length } } : x), opts);
}

/** Stop a look running here. */
export function stopLook(store: OrgStore, look: LookName) {
  running.get(runKey(store, look))?.abort();
}
