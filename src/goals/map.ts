import { produce } from "immer";
import type { Doc, FrameNode } from "@/doc/schema";
import { emptyDoc } from "@/doc/schema";
import { isOstCard } from "@/doc/board";
import type { Box } from "@/doc/geometry";
import type { MapBoard } from "@/discovery/board-cards";
import { GAPS, layoutTree, type LayoutNode } from "@/discovery/layout";
import { LANE_GAP, LANE_ITEM_H, LANE_ROW_GAP, LANE_W } from "@/discovery/lane";
import { cardBox } from "@/discovery/metrics";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import { TREE_GAP } from "@/discovery/pass";
import type { OstCard } from "@/discovery/types";
import type { Notice } from "@/hub/checks";
import type { RankedNeed } from "@/hub/needs";
import { inSpace } from "@/ui/frame/spaces";
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
        addProblem(pid, p, p.by, id, g.id, "Not on its board");
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

/** What a goal's sources lane takes on its left, as the layout keeps room for it. */
const LANE_ROOM = LANE_W + LANE_GAP - GAPS.tb.branchGap;
/** The column of problems no goal covers: one under another. */
const COLUMN_GAP = 24;

/**
 * Where everything on the map goes: each tree laid out as a board lays its trees out (sizes from
 * the cards, the same tidy tree), the trees side by side from the left, the problems no goal
 * covers in a column on the right. With `lanes` (how many sources each goal's lane holds), each
 * goal keeps a column at the left of its own cards for its lane, so no lane lands on another
 * tree; `slots` says where each one is.
 */
export function layoutMap(map: SpaceMap, lanes?: ReadonlyMap<string, number>): { doc: Doc; slots: Map<string, Box> } {
  const slots = new Map<string, Box>();
  const doc = produce(map.doc, (d) => {
    const own = (id: string) => (d.nodes[id] as FrameNode).children.filter((c) => isOstCard(d.nodes[c]));
    const sized = (id: string, kids: (id: string) => string[]): LayoutNode => {
      const n = d.nodes[id] as FrameNode;
      const box = cardBox(n.meta.ost!);
      return { id, w: box.w, h: box.h, kids: n.meta.ost!.collapsed ? [] : kids(id).map((c) => sized(c, kids)) };
    };
    /** How deep a goal's own cards go (not its sub-goals'): its lane's column runs that far. */
    const depthOf = (id: string) => {
      const t = sized(id, (x) => own(x).filter((c) => x !== id || map.things.get(c)?.type !== "goal"));
      const at = layoutTree(t, { orientation: "tb" });
      let bottom = 0;
      const walk = (n: LayoutNode) => {
        bottom = Math.max(bottom, at.get(n.id)!.y + n.h);
        n.kids.forEach(walk);
      };
      walk(t);
      return bottom - t.h - GAPS.tb.levelGap;
    };
    const layoutNode = (id: string): LayoutNode => {
      const n = d.nodes[id] as FrameNode;
      const box = cardBox(n.meta.ost!);
      const kids = n.meta.ost!.collapsed ? [] : own(id).map(layoutNode);
      const rows = lanes?.get(id) ?? 0;
      // The lane's column, first among its children: the goal's own cards start right of it.
      if (rows && kids.length) kids.unshift({ id: `lane:${id}`, w: LANE_ROOM, h: Math.max(rows * (LANE_ITEM_H + LANE_ROW_GAP), depthOf(id)), kids: [] });
      return { id, w: box.w, h: box.h, kids };
    };
    let x = 0;
    const column: string[] = [];
    for (const root of d.roots) {
      const thing = map.things.get(root);
      if (thing?.type === "problem" && !thing.goal) {
        column.push(root);
        continue;
      }
      const t = layoutNode(root);
      const at = layoutTree(t, { orientation: "tb" });
      let x0 = Infinity;
      let x1 = -Infinity;
      const span = (n: LayoutNode) => {
        x0 = Math.min(x0, at.get(n.id)!.x);
        x1 = Math.max(x1, at.get(n.id)!.x + n.w);
        n.kids.forEach(span);
      };
      span(t);
      const r = d.nodes[root] as FrameNode;
      r.x = x - x0;
      r.y = 0;
      write(d, t, at, { x: 0, y: 0 }, null, slots, { x: r.x, y: r.y });
      x += x1 - x0 + TREE_GAP;
    }
    let y = 0;
    for (const id of column) {
      const n = d.nodes[id] as FrameNode;
      const box = cardBox(n.meta.ost!);
      n.w = box.w;
      n.h = box.h;
      n.x = x;
      n.y = y;
      y += box.h + COLUMN_GAP;
    }
  });
  return { doc, slots };
}

/** Sizes, positions relative to each parent card, what's folded away hidden; a lane's column into `slots` (world). */
function write(d: Doc, t: LayoutNode, at: Map<string, { x: number; y: number }>, abs: { x: number; y: number }, parentAbs: { x: number; y: number } | null, slots: Map<string, Box>, origin: { x: number; y: number }) {
  const n = d.nodes[t.id] as FrameNode;
  n.w = t.w;
  n.h = t.h;
  if (parentAbs) {
    n.x = abs.x - parentAbs.x;
    n.y = abs.y - parentAbs.y;
  }
  n.visible = true;
  for (const k of t.kids) {
    const p = at.get(k.id)!;
    if (k.id.startsWith("lane:")) slots.set(k.id.slice(5), { x: origin.x + p.x, y: origin.y + p.y, w: LANE_W, h: k.h });
    else write(d, k, at, p, abs, slots, origin);
  }
  // Everything under a fold is hidden (and keeps its last place).
  if (n.meta.ost!.collapsed) for (const c of n.children) if (isOstCard(d.nodes[c])) hide(d, c);
}

function hide(d: Doc, id: string) {
  const n = d.nodes[id] as FrameNode;
  n.visible = false;
  for (const c of n.children) if (isOstCard(d.nodes[c])) hide(d, c);
}
