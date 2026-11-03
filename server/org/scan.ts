import { competitorsCall } from "@/ai/market";
import { appsCall, searchesCall } from "@/ai/scan";
import type { Ingested } from "@/discovery/ingest/core";
import { isDiscussion, isReddit, postAddress } from "@/discovery/ingest/posts";
import type { OutsidePage } from "@/goals/outside";
import { competitorsMaterial, competitorsTask, sanitizeCompetitors } from "@/market/rivals";
import { emptyScan, isThin, sanitizeAppPicks, sanitizeSearches, scanOf, type ScanRead, type ScanRequest, type ScanSession } from "@/scan/session";
import { appLookup, appNameIn, appSearch, appsIn, bestApp, hnComments, hnSearch, hnThreads, popularApps, type AppHit } from "@/scan/sources";
import { nanoid } from "nanoid";
import { captureTogether, type TakenTogether } from "../capture";
import { readLinks, realDeps, type MarketDeps } from "./market";
import { readAppReviews, readJson, readPosts, type ReadReviews } from "./pages";
import type { OrgStore } from "./store";

/**
 * What people complain about, in the core: from an idea (find what people use today, then what's said
 * about it) or a product (what's said about it). Apps' reviews and Hacker News's comments are read by
 * code; the research step finds other pages where people speak for themselves. Everything is taken in
 * together (`captureTogether`), so what's kept is found word for word and filed into problem pages,
 * as public words unless they say a product is theirs. It answers at once and goes on here; its
 * progress is in chats/scan/session.json. Code says when it found little.
 */

export interface ScanDeps extends MarketDeps {
  json: (url: string, signal: AbortSignal) => Promise<unknown>;
  reviews: (app: { id: string; country: string; name?: string; url: string }, signal: AbortSignal) => Promise<ReadReviews | null>;
  posts: (link: { url: string; title?: string }, signal: AbortSignal) => Promise<OutsidePage | null>;
  capture: (store: OrgStore, items: readonly { ing: Ingested; basis?: "said" }[], o: { emit: (label: string) => void; signal: AbortSignal; focus: string }) => Promise<TakenTogether>;
}

const liveDeps: ScanDeps = { ...realDeps, json: readJson, reviews: readAppReviews, posts: readPosts, capture: captureTogether };

export const SCAN_LIMITS = { competitors: 3, candidates: 12, apps: 3, pages: 5, tries: 12, atOnce: 4, steps: 6 } as const;

const running = new Map<string, AbortController>();
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The scan as the window sees it. */
export async function scanNow(store: OrgStore): Promise<ScanSession | null> {
  const on = running.has(store.dir);
  const read = await store.getScanSession();
  // A scan writes its end before it leaves `running`: a second read, started now, has it if there was one.
  return scanOf(read?.state === "reading" && !on ? await store.getScanSession() : read, on);
}

export function stopScan(store: OrgStore) {
  running.get(store.dir)?.abort();
}

/** Start a scan (one at a time; a new one stops the last). Answers at once. */
export async function startScan(store: OrgStore, req: ScanRequest, opts: { tab?: string; deps?: ScanDeps } = {}): Promise<ScanSession> {
  running.get(store.dir)?.abort();
  const ctrl = new AbortController();
  running.set(store.dir, ctrl);
  const s = await store.changeScanSession(() => emptyScan(req.target, Date.now()), opts);
  void runScan(store, req, opts.deps ?? liveDeps, ctrl.signal).finally(() => {
    if (running.get(store.dir) === ctrl) running.delete(store.dir);
  });
  return s;
}

/** Run a scan to its end, for what waits on it (the eval). */
export async function scanToEnd(store: OrgStore, req: ScanRequest, deps: ScanDeps = liveDeps, signal: AbortSignal = new AbortController().signal): Promise<ScanSession> {
  await store.changeScanSession(() => emptyScan(req.target, Date.now()));
  await runScan(store, req, deps, signal);
  return (await store.getScanSession())!;
}

