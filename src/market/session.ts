import type { Competitor, MarketLine } from "./types";

/*
 * The first run's lookups on their way into hub/market.md (chats/market/session.json: this
 * computer's, out of Git): each one looking (with what it's doing), ready with what it found for
 * them to check, settled once they did, or failed. Pure; the core runs them (server/org/market.ts)
 * and the window's thread is worked out from it (src/ui/onboarding/thread.ts).
 */

export type LookState = "looking" | "ready" | "settled" | "failed";

export interface Look {
  state: LookState;
  at: number;
  /** What it's doing, the newest last ("Searched the web: example"). */
  steps: string[];
  error?: string;
  /** No web search on this computer: they're asked in words instead. */
  noWeb?: boolean;
  /** The pages it read. */
  pages?: { title: string; url: string }[];
}

export interface CompanyLook extends Look {
  site?: string;
  said?: string;
  facts: MarketLine[];
  /** How many they kept, once settled. */
  kept?: number;
}

export interface CompetitorsLook extends Look {
  /** The names they gave (none: Qalam AI looks for them). */
  named: string[];
  found: Competitor[];
  kept?: number;
}

export interface DomainLook extends Look {
  aims: number;
  struggles: number;
}

export interface MarketSession {
  v: 1;
  company?: CompanyLook;
  competitors?: CompetitorsLook;
  domain?: DomainLook;
}

export const emptySession = (): MarketSession => ({ v: 1 });

const LOOKS = ["company", "competitors", "domain"] as const;
export type LookName = (typeof LOOKS)[number];

/** Whether what was read has a look still "looking" that nothing runs. */
export const lookingUnrun = (s: MarketSession | null, running: (look: LookName) => boolean) => LOOKS.some((name) => s?.[name]?.state === "looking" && !running(name));

/** A session as read from its file; a look still "looking" that nothing runs (`running`) was stopped when the core did. */
export function sessionOf(raw: unknown, running: (look: LookName) => boolean = () => false): MarketSession {
  const s = raw && typeof raw === "object" && (raw as MarketSession).v === 1 ? (raw as MarketSession) : emptySession();
  const out: MarketSession = { v: 1 };
  for (const name of LOOKS) {
    const look = s[name];
    if (!look || typeof look !== "object") continue;
    const stale = look.state === "looking" && !running(name);
    (out as unknown as Record<string, Look>)[name] = stale ? { ...look, state: "failed", error: "It stopped before it finished: look again." } : look;
  }
  return out;
}

/** Where the first run stands on the company: nothing yet, looking, waiting on them, or settled. */
export const companySettled = (s: MarketSession | null | undefined) => s?.company?.state === "settled";
