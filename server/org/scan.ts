import { competitorsCall, pricesCall } from "@/ai/market";
import type { PlanQuestion } from "@/ai/plan";
import { appsCall, firstReadCall, searchesCall, steerCall } from "@/ai/scan";
import type { Ingested } from "@/discovery/ingest/core";
import { isDiscussion, isReddit, postAddress, refusesReaders } from "@/discovery/ingest/posts";
import type { OutsidePage } from "@/goals/outside";
import { brandOf, competitorsMaterial, competitorsTask, ownSite, pricesMaterial, sanitizeCompetitors, sanitizePrices, withRivals } from "@/market/rivals";
import type { Competitor } from "@/market/types";
import { focusWith, isOff, sanitizeSteer, steerOf, steerRound, toldLines, withSteer, type ScanSteer } from "@/scan/steer";
import { emptyScan, isThin, peopleQuotes, sanitizeAppPicks, sanitizeSearches, scanOf, type ScanKnown, type ScanRead, type ScanRequest, type ScanSession } from "@/scan/session";
import { appLookup, appNameIn, appSearch, appsIn, bestApp, hnComments, hnSearch, hnThreads, popularApps, type AppHit } from "@/scan/sources";
import { NOT_READ, sanitizeFirstRead, saysNoIdea, type FirstRead } from "@/scan/input";
import { nanoid } from "nanoid";
import { captureTogether, type TakenTogether } from "../capture";
import { readLinks, realDeps, type MarketDeps } from "./market";
import { readAppReviews, readJson, readPosts, type ReadReviews } from "./pages";
import type { OrgStore } from "./store";
import { rememberRound } from "./memory";
import { saysDontKnow } from "@/asking/dontknow";
import { questionKey } from "@/memory/fold";

/**
 * What's known about an idea or a product, in the core: what people complain about (apps' reviews and
 * Hacker News's comments read by code, other pages where people speak for themselves found by the
 * research step), what others offer and charge (kept in hub/market.md), and what's been published
 * (reports and articles, read elsewhere). Everything is taken in together (`captureTogether`), so
 * what's kept is found word for word and filed into problem pages, as public words unless they say a
 * product is theirs. It answers at once and goes on here; its progress is in chats/scan/session.json.
 * Code says when it found little, going by people's words alone.
 */

export interface ScanDeps extends MarketDeps {
  json: (url: string, signal: AbortSignal) => Promise<unknown>;
  reviews: (app: { id: string; country: string; name?: string; url: string }, signal: AbortSignal) => Promise<ReadReviews | null>;
  posts: (link: { url: string; title?: string }, signal: AbortSignal) => Promise<OutsidePage | null>;
  capture: (store: OrgStore, items: readonly { ing: Ingested; basis?: "said" | "read"; focus?: string }[], o: { emit: (label: string) => void; signal: AbortSignal; focus: string }) => Promise<TakenTogether>;
}

const liveDeps: ScanDeps = { ...realDeps, json: readJson, reviews: readAppReviews, posts: readPosts, capture: captureTogether };

export const SCAN_LIMITS = { competitors: 3, candidates: 12, apps: 3, pages: 5, tries: 12, articles: 4, articleTries: 8, articleChars: 20_000, atOnce: 4, steps: 6, askMs: 20_000, priced: 6, pricePages: 8, knownPerRival: 2, knownPerPage: 3, known: 14 } as const;

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
  const s = await store.changeScanSession(() => emptyScan(req.target, Date.now(), req.told), opts);
  void runScan(store, req, opts.deps ?? liveDeps, ctrl.signal, s.at).finally(() => {
    if (running.get(store.dir) === ctrl) running.delete(store.dir);
  });
  return s;
}

