import { aiConfigured, importFromTools } from "@/ai/server";
import { fetchGuarded } from "@/discovery/fetch-guard";
import type { Ingested } from "@/discovery/ingest/core";
import { captureText, captureTitle } from "@/discovery/ingest/text";
import { feedDue, withSeen, type Feed } from "@/org/feeds";
import { captureSource } from "./capture";
import { ingestBytes } from "./ingest";
import { contentHash } from "./org/fsx";
import type { OrgStore } from "./org/store";

/**
 * Feeds, pulled by the core while an organization is open (src/org/feeds.ts): every ten minutes it
 * looks for feeds that are due and pulls them one at a time. A page or export is read like a page
 * added by hand; a connected tool is asked for what the feed names, each item word for word. Only
 * what the feed hasn't seen before is captured (server/capture.ts): kept as a source of the feed's
 * product, read, filed and placed. Without Qalam AI set up, feeds wait.
 */

const TICK_MS = 10 * 60_000;
const FIRST_MS = 30_000;
/** Items one pull captures at most (each is several calls to Qalam AI); the rest come next time. */
const PER_PULL = 5;

export interface PullDeps {
  fetchPage: (url: string, signal: AbortSignal) => Promise<Ingested>;
  fromTools: (request: string, connectors: string[], signal: AbortSignal) => Promise<Ingested[]>;
  capture: (store: OrgStore, ing: Ingested, product: string | null, signal: AbortSignal) => Promise<unknown>;
}

const realDeps: PullDeps = {
  fetchPage: async (url, signal) => {
    const page = await fetchGuarded(url, { signal });
    const bytes = page.body.buffer.slice(page.body.byteOffset, page.body.byteOffset + page.body.byteLength) as ArrayBuffer;
    const name = decodeURIComponent(new URL(page.url).pathname.split("/").pop() || "page") || "page";
    return ingestBytes(bytes, page.contentType.split(";")[0].trim(), name, page.url);
  },
  fromTools: async (request, connectors, signal) => {
    const info = await importFromTools(`Bring in: ${request}`, connectors, signal);
    if (!info) throw new Error("None of those tools is connected here.");
    if (!info.captures?.length) {
      if (info.error) throw new Error(info.error);
      return [];
    }
    return info.captures.map((c) => {
      const text = captureText(c.text);
      return { kind: "connector" as const, title: captureTitle(text, c.title), origin: c.url ?? connectors.join(", "), text };
    }).filter((c) => c.text);
  },
  capture: (store, ing, product, signal) => captureSource(store, ing, { product, signal }),
};

/** Pull one feed now: what it brings that's new is captured. Returns how many sources it added. */
export async function pullFeed(store: OrgStore, id: string, deps: PullDeps = realDeps, signal: AbortSignal = AbortSignal.timeout(10 * 60_000)): Promise<{ added: number; error?: string }> {
  const f = (await store.listFeeds()).find((x) => x.id === id);
  if (!f) return { added: 0, error: "No such feed" };
  const done = (patch: Partial<Feed>) => store.changeFeeds((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  try {
    const items = f.kind === "url" ? [await deps.fetchPage(f.url!, signal)] : await deps.fromTools(f.request!, f.connectors ?? [], signal);
    const fresh = items.map((ing) => ({ ing, hash: contentHash(ing.text) })).filter((x, i, a) => !(f.seen ?? []).includes(x.hash) && a.findIndex((y) => y.hash === x.hash) === i);
    const taken = fresh.slice(0, PER_PULL);
    for (const { ing } of taken) await deps.capture(store, { ...ing, title: f.kind === "url" ? `${f.label}, ${new Date().toISOString().slice(0, 10)}` : ing.title }, f.product, signal);
    const cur = (await store.listFeeds()).find((x) => x.id === id) ?? f;
    // What's left of a big pull isn't marked seen: the next tick pulls it.
    await done({ last: Date.now(), error: undefined, seen: withSeen(cur, taken.map((x) => x.hash)), added: (cur.added ?? 0) + taken.length, more: fresh.length > taken.length || undefined });
    return { added: taken.length };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await done({ last: Date.now(), error });
    return { added: 0, error };
  }
}

// One runner per store, whichever copy of this module asks (the dev server loads it afresh after an edit).
const g = globalThis as { __qalamFeeds?: WeakMap<OrgStore, unknown> };
const runners = (g.__qalamFeeds ??= new WeakMap());

/** Pull an organization's due feeds while its store is open. */
export function startFeeds(store: OrgStore) {
  if (runners.has(store) || process.env.QALAM_NO_FEEDS) return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  const tick = async () => {
    timer = null;
    if (!running && aiConfigured()) {
      running = true;
      try {
        for (const f of await store.listFeeds()) if (feedDue(f, Date.now())) await pullFeed(store, f.id);
      } catch (e) {
        console.warn(`[qalam] feeds: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        running = false;
      }
    }
    timer = setTimeout(() => void tick(), TICK_MS);
    timer.unref?.();
  };
  timer = setTimeout(() => void tick(), FIRST_MS);
  timer.unref?.();
  runners.set(store, true);
  store.events.once("dispose", () => timer && clearTimeout(timer));
}
