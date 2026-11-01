import { create } from "zustand";
import { emptyMarket, type Market } from "@/market/types";
import { emptySession, type MarketSession } from "@/market/session";
import { orgFetch, orgJson } from "./client";
import { onOrgChange } from "./live";

/*
 * What's known about the company, its competitors and its domain (hub/market.md), and the first
 * run's lookups on their way there, in the window: loaded once, then followed as the core moves
 * them on (server/org/market.ts announces each change).
 */

interface MarketState {
  market: Market;
  session: MarketSession;
  loaded: boolean;
  error: string | null;
}

export const useMarket = create<MarketState>(() => ({ market: emptyMarket(), session: emptySession(), loaded: false, error: null }));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
let following: (() => void) | null = null;

export async function loadMarket(): Promise<void> {
  following ??= onOrgChange((c) => {
    if (c.kind === "market") void loadMarket();
  });
  try {
    const r = await orgJson<{ market: Market; session: MarketSession }>("/market");
    useMarket.setState({ market: r.market, session: r.session, loaded: true, error: null });
  } catch (e) {
    useMarket.setState({ loaded: true, error: message(e) });
  }
}

async function send(path: string, init: { method: string; json?: unknown }): Promise<void> {
  useMarket.setState({ error: null });
  try {
    const body = (await (await orgFetch(path, init)).json().catch(() => null)) as MarketSession | null;
    if (body?.v === 1) useMarket.setState({ session: body });
    await loadMarket();
  } catch (e) {
    useMarket.setState({ error: message(e) });
  }
}

/** Look the company up: its website, or their own line about it. */
export const lookUpCompany = (o: { site?: string; said?: string }) => send("/market/company", { method: "POST", json: o });

/** Their decisions on the company's facts, and facts of their own. */
export const settleCompany = (decisions: { id: string; keep: boolean; text?: string }[], added: string[] = []) => send("/market/company", { method: "PUT", json: { decisions, added } });

export const stopCompany = () => send("/market/company", { method: "DELETE" });

/** Look for the competitors they named (none: the main ones). */
export const lookForCompetitors = (named: string[]) => send("/market/competitors", { method: "POST", json: { named } });

/** The competitors they keep (by id), and any they add by name. */
export const settleCompetitors = (keep: string[], added: string[] = []) => send("/market/competitors", { method: "PUT", json: { keep, added } });
