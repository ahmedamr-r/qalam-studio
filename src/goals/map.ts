import type { Doc } from "@/doc/schema";
import { emptyDoc } from "@/doc/schema";
import type { Box } from "@/doc/geometry";
import type { MapBoard } from "@/discovery/board-cards";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import type { OstCard } from "@/discovery/types";
import type { Notice } from "@/hub/checks";
import type { RankedNeed } from "@/hub/needs";
import { inSpace } from "@/ui/frame/spaces";
import { layoutSpace } from "@/space/layout";
import type { Bearing } from "./bearings";
import { rankForGoal } from "./problems";
import { ordered } from "./tree";
import type { Goal, GoalTree } from "./types";

/*
 * A space's map (pure): every goal in the space as one picture, each goal under the goal it feeds,
 * its board's tree hanging under it (its problems, solutions and tests), the problems behind it
 * that aren't on its board yet, then the boards no goal has, and on the right the problems
 * customers keep raising that no goal covers. It's worked out from the goals, the boards and the
 * links between them each time, as one document the board's painter draws, and nothing in it is
 * kept: editing happens on the boards. Ids are the map's own, so cards from two boards never meet:
 * `goal:<id>`, `<board>:<card>`, `topic:<goal or "none">:<topic>`.
 */

/** What a card on the map is. */
export type MapThing =
  /** A goal: its outcome card on its board, when it has one. */
  | { type: "goal"; goal: string; board?: string; card?: string }
  /** A card on a board, under a goal or on a board no goal has. */
  | { type: "card"; board: string; card: string; goal: string | null }
  /** A problem's page that isn't on a board: behind a goal, or no goal's. */
  | { type: "problem"; topic: string; goal: string | null };

export type MapTag = { label: string; tone: "ok" | "warn" | "off" };

export interface SpaceMap {
  doc: Doc;
  things: Map<string, MapThing>;
  /** Drawn faint: what isn't on a board yet. */
  faint: Set<string>;
  /** A word after a card's kind ("No board yet", a product's name). */
  tags: Map<string, MapTag>;
  /** Cards something needs a look at. */
  noticed: Set<string>;
  /** Each goal's own cards (its board's and the problems behind it, not its sub-goals'): one sources lane each. */
  groups: { head: string; cards: string[] }[];
  /** A board's card on the map, by `<board>:<card>`. */
  byCard: Map<string, string>;
}

export interface MapInput {
  tree: GoalTree;
  boards: readonly MapBoard[];
  space: string | null;
  links?: readonly Bearing[];
  needs?: readonly RankedNeed[] | null;
  notices?: readonly Notice[];
  /** Products' names, for the goals' tags in the organization's space. */
  products?: readonly { id: string; name: string }[];
  /** Folded or unfolded on the map (never saved), over the boards' own folds. */
  folds?: ReadonlyMap<string, boolean>;
}

export const MAP_LIMITS = { behind: 3, uncovered: 8 } as const;

