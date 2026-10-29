import type { OstCard } from "@/discovery/types";
import { funnelOf } from "@/code/map";
import { foldPins } from "@/code/steps";
import { foldBearings, type Bearing } from "@/goals/bearings";
import type { GoalWork } from "@/goals/breakdown";
import type { GoalTree } from "@/goals/types";
import { pairKey, runChecks, type CheckBoard, type CheckInput, type Notice } from "@/hub/checks";
import { knowledgeInputs } from "./needs";
import { workCache } from "../connectors/work";
import type { OrgStore } from "./store";

type Node = { parentId?: string | null; meta?: { ost?: OstCard } };

/** The goals a notice bears on: the goal it's about, its card's (the outcome above it works on one), its page's links. */
function withGoals(n: Notice, boards: CheckBoard[], tree: GoalTree, links: Bearing[]): Notice {
  const out = new Set<string>(n.goal ? [n.goal] : []);
  const ofCard = (board: string | undefined, card: string | undefined) => {
    const nodes = (boards.find((b) => b.id === board)?.doc?.nodes ?? {}) as unknown as Record<string, Node>;
    for (let id: string | null | undefined = card; id; id = nodes[id]?.parentId) {
      if (nodes[id]?.meta?.ost?.kind !== "outcome") continue;
      const g = tree.goals.find((x) => x.on?.board === board && x.on?.card === id);
      if (g) return out.add(g.id);
    }
  };
  if (n.card) ofCard(n.board, n.card);
  if (n.other) ofCard(n.other.board, n.other.card);
  if (n.topic) for (const l of links) if (l.need === n.topic) out.add(l.goal);
  return out.size ? { ...n, goals: [...out] } : n;
}

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
  const goals = await store.getGoals();
  // Goals' funnels with PostHog's counts, and what's pinned at their steps.
  const maps = await store.listMaps();
  const funnels: NonNullable<CheckInput["funnels"]> = [];
  for (const g of goals.goals) {
    const f = g.status === "active" ? funnelOf(g, maps) : null;
    const numbers = f ? (await store.getGoalWork(g.id).catch(() => ({}) as GoalWork)).funnel : undefined;
    if (f && numbers) funnels.push({ goal: g.id, map: f.map.key, flow: f.flow, numbers });
  }
  const stepPins = funnels.length ? foldPins(await store.listStepLog()).pins : [];
  const input: CheckInput = { now, boards, decisions: store.listDecisions(), topics: k.topics, indexed: k.indexed, shows: k.shows, pieces: k.pieces, linked: new Set(relations.map((r) => pairKey(r.a, r.b))), placed, work: await workCache(store), goals, funnels, stepPins };
  const state = await store.noticeState();
  const { links } = foldBearings(await store.listBearingLog());
  const all = [...runChecks(input), ...state.found].map((n) => withGoals(n, boards, goals, links));
  return {
    notices: all.filter((n) => !state.dismissed.has(n.key)).sort((a, b) => b.at - a.at),
    lastVisit: store.lastVisit,
    reviewedAt: state.reviewedAt,
    dismissed: all.filter((n) => state.dismissed.has(n.key)).length,
  };
}