/** What they've said while it reads, for what hasn't been read yet. Nothing changes once it's over. */
export async function steerScan(store: OrgStore, raw: unknown, opts: { tab?: string } = {}): Promise<ScanSession | null> {
  const more = steerOf(raw);
  const now = await store.getScanSession();
  if (!now || now.state !== "reading" || (!more.said.length && !more.off.length)) return now;
  // What they told it while it read, in the project's memory (src/memory/), so no later question asks it again.
  if (more.said.length)
    await rememberRound(store, { flow: "steer", key: `scan-${now.at}`, about: { product: null }, answers: more.said.map((x) => ({ qid: questionKey(x.question), q: x.question, a: x.answer, how: saysDontKnow(x.answer) ? ("unknown" as const) : ("own" as const) })) }, opts).catch(() => {});
  return store.changeScanSession((s) => {
    const cur = s ?? now;
    return cur.at === now.at && cur.state === "reading" ? { ...cur, steer: withSteer(cur.steer, more) } : cur;
  }, opts);
}

/** The questions as it starts: how Qalam AI took them, from their words alone; code's own when it can't say in time. */
/**
 * A first answer read for what it is: whether it names anything to read about, a product's own name,
 * and what to call the project. Plain words like "no idea" need no call, and any trouble with the call
 * leaves it reading as asked, named as it was before.
 */
export async function readFirstAnswer(said: string, signal: AbortSignal, deps: Pick<ScanDeps, "structured"> = liveDeps): Promise<FirstRead> {
  const text = said.replace(/\s+/g, " ").trim().slice(0, 1200);
  if (saysNoIdea(text)) return { named: false, product: "", name: "" };
  return deps.structured<unknown>(firstReadCall(text), AbortSignal.any([signal, AbortSignal.timeout(SCAN_LIMITS.askMs)])).then(
    (r) => sanitizeFirstRead(r.data, text),
    (e: unknown) => {
      if (signal.aborted) throw e;
      return NOT_READ;
    },
  );
}

/** Whether what they wrote names anything to read about. With nothing named a scan has nothing to go on. */
export const namesSomething = async (said: string, signal: AbortSignal, deps: Pick<ScanDeps, "structured"> = liveDeps): Promise<boolean> => (await readFirstAnswer(said, signal, deps)).named;

export async function steerQuestions(req: Pick<ScanRequest, "target">, signal: AbortSignal, deps: Pick<ScanDeps, "structured"> = liveDeps): Promise<PlanQuestion[]> {
  // Only an idea is asked who it's for first; a product's one question is code's own.
  const about = req.target.kind === "idea" ? req.target.said : "";
  if (!about) return steerRound(req.target);
  try {
    const { data } = await deps.structured<unknown>(steerCall(about), AbortSignal.any([signal, AbortSignal.timeout(SCAN_LIMITS.askMs)]));
    return sanitizeSteer(data, req.target);
  } catch (e) {
    if (signal.aborted) throw e;
    return steerRound(req.target);
  }
}

/** Run a scan to its end, for what waits on it (the eval). */
export async function scanToEnd(store: OrgStore, req: ScanRequest, deps: ScanDeps = liveDeps, signal: AbortSignal = new AbortController().signal): Promise<ScanSession> {
  const { at } = await store.changeScanSession(() => emptyScan(req.target, Date.now(), req.told));
  await runScan(store, req, deps, signal, at);
  return (await store.getScanSession())!;
}