export function mapOf(o: MapInput): SpaceMap {
  const doc = emptyDoc();
  const out: SpaceMap = { doc, things: new Map(), faint: new Set(), tags: new Map(), noticed: new Set(), groups: [], byCard: new Map() };
  const tree = ordered(o.tree);
  const goals = tree.goals.filter((g) => inSpace(g.product, o.space));
  const here = new Set(goals.map((g) => g.id));
  const cardsOf = new Map(o.boards.map((b) => [b.id, new Map(b.cards.map((c) => [c.id, c]))]));
  const kidsOf = new Map(
    o.boards.map((b) => {
      const kids = new Map<string | null, string[]>();
      for (const c of b.cards) kids.set(c.parent, [...(kids.get(c.parent) ?? []), c.id]);
      return [b.id, kids] as const;
    }),
  );
  // A goal's own outcome card shows as the goal, wherever it sits on its board.
  const goalAt = new Map<string, string>();
  for (const g of goals) if (g.on && cardsOf.get(g.on.board)?.has(g.on.card)) goalAt.set(`${g.on.board}:${g.on.card}`, g.id);
  const placed = new Set<string>();
  const topics = new Map<string, string[]>();
  const productName = new Map((o.products ?? []).map((p) => [p.id, p.name]));

  const add = (id: string, card: OstCard, parent: string | null, thing: MapThing) => {
    const folded = o.folds?.get(id) ?? !!card.collapsed;
    const n = makeCardNode({ ...card, collapsed: folded || undefined });
    n.id = id;
    addCardIn(doc, n, parent);
    out.things.set(id, thing);
  };

  /** A board's cards under `card`, as they sit on it, except a goal's outcome card (it shows as its goal). */
  const addBoardKids = (board: string, card: string, under: string, goal: string | null, group: string[]) => {
    for (const c of kidsOf.get(board)?.get(card) ?? []) {
      const key = `${board}:${c}`;
      if (goalAt.has(key) || placed.has(key)) continue;
      placed.add(key);
      add(key, cardsOf.get(board)!.get(c)!.card, under, { type: "card", board, card: c, goal });
      out.byCard.set(key, key);
      group.push(key);
      addBoardKids(board, c, key, goal, group);
    }
  };

  const addProblem = (id: string, need: Pick<RankedNeed, "topic" | "title">, by: Bearing["by"] | null, parent: string | null, goal: string | null, tag: string) => {
    add(id, newCard("opportunity", { title: need.title, createdBy: by === "qalam" ? "ai" : "user" }), parent, { type: "problem", topic: need.topic, goal });
    out.faint.add(id);
    out.tags.set(id, { label: tag, tone: "off" });
    topics.set(need.topic, [...(topics.get(need.topic) ?? []), id]);
  };

  const addGoal = (g: Goal, parent: string | null) => {
    const id = `goal:${g.id}`;
    const at = g.on && goalAt.get(`${g.on.board}:${g.on.card}`) === g.id ? g.on : null;
    const base = at ? cardsOf.get(at.board)!.get(at.card)!.card : null;
    // goals.md is where a goal lives: its words, number and status win over its card's copy.
    const card: OstCard = { ...(base ?? newCard("outcome", { createdBy: g.by === "qalam" ? "ai" : "user" })), title: g.title, stage: g.status, ...(g.metric ? { metric: g.metric } : {}) };
    add(id, card, parent, { type: "goal", goal: g.id, ...(at ? { board: at.board, card: at.card } : {}) });
    const group = [id];
    if (at) {
      placed.add(`${at.board}:${at.card}`);
      out.byCard.set(`${at.board}:${at.card}`, id);
      addBoardKids(at.board, at.card, id, g.id, group);
    }
    if (!at) out.tags.set(id, { label: "No board yet", tone: "off" });
    else if (o.space === null && g.product && productName.has(g.product)) out.tags.set(id, { label: productName.get(g.product)!, tone: "off" });
    // The problems linked to it right here (not through a goal under it) that no board of its has yet.
    if (o.needs?.length && o.links?.length) {
      const behind = rankForGoal(g.id, { tree, links: [...o.links], needs: [...o.needs] }).filter((p) => !p.via && !p.onBoard);
      for (const p of behind.slice(0, MAP_LIMITS.behind)) {
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
    if (!inSpace(b.product, o.space)) continue;
    for (const c of kidsOf.get(b.id)?.get(null) ?? []) {
      const key = `${b.id}:${c}`;
      if (placed.has(key) || goalAt.has(key)) continue;
      placed.add(key);
      add(key, cardsOf.get(b.id)!.get(c)!.card, null, { type: "card", board: b.id, card: c, goal: null });
      out.byCard.set(key, key);
      out.tags.set(key, { label: b.name, tone: "off" });
      const group = [key];
      addBoardKids(b.id, c, key, null, group);
      out.groups.push({ head: key, cards: group });
    }
  }

  // What customers keep raising (two sources or more) that no goal is linked to and no board has.
  const uncovered = (o.needs ?? []).filter((n) => inSpace(n.products, o.space) && n.sources >= 2 && !n.boards.length && !o.links?.some((l) => l.need === n.topic));
  for (const n of uncovered.slice(0, MAP_LIMITS.uncovered)) addProblem(`topic:none:${n.topic}`, n, null, null, null, "No goal yet");

  for (const n of o.notices ?? []) {
    const ids = [
      n.board && n.card ? out.byCard.get(`${n.board}:${n.card}`) : undefined,
      n.other ? out.byCard.get(`${n.other.board}:${n.other.card}`) : undefined,
      n.goal && out.things.has(`goal:${n.goal}`) ? `goal:${n.goal}` : undefined,
      ...(n.topic ? (topics.get(n.topic) ?? []) : []),
    ];
    for (const id of ids) if (id) out.noticed.add(id);
  }
  return out;
}

/**
 * Where everything on the map goes (src/space/layout.ts): the trees side by side, the problems no
 * goal covers in a column on the right, each goal's lane in a column of its own (`slots`).
 */
export function layoutMap(map: SpaceMap, lanes?: ReadonlyMap<string, number>): { doc: Doc; slots: Map<string, Box> } {
  return layoutSpace(map.doc, {
    lanes,
    column: (id) => {
      const t = map.things.get(id);
      return t?.type === "problem" && !t.goal;
    },
    isGoal: (id) => map.things.get(id)?.type === "goal",
  });
}
