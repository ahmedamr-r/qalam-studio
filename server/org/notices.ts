import { pairKey, runChecks, type CheckBoard, type CheckInput, type Notice, type ShownOn } from "@/hub/checks";
import { indexFor } from "../index/registry";
import { showsUp } from "../index/search";
import type { OrgStore } from "./store";

/**
 * What needs a look in an organization, now: code's checks over its boards, decisions and topic
 * pages (src/hub/checks.ts), what Qalam AI's reviews found, less what the team dismissed. Run when
 * asked (the home, a board): it costs reading the folder's boards, never a model call. Without the
 * search index here, the checks that need what pages cite are left out.
 */

export interface NoticesNow {
  notices: Notice[];
  /** When this computer last opened the organization's home: newer notices are new. */
  lastVisit: number | null;
  /** When Qalam AI last reviewed the organization. */
  reviewedAt: number | null;
  /** How many were dismissed. */
  dismissed: number;
}

export async function noticesNow(store: OrgStore, now = Date.now()): Promise<NoticesNow> {
  const boards: CheckBoard[] = [];
  for (const p of store.listProjects()) {
    if (p.type !== "discovery") continue;
    const doc = (await store.getDoc(p.id).catch(() => null))?.doc ?? null;
    boards.push({ id: p.id, name: p.name, product: p.product ?? null, createdAt: p.createdAt, doc });
  }
  const topics = await store.listTopics();
  const relations = await store.listRelations();
  const input: CheckInput = { now, boards, decisions: store.listDecisions(), topics, indexed: false, shows: new Map(), pieces: new Map(), linked: new Set(relations.map((r) => pairKey(r.a, r.b))) };
  try {
    const ix = indexFor(store);
    // Caught up with the folder first: a page's pieces not indexed yet would look gone.
    await ix.settled();
    const cited = [...new Set(topics.flatMap((t) => t.lines.flatMap((l) => [...l.cites, ...(l.disputes ?? []).flatMap((d) => d.cites)])))];
    for (const [ref, row] of ix.piecesByRef(cited)) input.pieces.set(ref, { type: row.type, sub: row.sub, source: row.source, stage: row.stage, at: row.at });
    for (const t of topics) {
      const refs = [...new Set(t.lines.flatMap((l) => l.cites))];
      input.shows.set(
        t.id,
        showsUp(ix, t.title, refs).map((s): ShownOn => ({ ref: s.ref, board: s.board, card: s.card, kind: s.kind, shared: s.shared })),
      );
    }
    input.indexed = true;
  } catch {
    // No index here (Node without full-text search): the checks that need it wait.
  }
  const state = await store.noticeState();
  const all = [...runChecks(input), ...state.found];
  return {
    notices: all.filter((n) => !state.dismissed.has(n.key)).sort((a, b) => b.at - a.at),
    lastVisit: store.lastVisit,
    reviewedAt: state.reviewedAt,
    dismissed: all.filter((n) => state.dismissed.has(n.key)).length,
  };
}
