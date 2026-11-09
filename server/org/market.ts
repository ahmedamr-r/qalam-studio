import { NO_WEB } from "@/ai/abilities";
import { companyCall, competitorsCall, domainCall } from "@/ai/market";
import { findQuestionsCall } from "@/ai/find";
import { statementCall } from "@/ai/statement";
import { marketText } from "@/market/text";
import { termsText } from "@/terms/text";
import { sanitizeStatement, statementMaterial, type StatementWhat } from "@/space/statement";
import type { PlanQuestion } from "@/ai/plan";
import { findQuestionsMaterial, sanitizeFindQuestions, type FindWhat } from "@/space/find";
import type { ResearchInfo, ResearchPurpose } from "@/ai/research-shared";
import { research, structured } from "@/ai/server";
import type { OutsidePage } from "@/goals/outside";
import { editMarket, type MarketEdit } from "@/market/edit";
import { aboutAfterFact, aboutFromFacts, companyMaterial, companyTask, MAX_PAGES, sanitizeFacts, siteUrl } from "@/market/facts";
import { competitorsMaterial, competitorsTask, domainMaterial, domainTask, sanitizeCompetitors, sanitizeDomain } from "@/market/rivals";
import { lookingUnrun, sessionOf, type CompanyLook, type CompetitorsLook, type LookName, type MarketSession } from "@/market/session";
import type { Competitor, MarketLine } from "@/market/types";
import { nanoid } from "nanoid";
import { readPage } from "./pages";
import type { OrgStore } from "./store";
import { recall, withKnown } from "./memory";
import { businessFor } from "./company";

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

export const realDeps: MarketDeps = { research, read: readPage, structured };

/** Lookups running in this process, by organization and look: one at a time each. */
const running = new Map<string, AbortController>();
const runKey = (store: OrgStore, look: LookName) => `${store.dir}|${look}`;

/**
 * The session as the window sees it: a look this process isn't running any more says it stopped.
 * A look writes its end before it leaves `running`, so "looking" with nothing running may only be a
 * read from just before that end; a second read, started now, has the end if there was one.
 */
export async function marketSession(store: OrgStore): Promise<MarketSession> {
  const on = (look: LookName) => running.has(runKey(store, look));
  const read = await store.getMarketSession();
  return sessionOf(lookingUnrun(read, on) ? await store.getMarketSession() : read, on);
}

const STEPS = 6;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One look's part of the session changed. */
function changeLook<K extends LookName>(store: OrgStore, look: K, fn: (l: NonNullable<MarketSession[K]>) => NonNullable<MarketSession[K]>) {
  return store.changeMarketSession((s) => (s[look] ? { ...s, [look]: fn(s[look]!) } : s));
}

/** What a look is doing, written in order as it goes; `written` waits for the last of it, so nothing lands after the look ends. */
function stepper<K extends LookName>(store: OrgStore, look: K) {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    step: (label: string) => {
      chain = chain.then(() => changeLook(store, look, (l) => ({ ...l, steps: [...l.steps, label].slice(-STEPS) }))).catch(() => {});
    },
    /** The look's last word (ready, settled, failed), once what it was doing is written. */
    end: async (fn: (l: NonNullable<MarketSession[K]>) => NonNullable<MarketSession[K]>) => {
      await chain;
      return changeLook(store, look, fn);
    },
  };
}

