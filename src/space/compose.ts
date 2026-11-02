import type { Doc, FrameNode, SceneNode } from "@/doc/schema";
import { emptyDoc } from "@/doc/schema";
import { isOstCard } from "@/doc/board";
import { newId } from "@/doc/factory";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import type { OstCard } from "@/discovery/types";
import type { Bearing } from "@/goals/bearings";
import { rankForGoal } from "@/goals/problems";
import { ordered } from "@/goals/tree";
import type { Goal, GoalTree } from "@/goals/types";
import type { Notice } from "@/hub/checks";
import type { RankedNeed } from "@/hub/needs";
import { sameTopic } from "@/hub/topics";
import { inSpace, type Space } from "@/ui/frame/spaces";

/*
 * A space's canvas as one document (pure): every goal in the space under the goal it feeds, each
 * goal's board tree under it, the problems behind a goal that aren't on a board yet (faint), the
 * boards no goal has, and the problems customers keep raising that no goal covers. The boards'
 * cards keep their own ids, so the board's editing works on this document as it is, and a change
 * goes back to the board each card is on (./split.ts).
 *
 * Two kinds of card aren't on any board (`virtual`): a goal with no board yet, whose card has the
 * goal's id (adding under it starts its board, with that card as its outcome, so nothing is
 * renamed), and a problem's page that no board has, `topic:<goal or "none">:<topic>`, never saved.
 */

/** What a card on the space's canvas is. */
export type SpaceThing =
  /** A goal: its outcome card on its board, when it has one. */
  | { type: "goal"; goal: string; board?: string }
  /** A card on a board, under a goal or on a board no goal has. */
  | { type: "card"; board: string; goal: string | null }
  /** A problem's page that isn't on a board: behind a goal, or no goal's. */
  | { type: "problem"; topic: string; goal: string | null };

export type SpaceTag = { label: string; tone: "ok" | "warn" | "off" };

/** A board as the space loads it. */
export interface SpaceBoard {
  id: string;
  name: string;
  product: string | null;
  doc: Doc | null;
}

export interface SpaceInput {
  tree: GoalTree;
  boards: readonly SpaceBoard[];
  space: Space;
  links?: readonly Bearing[];
  needs?: readonly RankedNeed[] | null;
  notices?: readonly Notice[];
  /** Products' names, for the goals' tags in the organization's space. */
  products?: readonly { id: string; name: string }[];
}

export interface SpaceDoc {
  doc: Doc;
  things: Map<string, SpaceThing>;
  /** Each card on a board, by the board it's on. */
  boardOf: Map<string, string>;
  /** The cards on no board: goals with no board yet, and problems' pages. */
  virtual: Set<string>;
  /** Drawn faint: problems no board has. */
  faint: Set<string>;
  /** Of those, fainter still: fewer than two sources behind it. */
  fainter: Set<string>;
  /** A word after a card's kind ("No board yet", a product's name). */
  tags: Map<string, SpaceTag>;
  /** Cards something needs a look at. */
  noticed: Set<string>;
  /** Each goal's own cards (its board's and the problems behind it, not its sub-goals'): one sources lane each. */
  groups: { head: string; cards: string[] }[];
  /**
   * Boards that had cards with another board's ids (a copy saved before copies got new ids): what
   * this space shows of them now has ids of its own, saved once. `ids` is old → new.
   */
  fixes: Map<string, { doc: Doc; ids: Map<string, string> }>;
}

/** Every problem is drawn, the weaker ones fainter; these only keep a very large organization's canvas from growing without end. */
export const SPACE_LIMITS = { behind: 100, uncovered: 200 } as const;

export const isProblemPage = (id: string) => id.startsWith("topic:");

