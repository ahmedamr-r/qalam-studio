import type { Notice } from "@/hub/checks";
import { orgFetch, orgJson } from "./client";

/**
 * What needs a look in the organization (server/org/notices.ts): code's checks and Qalam AI's
 * reviews, less what the team dismissed. Dismissing, linking two cards as the same need and a
 * review's findings are written here; this window's writes are announced to its own pages.
 */

export interface NoticesNow {
  notices: Notice[];
  lastVisit: number | null;
  reviewedAt: number | null;
  dismissed: number;
}

export interface CardLink {
  kind: "same-need";
  a: string;
  b: string;
  at: number;
  by: "you" | "qalam";
}

export interface LinkedCard {
  ref: string;
  board: string;
  boardName: string;
  card: string;
  title: string;
  at: number;
}

const listeners = new Set<() => void>();
/** Hear about this window's own changes (the server announces only other windows'). */
export function onNoticesWritten(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const written = () => listeners.forEach((fn) => fn());

export const noticesDb = {
  /** Everything, or what's about one board's cards. */
  list: (board?: string) => orgJson<NoticesNow>(`/notices${board ? `?board=${encodeURIComponent(board)}` : ""}`),
  dismiss: async (key: string, on = true) => {
    await orgFetch("/notices/dismiss", { method: "POST", json: { key, on } });
    written();
  },
  /** This computer opened the home: returns its last visit before now. */
  visit: async () => (await orgJson<{ previous: number | null }>("/notices/visit", { method: "POST", json: {} })).previous,
  /** Review now: Qalam AI reads the organization; what code kept of its findings joins the notices. */
  review: async () => {
    const r = await orgJson<{ findings: Notice[] }>("/review", { method: "POST", json: {} });
    written();
    return r.findings;
  },
  links: () => orgJson<CardLink[]>("/relations"),
  /** The cards on other boards a card is linked to as the same need. */
  linkedTo: (ref: string) => orgJson<LinkedCard[]>(`/relations?card=${encodeURIComponent(ref)}`),
  /** Two cards on different boards are the same need (or aren't, after all). */
  link: async (a: string, b: string, on = true) => {
    await orgFetch("/relations", { method: "POST", json: { a, b, on } });
    written();
  },
};
