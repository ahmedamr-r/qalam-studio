import { pairKey, runChecks, type CheckBoard, type CheckInput, type Notice } from "@/hub/checks";
import { knowledgeInputs } from "./needs";
import { workCache } from "../connectors/work";
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
  const relations = await store.listRelations();
  const sources = await store.listSources();
  const placed = (await store.listPlacements()).flatMap((p) => {
    const s = sources.find((x) => x.id === p.sourceId);
    return s ? [{ board: p.board, sourceId: s.id, title: s.title, count: p.proposals.length, at: s.addedAt }] : [];
  });
  const k = await knowledgeInputs(store);
  const input: CheckInput = { now, boards, decisions: store.listDecisions(), topics: k.topics, indexed: k.indexed, shows: k.shows, pieces: k.pieces, linked: new Set(relations.map((r) => pairKey(r.a, r.b))), placed, work: await workCache(store) };
  const state = await store.noticeState();
  const all = [...runChecks(input), ...state.found];
  return {
    notices: all.filter((n) => !state.dismissed.has(n.key)).sort((a, b) => b.at - a.at),
    lastVisit: store.lastVisit,
    reviewedAt: state.reviewedAt,
    dismissed: all.filter((n) => state.dismissed.has(n.key)).length,
  };
}