export function composeSpace(o: SpaceInput, makeId: () => string = newId): SpaceDoc {
  const doc = emptyDoc();
  const out: SpaceDoc = { doc, things: new Map(), boardOf: new Map(), virtual: new Set(), faint: new Set(), fainter: new Set(), tags: new Map(), noticed: new Set(), groups: [], fixes: new Map() };
  const tree = ordered(o.tree);
  const goals = tree.goals.filter((g) => inSpace(g.product, o.space));
  const here = new Set(goals.map((g) => g.id));
  const productName = new Map((o.products ?? []).map((p) => [p.id, p.name]));

  // Each board's document, with ids another board took first given new ones.
  const docs = new Map<string, Doc>();
  const taken = new Set<string>();
  const moved = new Map<string, Map<string, string>>();
  for (const b of o.boards) {
    if (!b.doc) continue;
    const clash = Object.keys(b.doc.nodes).filter((id) => taken.has(id));
    if (clash.length) {
      const ids = new Map(clash.map((id) => [id, makeId()]));
      const fixed = reid(b.doc, ids);
      out.fixes.set(b.id, { doc: fixed, ids });
      moved.set(b.id, ids);
      docs.set(b.id, fixed);
    } else docs.set(b.id, b.doc);
    for (const id of Object.keys(docs.get(b.id)!.nodes)) taken.add(id);
  }
  const cardOn = (board: string, id: string): FrameNode | null => {
    const n = docs.get(board)?.nodes[id];
    return isOstCard(n) ? n : null;
  };
  // Where each goal's outcome card is: its board's card, when it's there.
  const goalAt = new Map<string, string>();
  const cardAt = new Map<string, { board: string; card: string }>();
  for (const g of goals) {
    if (!g.on) continue;
    const card = moved.get(g.on.board)?.get(g.on.card) ?? g.on.card;
    if (!cardOn(g.on.board, card) || goalAt.has(card)) continue;
    goalAt.set(card, g.id);
    cardAt.set(g.id, { board: g.on.board, card });
  }
  const placed = new Set<string>();
  const topics = new Map<string, string[]>();

  const add = (id: string, card: OstCard, parent: string | null, thing: SpaceThing) => {
    const n = makeCardNode(card);
    n.id = id;
    addCardIn(doc, n, parent);
    out.things.set(id, thing);
  };

  /** A board's cards under `card`, as they sit on it, except a goal's outcome card (it shows as its goal). */
  const addBoardKids = (board: string, card: string, under: string, goal: string | null, group: string[]) => {
    for (const c of cardOn(board, card)?.children ?? []) {
      const n = cardOn(board, c);
      if (!n || goalAt.has(c) || placed.has(c)) continue;
      placed.add(c);
      add(c, n.meta.ost!, under, { type: "card", board, goal });
      out.boardOf.set(c, board);
      group.push(c);
      addBoardKids(board, c, c, goal, group);
    }
  };

  const addProblem = (id: string, need: Pick<RankedNeed, "topic" | "title" | "sources">, by: Bearing["by"] | null, parent: string | null, goal: string | null, tag: string) => {
    add(id, newCard("opportunity", { title: need.title, createdBy: by === "qalam" ? "ai" : "user" }), parent, { type: "problem", topic: need.topic, goal });
    out.virtual.add(id);
    out.faint.add(id);
    if (need.sources < 2) out.fainter.add(id);
    out.tags.set(id, { label: tag, tone: "off" });
    topics.set(need.topic, [...(topics.get(need.topic) ?? []), id]);
  };

  const addGoal = (g: Goal, parent: string | null) => {
    const at = cardAt.get(g.id);
    const id = at?.card ?? g.id;
    const base = at ? cardOn(at.board, at.card)!.meta.ost! : null;
    // goals.md is where a goal lives: its words, number and status win over its card's copy.
    const card: OstCard = { ...(base ?? newCard("outcome", { createdBy: g.by === "qalam" ? "ai" : "user" })), title: g.title, stage: g.status, ...(g.metric ? { metric: g.metric } : {}) };
    if (!g.metric) delete card.metric;
    add(id, card, parent, { type: "goal", goal: g.id, ...(at ? { board: at.board } : {}) });
    const group = [id];
    if (at) {
      placed.add(at.card);
      out.boardOf.set(id, at.board);
      addBoardKids(at.board, at.card, id, g.id, group);
      if (o.space === null && g.product && productName.has(g.product)) out.tags.set(id, { label: productName.get(g.product)!, tone: "off" });
    } else {
      out.virtual.add(id);
      out.tags.set(id, { label: "No board yet", tone: "off" });
    }
    // The problems linked to it right here (not through a goal under it) that no board of its has yet.
    if (o.needs?.length && o.links?.length) {
      // Not one its board has under the same words (put there before the problems were ranked again).
      const own = group.map((c) => doc.nodes[c]?.meta.ost?.title ?? "");
      const behind = rankForGoal(g.id, { tree, links: [...o.links], needs: [...o.needs] }).filter((p) => !p.via && !p.onBoard && !own.some((t) => sameTopic(t, p.title)));
      for (const p of behind.slice(0, SPACE_LIMITS.behind)) {
        const pid = `topic:${g.id}:${p.topic}`;
        addProblem(pid, p, p.by, id, g.id, p.boards.length ? "Other board" : "No board");
        group.push(pid);
      }
    }
    out.groups.push({ head: id, cards: group });
    for (const k of tree.goals) if (k.parent === g.id && here.has(k.id)) addGoal(k, id);
  };

  // The goal tree: the North Star's first, then the goals not under it (or under a goal outside this space).
  for (const g of goals) if (!g.parent || !here.has(g.parent)) addGoal(g, null);

  // The boards no goal has here: each of their trees on its own, named by its board.
  for (const b of o.boards) {
    const d = docs.get(b.id);
    if (!d || !inSpace(b.product, o.space)) continue;
    for (const c of d.roots) {
      const n = cardOn(b.id, c);
      if (!n || placed.has(c) || goalAt.has(c)) continue;
      placed.add(c);
      add(c, n.meta.ost!, null, { type: "card", board: b.id, goal: null });
      out.boardOf.set(c, b.id);
      out.tags.set(c, { label: b.name, tone: "off" });
      const group = [c];
      addBoardKids(b.id, c, c, null, group);
      out.groups.push({ head: c, cards: group });
    }
  }

  // Every problem no goal is linked to and no board has, best backed first.
  const uncovered = (o.needs ?? []).filter((n) => inSpace(n.products, o.space) && !n.boards.length && !o.links?.some((l) => l.need === n.topic));
  for (const n of uncovered.slice(0, SPACE_LIMITS.uncovered)) addProblem(`topic:none:${n.topic}`, n, null, null, null, "No goal yet");

  const shown = (board: string, card: string) => {
    const id = moved.get(board)?.get(card) ?? card;
    return out.boardOf.get(id) === board ? id : undefined;
  };
  for (const n of o.notices ?? []) {
    const ids = [
      n.board && n.card ? shown(n.board, n.card) : undefined,
      n.other ? shown(n.other.board, n.other.card) : undefined,
      n.goal && here.has(n.goal) ? (cardAt.get(n.goal)?.card ?? n.goal) : undefined,
      ...(n.topic ? (topics.get(n.topic) ?? []) : []),
    ];
    for (const id of ids) if (id && out.things.has(id)) out.noticed.add(id);
  }
  return out;
}

/** The goal a card on the canvas is, if it's one. */
export const goalOfCard = (s: Pick<SpaceDoc, "things">, id: string): string | null => {
  const t = s.things.get(id);
  return t?.type === "goal" ? t.goal : null;
};

/** A document with some nodes' ids changed (old → new), every reference to them too. */
function reid(doc: Doc, ids: Map<string, string>): Doc {
  const to = (id: string) => ids.get(id) ?? id;
  const nodes: Record<string, SceneNode> = {};
  for (const [id, n] of Object.entries(doc.nodes)) nodes[to(id)] = { ...n, id: to(id), parentId: n.parentId ? to(n.parentId) : null, children: n.children.map(to) } as SceneNode;
  return { ...doc, nodes, roots: doc.roots.map(to) };
}
