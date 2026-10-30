/**
 * Comments on cards (pure): a team's questions and notes to each other about a card, kept in
 * hub/comments.jsonl a line per change (written, resolved), never rewritten, so two people's lines
 * merge in Git (union merge). A comment is the team's talk, not evidence: it never backs a card and
 * Qalam AI doesn't read it as what customers said.
 */

export interface CardComment {
  id: string;
  /** The card it's on (hub:card:<board>:<card>). */
  card: string;
  text: string;
  /** Who wrote it, as their computer names them. */
  who?: string;
  at: number;
  resolved?: { at: number; who?: string };
}

/** A line of the log: a comment written, or one resolved (or opened again). */
export type CommentLogEntry = { comment: CardComment } | { resolve: string; at: number; who?: string; open?: boolean };

export const COMMENT_MAX = 2000;
const CARD = /^hub:card:[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,64}$/;
export const isCardRef = (v: unknown): v is string => typeof v === "string" && CARD.test(v);

/** The comments as they are now, from the log's lines in order (a broken line is skipped). */
export function commentsFromLog(entries: unknown[]): CardComment[] {
  const byId = new Map<string, CardComment>();
  for (const raw of entries) {
    const e = raw as Record<string, unknown> | null;
    if (!e || typeof e !== "object") continue;
    const c = e.comment as Partial<CardComment> | undefined;
    if (c && typeof c.id === "string" && isCardRef(c.card) && typeof c.text === "string" && c.text.trim() && typeof c.at === "number") {
      if (!byId.has(c.id)) byId.set(c.id, { id: c.id, card: c.card, text: c.text.slice(0, COMMENT_MAX), at: c.at, ...(typeof c.who === "string" && c.who.trim() ? { who: c.who.trim().slice(0, 80) } : {}) });
      continue;
    }
    if (typeof e.resolve === "string") {
      const hit = byId.get(e.resolve);
      if (!hit) continue;
      if (e.open === true) delete hit.resolved;
      else hit.resolved = { at: typeof e.at === "number" ? e.at : 0, ...(typeof e.who === "string" && e.who.trim() ? { who: e.who.trim().slice(0, 80) } : {}) };
    }
  }
  return [...byId.values()].sort((a, b) => a.at - b.at);
}