async function runScan(store: OrgStore, req: ScanRequest, deps: ScanDeps, signal: AbortSignal, at: number) {
  // Written in order as it goes, so nothing lands after the end; a run stopped late leaves the next one's session alone.
  let chain: Promise<unknown> = Promise.resolve();
  const change = (fn: (s: ScanSession) => ScanSession) => {
    const next = chain.then(() => store.changeScanSession((s) => (s && s.at !== at ? s : fn(s ?? emptyScan(req.target, at)))));
    chain = next.catch(() => {});
    return next;
  };
  const step = (label: string) => void change((s) => ({ ...s, steps: [...s.steps, label].slice(-SCAN_LIMITS.steps) }));
  // What they've said so far: read where it can still turn something, and late is fine.
  const steerNow = async (): Promise<ScanSteer | undefined> => {
    await chain;
    const s = await store.getScanSession();
    return s?.at === at ? s.steer : undefined;
  };
  try {
    const { target, country } = req;
    const about = target.kind === "idea" ? target.said : target.name;
    const mine = target.kind === "product" && target.mine;
    let items: { ing: Ingested; read: ScanRead; basis?: "said" | "read"; focus?: string }[] = [];
    const take = (read: ScanRead, text: string, basis?: "said") => items.push({ ing: { kind: "post", title: read.title.slice(0, 200), origin: read.origin, text }, read, ...(basis ? { basis } : {}) });
    // Asked twice, a page isn't read twice; nor is one kept from before.
    const seen = new Set((await store.listSources()).filter((s) => (s.kind === "post" || s.kind === "url") && s.origin).map((s) => s.origin!));
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
    let rivals: Competitor[] = [];
    let rivalPages: OutsidePage[] = [];
    let linked: { id: string; country: string; url: string } | null = null;
    if (target.kind === "idea") {
      const found = await competitorsFor(store, { org: store.info.name, said: target.said, label: "Looking for what people use today" }, deps, signal, step);
      noWeb = found.noWeb;
      rivals = found.competitors;
      rivalPages = found.pages;
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
        apps.push({ name, ...(app ? { app: { id: app.id, name: app.name, url: app.url, ...(app.site ? { site: app.site } : {}) } } : {}) });
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
          if (!apps.some((x) => x.app?.id === a.id)) apps.push({ name: a.name, app: { id: a.id, name: a.name, url: a.url, ...(a.site ? { site: a.site } : {}) } });
        }
      }
    }
    await change((s) => ({ ...s, competitors: apps }));
    if (signal.aborted) return;

    // App Store reviews, of the apps they haven't taken off.
    const offApps = (steer: ScanSteer | undefined) => new Set(apps.filter((a) => a.app && isOff(steer, a.name)).map((a) => a.app!.id));
    const gone = offApps(await steerNow());
    const reading = toRead.filter((a) => !gone.has(a.id) && fresh(`app:${a.id}`) && fresh(a.url));
    if (reading.length) step(`Reading App Store reviews of ${reading.map((a) => a.name ?? "the app").join(", ")}`);
    for (const [i, got] of (await Promise.all(reading.map((a) => deps.reviews(a, signal)))).entries()) {
      if (got) take({ title: got.page.title, origin: got.page.url, kind: "reviews", reviews: { read: got.read, kept: got.kept }, appId: reading[i].id }, got.page.text, mine ? "said" : undefined);
    }
    if (signal.aborted) return;

    // Hacker News: the searches Qalam AI wrote, and each name as it is; only comments about what was searched.
    step("Searching Hacker News");
    const now = Date.now();
    const hearing = await steerNow();
    names = names.filter((n) => !isOff(hearing, n));
    const searches = [...sanitizeSearches(wrote).map((q) => ({ query: q, about: { words: q } })), ...names.map((n) => ({ query: n, about: { name: n } }))];
    const comments = (await Promise.all(searches.map(async (q) => hnComments(await deps.json(hnSearch(q.query, now), signal), q.about)))).flat();
    for (const t of hnThreads(comments)) if (fresh(t.origin)) take({ title: t.title, origin: t.origin, kind: "thread" }, t.text);
    if (signal.aborted) return;

    // Other pages where people speak for themselves, what's been published around it, and (for a product) what it competes with: each costs a lookup, none needs the others.
    const name = target.kind === "product" ? target.name || names[0] || "" : "";
    const told = toldLines(await steerNow());
    const theySaid = told ? [`What they've said so far (where to look first, not what to find):\n${told}`] : [];
    const [info, space, compared] = await Promise.all([
      deps.research({ purpose: "posts", task: [`What it's about: ${about}`, "Find forums, Q&A threads and review pages where the people this is for describe their problems in their own words: what they tried, what went wrong, what they gave up on. Not pages selling a product.", ...(names.length ? [`Products they may mention: ${names.join(", ")}`] : []), ...theySaid].join("\n"), connectors: ["web"] }, step, signal),
      deps.research({ purpose: "space", task: [`What it's about: ${about || names.join(", ")}`, ...(names.length ? [`Products in this market: ${names.join(", ")}`] : []), ...theySaid].join("\n"), connectors: ["web"] }, step, signal).catch((e: unknown) => {
        if (signal.aborted) throw e;
        return null;
      }),
      name
        ? competitorsFor(store, { org: name, said: `something that competes with ${name}`, label: `Looking at what competes with ${name}` }, deps, signal, step).catch((e: unknown) => {
            if (signal.aborted) throw e;
            console.warn(`[scan] competitors: ${message(e)}`);
            return null;
          })
        : null,
    ]);
    if (compared) {
      rivals = compared.competitors;
      rivalPages = compared.pages;
    }
    if (!info) noWeb = true;
    if (signal.aborted) return;

    // What they charge, for the ones they haven't taken off.
    const asked = await steerNow();
    const foundNames = rivals.map((c) => c.name);
    rivals = await pricesFor(rivals.filter((c) => !isOff(asked, c.name)), apps.filter((a) => !isOff(asked, a.name)), rivalPages, deps, signal, step).catch((e: unknown) => {
      if (signal.aborted) throw e;
      console.warn(`[scan] prices: ${message(e)}`);
      return rivals;
    });
    if (signal.aborted) return;
    const fromSpace = new Set((space?.sources ?? []).map((s) => s.url));
    const links = [...new Map([...(info?.sources ?? []), ...(space?.sources ?? [])].filter((s) => /^https?:\/\//i.test(s.url)).map((s) => [s.url, s])).values()];
    const reddit = links.filter((l) => isReddit(l.url)).length;
    const discussions = links.filter((l) => isDiscussion(l.url) && !isReddit(l.url));
    // What the lookup for what's published found comes first; what the other turned up instead of a forum after it.
    const others = links.filter((l) => !isReddit(l.url) && !isDiscussion(l.url));
    const articleLinks = [...others.filter((l) => fromSpace.has(l.url)), ...others.filter((l) => !fromSpace.has(l.url))].filter((l) => fresh(l.url)).slice(0, SCAN_LIMITS.articleTries);
    // The same app in another country's store is the same app.
    const unseen = discussions.filter((l) => {
      const where = postAddress(l.url);
      return (where.kind !== "appstore" || fresh(`app:${where.id}`)) && fresh(l.url);
    });
    const tries = [...unseen.filter((l) => !refusesReaders(l.url)), ...unseen.filter((l) => refusesReaders(l.url))].slice(0, SCAN_LIMITS.tries);
    if (tries.length) step("Reading pages where people talk about it");
    const pagesRead = await readSome(tries, deps.posts, SCAN_LIMITS.pages, signal);
    if (articleLinks.length) step("Reading what's been published about it");
    const articlesRead = await readSome(articleLinks, deps.read, SCAN_LIMITS.articles, signal);
    const notRead: NonNullable<ScanSession["notRead"]> = [...links.filter((l) => isReddit(l.url)).map((l) => ({ url: l.url, why: "reddit" as const })), ...others.filter((l) => !articleLinks.slice(0, articlesRead.tried).includes(l)).map((l) => ({ url: l.url, why: "article" as const })), ...unseen.filter((l) => !tries.slice(0, pagesRead.tried).includes(l)).map((l) => ({ url: l.url, why: "too many" as const })), ...[...pagesRead.refused, ...articlesRead.refused].map((url) => ({ url, why: "unreadable" as const }))];
    for (const p of pagesRead.got) take({ title: p.title, origin: p.url, kind: "page" }, p.text);
    const lookingAt = target.kind === "idea" ? `the market around this idea: ${target.said}` : `the market ${name || "this product"} is in`;
    const inTheirWords = target.kind === "idea" ? " Write page titles and lines in the language this idea is written in, quoting people in theirs." : "";
    for (const p of articlesRead.got) items.push({ ing: { kind: "url", title: p.title.slice(0, 200), origin: p.url, text: p.text.slice(0, SCAN_LIMITS.articleChars) }, read: { title: p.title, origin: p.url, kind: "article" }, basis: "read", focus: `What's known about ${lookingAt}: how many people it's for, what they use today and pay, what keeps them and what loses them, and what they struggle with. Numbers only as the page gives them.${inTheirWords}` });
    // The last word before the reading starts: what they took off isn't read into anything, and isn't proposed again.
    const steer = await steerNow();
    const offNow = offApps(steer);
    items = items.filter((i) => !(i.read.appId && offNow.has(i.read.appId)));
    const takenOff = foundNames.filter((n) => isOff(steer, n)).map((n) => n.toLowerCase());
    rivals = rivals.filter((c) => !isOff(steer, c.name));
    if (rivals.length || takenOff.length) await store.changeMarket((x) => ({ ...withRivals(x, rivals), gone: [...new Set([...x.gone, ...takenOff])] }));
    if (signal.aborted) return;
    await change((s) => ({ ...s, read: items.map((i) => i.read), skipped: { reddit, before, articles: others.length - articlesRead.got.length, unreadable: pagesRead.refused.length }, notRead: notRead.slice(0, 30), ...(noWeb ? { noWeb: true as const } : {}) }));
    if (signal.aborted) return;

    // Taken in together: what's kept is found word for word, and filed once.
    const taken = items.length ? await deps.capture(store, items.map(({ ing, basis, focus }) => ({ ing, ...(basis ? { basis } : {}), ...(focus ? { focus: focusWith(focus, steer) } : {}) })), { emit: step, signal, focus: focusWith(target.kind === "idea" ? `What people struggle with around this idea: ${target.said}.${inTheirWords}` : `What people complain about in ${name || "this product"}`, steer) }) : { sources: [], filed: null, notFound: 0 };
    if (signal.aborted) return;
    const kept = taken.sources.reduce((n, s) => n + s.quotes, 0);
    const problems = (taken.filed?.pages ?? []).filter((p) => p.kind === "need").map((p) => ({ id: p.id, title: p.title }));
    // Only what was read about the market: a page people speak on is a quote, not a fact about it.
    const published = await Promise.all(taken.sources.map(async (t, i) => (t.id && items[i]?.read.kind === "article" ? ((await store.getSource(t.id)) ?? null) : null)));
    const known: ScanKnown[] = [
      ...rivals.flatMap((c) => c.lines.filter((l) => l.url).slice(0, SCAN_LIMITS.knownPerRival).map((l): ScanKnown => ({ kind: "product", name: c.name, text: l.text, title: l.title ?? c.name, url: l.url! }))),
      // A page's numbers first: they're what it's read for.
      ...published.flatMap((p) => (p?.origin ? [...p.quotes].sort((a, b) => +/\p{Nd}/u.test(b.text) - +/\p{Nd}/u.test(a.text)).slice(0, SCAN_LIMITS.knownPerPage).map((q): ScanKnown => ({ kind: "published", text: q.text, title: p.title, url: p.origin! })) : [])),
    ].slice(0, SCAN_LIMITS.known);
    await change((s) => {
      const read = s.read.map((r, i) => (taken.sources[i] ? { ...r, ...(taken.sources[i].id ? { sourceId: taken.sources[i].id } : {}), quotes: taken.sources[i].quotes } : r));
      return { ...s, state: "done", read, checked: { kept, notFound: taken.notFound, unbacked: taken.filed?.unbacked ?? 0 }, problems, ...(known.length ? { known } : {}), thin: isThin(problems.length, peopleQuotes(read)) };
    });
  } catch (e) {
    if (!signal.aborted) await change((s) => ({ ...s, state: "failed", error: message(e) })).catch(() => {});
  } finally {
    if (signal.aborted) await change((s) => (s.state === "reading" ? { ...s, state: "stopped" } : s)).catch(() => {});
    await chain;
  }
}

/** Many pages turn readers away: on to the next until enough have read. */
async function readSome(links: readonly { url: string; title?: string }[], read: (l: { url: string; title?: string }, signal: AbortSignal) => Promise<OutsidePage | null>, max: number, signal: AbortSignal) {
  const got: OutsidePage[] = [];
  const refused: string[] = [];
  let tried = 0;
  while (tried < links.length && got.length < max && !signal.aborted) {
    const batch = links.slice(tried, tried + SCAN_LIMITS.atOnce);
    tried += batch.length;
    for (const [i, p] of (await Promise.all(batch.map((l) => read(l, signal)))).entries()) {
      if (p && got.length < max) got.push(p);
      else if (!p) refused.push(batch[i].url);
    }
  }
  return { got, refused, tried };
}

/**
 * What people use today for what they want to build, and what each offers and charges: found on the
 * web, each kept only where a page read names it, and kept in hub/market.md. Only a person's named
 * competitors go in as named: Qalam AI's from an earlier look may be about something else.
 */
async function competitorsFor(store: OrgStore, o: { org: string; said: string; label: string }, deps: ScanDeps, signal: AbortSignal, step: (label: string) => void): Promise<{ names: string[]; competitors: Competitor[]; pages: OutsidePage[]; noWeb: boolean }> {
  step(o.label);
  const market = await store.getMarket();
  const known = market.competitors.filter((c) => c.by === "you").map((c) => c.name);
  const info = await deps.research({ purpose: "competitors", task: competitorsTask({ org: o.org, facts: market.company, named: known, said: o.said }), connectors: ["web"] }, step, signal);
  if (signal.aborted || !info) return { names: known, competitors: [], pages: [], noWeb: !info };
  if (info.error) console.warn(`[scan] competitors: ${info.error}`);
  const pages = await readLinks(deps, info, signal);
  if (!pages.length || signal.aborted) return { names: known, competitors: [], pages, noWeb: false };
  step("Reading what each one offers");
  const m = competitorsMaterial({ org: o.org, facts: market.company, named: known, notes: info.notes, pages, said: o.said });
  const { data, model } = await deps.structured<unknown>(competitorsCall(m), signal);
  const now = Date.now();
  const found = sanitizeCompetitors(data, m, { org: o.org, now, id: () => `c${nanoid(8)}`, gone: market.gone });
  await store.putTrace({ id: nanoid(10), projectId: "market", kind: "competitors", at: now, ...(model ? { model } : {}), answer: data, kept: found.length } as { id: string; projectId: string }).catch(() => {});
  return { names: found.map((c) => c.name), competitors: found, pages, noWeb: false };
}

/**
 * What each charges, a price line first on its card: its pricing page read by code (at its own site,
 * or the one the App Store gives for its app), beside the pages the lookup read; one call says it, only
 * where a page speaks of a price at all. An app people use that no lookup named joins them only with
 * a price kept. Never the App Store's own pages: Apple's terms bar reading them by program.
 */
async function pricesFor(rivals: readonly Competitor[], apps: ScanSession["competitors"], pages: readonly OutsidePage[], deps: ScanDeps, signal: AbortSignal, step: (label: string) => void): Promise<Competitor[]> {
  const now = Date.now();
  const extra = apps.flatMap((a): Competitor[] => (a.app && !rivals.some((c) => c.name.toLowerCase() === a.name.toLowerCase()) ? [{ id: `c${nanoid(8)}`, name: brandOf(a.app.name), url: a.app.site ?? a.app.url, lines: [], by: "qalam", at: now }] : []));
  const all = [...rivals, ...extra].slice(0, SCAN_LIMITS.priced);
  if (!all.length) return [...rivals];
  step("Looking at what others charge");
  const own = all.flatMap((c) => {
    const site = ownSite(c) ?? ownSite({ name: c.name, url: apps.find((a) => a.name === c.name || a.app?.name === c.name)?.app?.site });
    return site ? [{ url: `${site}/pricing`, title: `${brandOf(c.name)} pricing` }] : [];
  });
  const read = (await Promise.all([...new Map(own.map((l) => [l.url, l])).values()].slice(0, SCAN_LIMITS.pricePages).map((l) => deps.read(l, signal)))).filter((p): p is OutsidePage => !!p);
  const m = pricesMaterial({ names: all.map((c) => c.name), pages: [...read, ...pages] });
  if (!m || signal.aborted) return [...rivals];
  const { data } = await deps.structured<unknown>(pricesCall(m), signal);
  const prices = sanitizePrices(data, m, { now, id: () => `c${nanoid(8)}` });
  const withPrice = (c: Competitor): Competitor => ({ ...c, lines: [...(prices.get(c.name) ?? []), ...c.lines] });
  return [...rivals.map(withPrice), ...extra.filter((c) => prices.has(c.name)).map(withPrice)];
}