async function runScan(store: OrgStore, req: ScanRequest, deps: ScanDeps, signal: AbortSignal) {
  // Written in order as it goes, so nothing lands after the end.
  let chain: Promise<unknown> = Promise.resolve();
  const change = (fn: (s: ScanSession) => ScanSession) => {
    const next = chain.then(() => store.changeScanSession((s) => fn(s ?? emptyScan(req.target, Date.now()))));
    chain = next.catch(() => {});
    return next;
  };
  const step = (label: string) => void change((s) => ({ ...s, steps: [...s.steps, label].slice(-SCAN_LIMITS.steps) }));
  try {
    const { target, country } = req;
    const about = target.kind === "idea" ? target.said : target.name;
    const mine = target.kind === "product" && target.mine;
    const items: { ing: Ingested; read: ScanRead; basis?: "said" }[] = [];
    const take = (read: ScanRead, text: string, basis?: "said") => items.push({ ing: { kind: "post", title: read.title.slice(0, 200), origin: read.origin, text }, read, ...(basis ? { basis } : {}) });
    // Asked twice, a page isn't read twice; nor is one kept from before.
    const seen = new Set((await store.listSources()).filter((s) => s.kind === "post" && s.origin).map((s) => s.origin!));
    let before = 0;
    const fresh = (origin: string) => {
      if (seen.has(origin)) {
        before++;
        return false;
      }
      seen.add(origin);
      return true;
    };

    if (signal.aborted) return;

    // What to read about: an idea's competitors, or the product itself.
    let noWeb = false;
    let names: string[] = [];
    let linked: { id: string; country: string; url: string } | null = null;
    if (target.kind === "idea") {
      const found = await competitorsFor(store, target.said, deps, signal, step);
      noWeb = found.noWeb;
      names = found.names.slice(0, SCAN_LIMITS.competitors);
    } else {
      const where = target.app ? postAddress(target.app) : null;
      if (where?.kind === "appstore") linked = { id: where.id, country: where.country, url: target.app! };
      names = target.name ? [target.name] : [];
    }
    if (signal.aborted) return;

    // What to search for: on Hacker News, and in the App Store where the names give too few apps.
    step("Working out where to look");
    const { data: wrote } = await deps.structured<unknown>(searchesCall(about || names.join(", "), names), signal);
    if (signal.aborted) return;

    // Their apps, found by code: whole name or nothing, a stranger's reviews aren't theirs.
    const apps: ScanSession["competitors"] = [];
    const toRead: { id: string; country: string; name?: string; url: string }[] = [];
    if (linked) {
      const name = target.kind === "product" && target.name ? target.name : (appNameIn(await deps.json(appLookup(linked.id, linked.country), signal)) ?? undefined);
      if (name && !names.includes(name)) names = [name, ...names];
      toRead.push({ ...linked, ...(name ? { name } : {}) });
    } else {
      step("Looking for their apps");
      const named: AppHit[] = [];
      for (const name of names) {
        const app = bestApp(name, appsIn(await deps.json(appSearch(name, country), signal)));
        apps.push({ name, ...(app ? { app: { id: app.id, name: app.name, url: app.url } } : {}) });
        if (app) named.push(app);
      }
      if (target.kind === "product") toRead.push(...named.map((a) => ({ id: a.id, country, name: a.name, url: a.url })));
      else {
        // An idea: the apps most people use for it too (named ones are often too new to have reviews), and a word in common isn't enough.
        const found = (await Promise.all(sanitizeSearches(wrote, "apps").map(async (term) => popularApps(appsIn(await deps.json(appSearch(term, country), signal)))))).flat();
        const candidates = [...new Map([...named, ...found].map((a) => [a.id, a])).values()].slice(0, SCAN_LIMITS.candidates);
        const picked = candidates.length ? sanitizeAppPicks((await deps.structured<unknown>(appsCall(about, candidates), signal)).data, candidates, SCAN_LIMITS.apps) : [];
        for (const a of picked) {
          toRead.push({ id: a.id, country, name: a.name, url: a.url });
          if (!apps.some((x) => x.app?.id === a.id)) apps.push({ name: a.name, app: { id: a.id, name: a.name, url: a.url } });
        }
      }
    }
    await change((s) => ({ ...s, competitors: apps }));
    if (signal.aborted) return;

    // App Store reviews.
    if (toRead.length) step(`Reading App Store reviews of ${toRead.map((a) => a.name ?? "the app").join(", ")}`);
    for (const got of await Promise.all(toRead.filter((a) => fresh(`app:${a.id}`) && fresh(a.url)).map((a) => deps.reviews(a, signal)))) {
      if (got) take({ title: got.page.title, origin: got.page.url, kind: "reviews", reviews: { read: got.read, kept: got.kept } }, got.page.text, mine ? "said" : undefined);
    }
    if (signal.aborted) return;

    // Hacker News: the searches Qalam AI wrote, and each name as it is; only comments about what was searched.
    step("Searching Hacker News");
    const now = Date.now();
    const searches = [...sanitizeSearches(wrote).map((q) => ({ query: q, about: { words: q } })), ...names.map((n) => ({ query: n, about: { name: n } }))];
    const comments = (await Promise.all(searches.map(async (q) => hnComments(await deps.json(hnSearch(q.query, now), signal), q.about)))).flat();
    for (const t of hnThreads(comments)) if (fresh(t.origin)) take({ title: t.title, origin: t.origin, kind: "thread" }, t.text);
    if (signal.aborted) return;

    // Other pages where people speak for themselves.
    const info = await deps.research({ purpose: "posts", task: [`What it's about: ${about}`, "Find forums, Q&A threads and review pages where the people this is for describe their problems in their own words: what they tried, what went wrong, what they gave up on. Not pages selling a product.", ...(names.length ? [`Products they may mention: ${names.join(", ")}`] : [])].join("\n"), connectors: ["web"] }, step, signal);
    if (!info) noWeb = true;
    const links = [...new Map((info?.sources ?? []).filter((s) => /^https?:\/\//i.test(s.url)).map((s) => [s.url, s])).values()];
    const reddit = links.filter((l) => isReddit(l.url)).length;
    const discussions = links.filter((l) => isDiscussion(l.url) && !isReddit(l.url));
    const articles = links.length - reddit - discussions.length;
    // The same app in another country's store is the same app.
    const unseen = discussions.filter((l) => {
      const where = postAddress(l.url);
      return (where.kind !== "appstore" || fresh(`app:${where.id}`)) && fresh(l.url);
    });
    const tries = unseen.slice(0, SCAN_LIMITS.tries);
    if (tries.length) step("Reading pages where people talk about it");
    // Many forums turn readers away: on to the next until enough have read.
    let unreadable = 0;
    let tried = 0;
    const got: OutsidePage[] = [];
    const refused: string[] = [];
    while (tried < tries.length && got.length < SCAN_LIMITS.pages && !signal.aborted) {
      const batch = tries.slice(tried, tried + SCAN_LIMITS.atOnce);
      tried += batch.length;
      for (const [i, p] of (await Promise.all(batch.map((l) => deps.posts(l, signal)))).entries()) {
        if (p && got.length < SCAN_LIMITS.pages) got.push(p);
        else if (!p) {
          unreadable++;
          refused.push(batch[i].url);
        }
      }
    }
    const notRead: NonNullable<ScanSession["notRead"]> = [...links.filter((l) => isReddit(l.url)).map((l) => ({ url: l.url, why: "reddit" as const })), ...links.filter((l) => !isReddit(l.url) && !isDiscussion(l.url)).map((l) => ({ url: l.url, why: "article" as const })), ...unseen.slice(tried).map((l) => ({ url: l.url, why: "too many" as const })), ...refused.map((url) => ({ url, why: "unreadable" as const }))];
    for (const p of got) take({ title: p.title, origin: p.url, kind: "page" }, p.text);
    await change((s) => ({ ...s, read: items.map((i) => i.read), skipped: { reddit, before, articles, unreadable }, notRead: notRead.slice(0, 30), ...(noWeb ? { noWeb: true as const } : {}) }));
    if (signal.aborted) return;

    // Taken in together: what's kept is found word for word, and filed once.
    const taken = items.length ? await deps.capture(store, items.map(({ ing, basis }) => ({ ing, ...(basis ? { basis } : {}) })), { emit: step, signal, focus: target.kind === "idea" ? `What people struggle with around this idea: ${target.said}` : `What people complain about in ${target.name || names[0] || "this product"}` }) : { sources: [], filed: null, notFound: 0 };
    if (signal.aborted) return;
    const kept = taken.sources.reduce((n, s) => n + s.quotes, 0);
    const problems = (taken.filed?.pages ?? []).filter((p) => p.kind === "need").map((p) => ({ id: p.id, title: p.title }));
    await change((s) => ({
      ...s,
      state: "done",
      read: s.read.map((r, i) => (taken.sources[i] ? { ...r, ...(taken.sources[i].id ? { sourceId: taken.sources[i].id } : {}), quotes: taken.sources[i].quotes } : r)),
      checked: { kept, notFound: taken.notFound, unbacked: taken.filed?.unbacked ?? 0 },
      problems,
      thin: isThin(problems.length, kept),
    }));
  } catch (e) {
    if (!signal.aborted) await change((s) => ({ ...s, state: "failed", error: message(e) })).catch(() => {});
  } finally {
    if (signal.aborted) await change((s) => (s.state === "reading" ? { ...s, state: "stopped" } : s)).catch(() => {});
    await chain;
  }
}

/** What people use today for what they want to build: found on the web, each kept only where a page read names it. */
async function competitorsFor(store: OrgStore, said: string, deps: ScanDeps, signal: AbortSignal, step: (label: string) => void): Promise<{ names: string[]; noWeb: boolean }> {
  step("Looking for what people use today");
  const org = store.info.name;
  const market = await store.getMarket();
  const known = market.competitors.map((c) => c.name);
  const info = await deps.research({ purpose: "competitors", task: competitorsTask({ org, facts: market.company, named: known, said }), connectors: ["web"] }, step, signal);
  if (signal.aborted || !info) return { names: known, noWeb: !info };
  const pages = await readLinks(deps, info, signal);
  if (!pages.length || signal.aborted) return { names: known, noWeb: false };
  step("Checking each one on its page");
  const m = competitorsMaterial({ org, facts: market.company, named: known, notes: info.notes, pages, said });
  const { data } = await deps.structured<unknown>(competitorsCall(m), signal);
  const found = sanitizeCompetitors(data, m, { org, now: Date.now(), id: () => `c${nanoid(8)}`, gone: market.gone });
  return { names: found.map((c) => c.name), noWeb: false };
}
