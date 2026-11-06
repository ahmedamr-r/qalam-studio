import { onUsage } from "@/ai/usage";
import type { UsageEntry } from "@/ai/usage-shared";
import type { MarketDeps } from "../../server/org/market";

/**
 * What a run did, as it did it: tokens by side, what was searched, which pages were offered and which
 * refused, and any call that failed. A call that fails falls back quietly in the product (a plan's
 * next step asks code's own questions), and a fallback must void a run rather than read as behaviour.
 */

export interface Tap {
  arm: string;
  usage: (UsageEntry & { arm: string })[];
  searches: { purpose: string; query: string; links: string[]; error?: string; noWeb?: boolean }[];
  pages: { url: string; host: string; read: boolean; chars?: number }[];
  failed: { kind: string; error: string }[];
  steps: string[];
}

export function newTap(): Tap {
  const t: Tap = { arm: "qalam", usage: [], searches: [], pages: [], failed: [], steps: [] };
  // One listener at a time, and these run one after another.
  onUsage((e) => void t.usage.push({ ...e, arm: t.arm }));
  return t;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export function tapped<D extends MarketDeps>(d: D, t: Tap): D {
  return {
    ...d,
    research: async (req, emit, signal) => {
      const info = await d.research(req, emit, signal).catch((e: unknown) => {
        t.searches.push({ purpose: req.purpose, query: req.task.slice(0, 300), links: [], error: e instanceof Error ? e.message : String(e) });
        throw e;
      });
      t.searches.push({ purpose: req.purpose, query: req.task.slice(0, 300), links: info?.sources.map((s) => s.url) ?? [], ...(info?.error ? { error: info.error } : {}), ...(info ? {} : { noWeb: true }) });
      return info;
    },
    read: async (link, signal) => {
      const page = await d.read(link, signal);
      t.pages.push({ url: link.url, host: hostOf(link.url), read: !!page, ...(page ? { chars: page.text.length } : {}) });
      return page;
    },
    structured: async (call, signal) => {
      try {
        return await d.structured(call as never, signal);
      } catch (e) {
        t.failed.push({ kind: String((call as { kind?: unknown }).kind ?? "?"), error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    },
  } as D;
}

export const tokensOf = (t: Tap, arm: string) => t.usage.filter((u) => u.arm === arm).reduce((n, u) => n + u.input + u.output + u.cacheRead + u.cacheWrite, 0);
export const freshTokensOf = (t: Tap, arm: string) => t.usage.filter((u) => u.arm === arm).reduce((n, u) => n + u.input + u.output + u.cacheWrite, 0);
export const costOf = (t: Tap, arm: string) => t.usage.filter((u) => u.arm === arm).reduce((n, u) => n + (u.cost ?? 0), 0);

/** What a side's pages came to, per host: for "what did it try, what refused it". */
export function hostsOf(t: Tap) {
  const by = new Map<string, { offered: number; read: number }>();
  for (const p of t.pages) {
    const h = by.get(p.host) ?? { offered: 0, read: 0 };
    h.offered++;
    if (p.read) h.read++;
    by.set(p.host, h);
  }
  return [...by].map(([host, n]) => ({ host, ...n })).sort((a, b) => b.offered - a.offered);
}