/** The links the research step's notes cite, the company's own site first. */
export function linksOf(info: ResearchInfo | null, first: string | null): { url: string; title?: string }[] {
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
  const { step, end } = stepper(store, "company");
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
      await end((l) => ({ ...l, state: "ready", facts: [], ...(noWeb ? { noWeb: true, error: NO_WEB } : {}), pages: [] }));
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
    await end((l) => ({ ...l, state: "ready", facts, ...(noWeb ? { noWeb: true } : {}), pages: pages.map((p) => ({ title: p.title, url: p.url })) }));
  } catch (e) {
    if (signal.aborted) return;
    await end((l) => ({ ...l, state: "failed", error: message(e) })).catch(() => {});
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
export async function settleCompany(store: OrgStore, decisions: FactDecision[], added: string[], opts: { tab?: string; deps?: MarketDeps } = {}): Promise<MarketSession> {
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
  const settled = await store.changeMarketSession((x) => (x.company ? { ...x, company: { ...x.company, state: "settled", kept: kept.length } } : x), opts);
  // What companies like it aim for and face, read in the background while they name competitors.
  if (kept.length) void lookUpDomain(store, { deps: opts.deps });
  return settled;
}

/** One look's run: started here (one at a time each), its progress announced, its end its own. */
function startRun(store: OrgStore, look: LookName, run: (ctrl: AbortController) => Promise<void>) {
  const key = runKey(store, look);
  running.get(key)?.abort();
  const ctrl = new AbortController();
  running.set(key, ctrl);
  void run(ctrl).finally(() => {
    if (running.get(key) === ctrl) running.delete(key);
  });
}

/** Pages a research step's notes link, read by code (the first ones that read). */
export async function readLinks(deps: MarketDeps, info: ResearchInfo | null, signal: AbortSignal): Promise<OutsidePage[]> {
  return (await Promise.all(linksOf(info, null).slice(0, MAX_PAGES + 2).map((l) => deps.read(l, signal)))).filter((p): p is OutsidePage => !!p).slice(0, MAX_PAGES);
}

// ---------------------------------------------------------------------------
// Competitors: the ones they name, or found, checked with them

/** Look for the competitors: the ones they named (each one's site and what it does), or the main ones when they named none. */
export async function lookForCompetitors(store: OrgStore, named: string[], opts: { tab?: string; deps?: MarketDeps } = {}): Promise<MarketSession> {
  const names = [...new Set(named.map((n) => n.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 6);
  const s = await store.changeMarketSession((x) => ({ ...x, competitors: { state: "looking", at: Date.now(), steps: ["Starting"], named: names, found: [] } }), opts);
  const deps = opts.deps ?? realDeps;
  startRun(store, "competitors", async ({ signal }) => {
    const { step, end } = stepper(store, "competitors");
    try {
      const org = store.info.name;
      const market = await store.getMarket();
      const info = await deps.research({ purpose: "competitors", task: competitorsTask({ org, facts: market.company, named: names }), connectors: ["web"] }, step, signal);
      if (signal.aborted) return;
      step("Reading the pages it found");
      const pages = await readLinks(deps, info, signal);
      if (signal.aborted) return;
      let found: Competitor[] = [];
      if (pages.length) {
        step("Qalam AI is checking each one on its page");
        const m = competitorsMaterial({ org, facts: market.company, named: names, notes: info?.notes ?? "", pages });
        const { data, model } = await deps.structured<unknown>(competitorsCall(m), signal);
        const now = Date.now();
        const dropped: { why: string; item: unknown }[] = [];
        found = sanitizeCompetitors(data, m, { org, now, id: () => `c${nanoid(8)}`, gone: market.gone }, (why, item) => dropped.push({ why, item }));
        await store.putTrace({ id: nanoid(10), projectId: "market", kind: "competitors", at: now, ...(model ? { model } : {}), answer: data, kept: found.length, dropped } as { id: string; projectId: string }).catch(() => {});
      } else found = names.map((n) => ({ id: `c${nanoid(8)}`, name: n, lines: [], by: "you", at: Date.now() }));
      await end((l) => ({ ...l, state: "ready", found, ...(info ? {} : { noWeb: true }), pages: pages.map((p) => ({ title: p.title, url: p.url })) }));
    } catch (e) {
      if (!signal.aborted) await end((l) => ({ ...l, state: "failed", error: message(e) })).catch(() => {});
    }
  });
  return s;
}

/** The competitors they keep (and any they add by name) go into hub/market.md; those taken off are never proposed again. */
export async function settleCompetitors(store: OrgStore, keep: string[], added: string[], opts: { tab?: string } = {}): Promise<MarketSession> {
  const s = await marketSession(store);
  const look: CompetitorsLook | undefined = s.competitors;
  if (!look || look.state === "looking") throw new Error("No competitors are waiting to be checked.");
  const now = Date.now();
  const kept = look.found.filter((c) => keep.includes(c.id));
  const off = look.found.filter((c) => !keep.includes(c.id)).map((c) => c.name.toLowerCase());
  const mine = added
    .map((n) => n.replace(/\s+/g, " ").trim().slice(0, 80))
    .filter((n) => n && !kept.some((c) => c.name.toLowerCase() === n.toLowerCase()))
    .map((name): Competitor => ({ id: `c${nanoid(8)}`, name, lines: [], by: "you", at: now }));
  await store.changeMarket((m) => {
    const names = new Set([...kept, ...mine].map((c) => c.name.toLowerCase()));
    return { ...m, competitors: [...m.competitors.filter((c) => c.by === "you" && !names.has(c.name.toLowerCase())), ...kept, ...mine], gone: [...new Set([...m.gone, ...off])] };
  }, opts);
  return store.changeMarketSession((x) => (x.competitors ? { ...x, competitors: { ...x.competitors, state: "settled", kept: kept.length + mine.length } } : x), opts);
}

/**
 * A person's edit from the canvas's Company section. A company fact fixed or taken off changes the
 * sentence the About was filled with too, so Qalam AI doesn't go on hearing the old one.
 */
export async function editKnown(store: OrgStore, edit: MarketEdit, opts: { tab?: string } = {}): Promise<void> {
  const before = await store.getMarket();
  const next = await store.changeMarket((m) => editMarket(m, edit, { now: Date.now(), id: (p) => `${p}${nanoid(8)}` }), opts);
  if (edit.kind === "add") return;
  const was = before.company.find((l) => l.id === edit.id);
  if (!was) return;
  const about = await store.getAbout();
  const fill = aboutAfterFact(about, was.text, next.company.find((l) => l.id === edit.id)?.text ?? null);
  if (fill.context !== undefined || fill.audience !== undefined) await store.putAbout({ ...about, ...fill }, opts);
}

// ---------------------------------------------------------------------------
// The domain: what companies like it aim for, and what their customers struggle with

export async function lookUpDomain(store: OrgStore, opts: { deps?: MarketDeps } = {}): Promise<void> {
  const deps = opts.deps ?? realDeps;
  await store.changeMarketSession((x) => ({ ...x, domain: { state: "looking", at: Date.now(), steps: ["Starting"], aims: 0, struggles: 0 } }));
  startRun(store, "domain", async ({ signal }) => {
    const { step, end } = stepper(store, "domain");
    try {
      const org = store.info.name;
      const market = await store.getMarket();
      const info = await deps.research({ purpose: "domain", task: domainTask({ org, facts: market.company, competitors: market.competitors.map((c) => c.name) }), connectors: ["web"] }, step, signal);
      if (signal.aborted) return;
      const pages = await readLinks(deps, info, signal);
      if (signal.aborted) return;
      if (!pages.length) return void (await end((l) => ({ ...l, state: "settled", ...(info ? {} : { noWeb: true }) })));
      step("Qalam AI is checking each point on its page");
      const m = domainMaterial({ org, facts: market.company, notes: info?.notes ?? "", pages });
      const { data, model } = await deps.structured<unknown>(domainCall(m), signal);
      const now = Date.now();
      const dropped: { why: string; item: unknown }[] = [];
      const d = sanitizeDomain(data, m, { now, id: () => `d${nanoid(8)}` }, (why, item) => dropped.push({ why, item }));
      await store.putTrace({ id: nanoid(10), projectId: "market", kind: "domain", at: now, ...(model ? { model } : {}), answer: data, kept: d.aims.length + d.struggles.length, dropped } as { id: string; projectId: string }).catch(() => {});
      // Qalam AI's own lines give way to these; a person's stay.
      await store.changeMarket((x) => ({ ...x, aims: [...x.aims.filter((l) => l.by === "you"), ...d.aims], struggles: [...x.struggles.filter((l) => l.by === "you"), ...d.struggles] }));
      await end((l) => ({ ...l, state: "settled", aims: d.aims.length, struggles: d.struggles.length, pages: pages.map((p) => ({ title: p.title, url: p.url })) }));
    } catch (e) {
      if (!signal.aborted) await end((l) => ({ ...l, state: "failed", error: message(e) })).catch(() => {});
    }
  });
}

// ---------------------------------------------------------------------------
// "Help me find one", from what's known about the company and its domain

/** The opening questions for finding a goal or a problem, their choices drawn from the market; none when nothing's known. */
export async function findQuestions(store: OrgStore, what: FindWhat, signal?: AbortSignal, deps: Pick<MarketDeps, "structured"> = realDeps): Promise<PlanQuestion[]> {
  // Asked from what's known, however little: with nothing known its questions are open (code keeps choices only where they're drawn from something).
  const market = await store.getMarket();
  const about = await store.getAbout();
  const business = await businessFor(store, { for: "call", max: 600 });
  const base = findQuestionsMaterial({ what, org: store.info.name, about: [about.context, about.audience, business].filter((x) => x.trim()).join(" "), market });
  // What's already known (src/memory/): what they've told any other conversation lately, their best-backed pages.
  const known = await recall(store, { flow: "find", key: "", about: { product: null }, words: `${what} ${about.context}` }, { broad: true, sent: base.text }).catch(() => null);
  const m = known?.block ? { text: `${base.text}\n\n${known.block}`, known: [...base.known, ...known.hay.split("\n").filter(Boolean)] } : base;
  const { data, model } = await deps.structured<unknown>(findQuestionsCall(m), signal);
  const questions = sanitizeFindQuestions(data, m);
  await store.putTrace({ id: nanoid(10), projectId: "market", kind: "find-questions", at: Date.now(), ...(model ? { model } : {}), what, answer: data, kept: questions.map((q) => q.title) } as { id: string; projectId: string }).catch(() => {});
  return withKnown(store, questions, { flow: "find", key: "", about: { product: null }, words: what });
}

// ---------------------------------------------------------------------------
// Their words as a proper goal or problem

/** A statement for what they wrote, worded from what's known about the company (null: their own words stand). */
export async function suggestStatement(store: OrgStore, o: { what: StatementWhat; said: string; above?: string | null }, signal?: AbortSignal, deps: Pick<MarketDeps, "structured"> = realDeps): Promise<{ statement: string; why: string } | null> {
  const about = await store.getAbout();
  const market = await store.getMarket();
  const org = store.info.name;
  const words = [termsText(await store.getTerms(), { max: 600, near: o.said }), await businessFor(store, { for: "call", max: 600 })].filter(Boolean).join("\n\n");
  const m = statementMaterial({ what: o.what, said: o.said, org, about: [about.context, about.audience].filter((x) => x.trim()).join(" "), market: marketText(market, { org, domain: false }), above: o.above, words });
  const { data } = await deps.structured<unknown>(statementCall(m), signal);
  return sanitizeStatement(data, m);
}

/** Stop a look running here. */
export function stopLook(store: OrgStore, look: LookName) {
  running.get(runKey(store, look))?.abort();
}
