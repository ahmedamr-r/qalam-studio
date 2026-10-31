import { produce } from "immer";
import type { Doc, FrameNode } from "@/doc/schema";
import { emptyDoc } from "@/doc/schema";
import { isOstCard } from "@/doc/board";
import { addCardIn } from "@/discovery/ops";
import type { OstCard } from "@/discovery/types";
import { isNewBoard } from "./assign";

/*
 * What a change on the space's canvas writes to each board (pure). The canvas is compared with
 * itself as it was last saved (`base`), never with the boards, so opening it writes nothing and a
 * card's place on the canvas (worked out, never kept) is never a change. Each board is written
 * from its own document as stored, changing only the cards that changed: their words and fields,
 * and where they hang when that changed. What the canvas doesn't show (another product's tree,
 * stickies, the board's notes) stays as it is. A goal's card stays where it hangs on its board:
 * the goals' tree is goals.md's. Cards with no board yet start one (`create`).
 */

export interface SplitInput {
  /** The canvas as last saved or composed. */
  base: Doc;
  /** The canvas now. */
  now: Doc;
  /** Each card's board on `base`, and now (./assign.ts). */
  before: ReadonlyMap<string, string>;
  after: ReadonlyMap<string, string>;
  /** Each board's document as last loaded or saved. */
  stored: ReadonlyMap<string, Doc>;
  /** Goals' cards: where they hang on their board is never changed from here. */
  anchors: ReadonlySet<string>;
  /** Goals with no board yet: their card goes on the board started under them. */
  virtual: ReadonlySet<string>;
}

export interface NewBoard {
  /** `new:<id>`: the card it starts from (a top card, or a goal's card). */
  key: string;
  doc: Doc;
  /** The goal it works on, when it started under a goal with no board. */
  goal: string | null;
}

export interface Split {
  /** Boards whose document changed: the whole new document. */
  writes: Map<string, Doc>;
  create: NewBoard[];
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, y]) => y !== undefined).sort(([a], [b]) => a.localeCompare(b))) : x));

export const sameCard = (a: OstCard | undefined, b: OstCard | undefined) => a === b || (!!a && !!b && stable(a) === stable(b));

/** Every card, each after the card above it. */
function inOrder(doc: Doc): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    if (!isOstCard(doc.nodes[id])) return;
    out.push(id);
    doc.nodes[id].children.forEach(walk);
  };
  doc.roots.forEach(walk);
  return out;
}

/** Where a card hangs on the canvas: the card above it and its place among that card's cards. */
function placeOf(doc: Doc, id: string): string {
  const p = doc.nodes[id].parentId;
  const list = (p ? doc.nodes[p].children : doc.roots).filter((c) => isOstCard(doc.nodes[c]));
  return `${p ?? ""}#${list.indexOf(id)}`;
}

const ostOf = (doc: Doc, id: string) => (isOstCard(doc.nodes[id]) ? doc.nodes[id].meta.ost : undefined);

export function splitSpace(i: SplitInput): Split {
  const real = (id: string) => !i.virtual.has(id) && i.after.has(id);
  // The boards something changed on.
  const dirty = new Set<string>();
  const order = inOrder(i.now);
  for (const id of order) {
    const b = i.after.get(id);
    if (!b) continue;
    if (i.virtual.has(id)) continue;
    const was = i.before.get(id);
    if (!i.base.nodes[id] || was !== b) {
      dirty.add(b);
      if (was) dirty.add(was);
    } else if (!sameCard(ostOf(i.base, id), ostOf(i.now, id)) || placeOf(i.base, id) !== placeOf(i.now, id)) dirty.add(b);
  }
  for (const id of inOrder(i.base)) {
    const was = i.before.get(id);
    if (was && !isOstCard(i.now.nodes[id])) dirty.add(was);
  }

  const writes = new Map<string, Doc>();
  for (const b of dirty) {
    if (isNewBoard(b)) continue;
    const stored = i.stored.get(b);
    if (!stored) continue;
    const next = produce(stored, (d) => patchBoard(d, b, i, order));
    if (next !== stored) writes.set(b, next);
  }

  // Boards to start: each with a card of its own (a goal's card alone starts nothing).
  const create: NewBoard[] = [];
  for (const key of dirty) {
    if (!isNewBoard(key)) continue;
    const ids = order.filter((id) => i.after.get(id) === key);
    if (!ids.some(real)) continue;
    const doc = emptyDoc();
    for (const id of ids) {
      const p = i.now.nodes[id].parentId;
      addCardIn(doc, freshNode(i.now.nodes[id] as FrameNode), p && i.after.get(p) === key ? p : null);
    }
    const anchor = key.slice(4);
    create.push({ key, doc, goal: i.virtual.has(anchor) ? anchor : null });
  }
  return { writes, create };
}

function freshNode(n: FrameNode): FrameNode {
  return { ...n, children: [], parentId: null, visible: true, meta: { ...n.meta, ost: structuredClone(n.meta.ost) } };
}

const listIn = (d: Doc, parent: string | null) => (parent ? (d.nodes[parent] as FrameNode).children : d.roots);

function detach(d: Doc, id: string) {
  const p = d.nodes[id].parentId;
  const list = p && d.nodes[p] ? listIn(d, p) : d.roots;
  const at = list.indexOf(id);
  if (at >= 0) list.splice(at, 1);
}

/** One board's document, with what changed on the canvas for its cards. */
function patchBoard(d: Doc, board: string, i: SplitInput, order: string[]) {
  // Cards that left it (deleted, or moved to another board): what hung under them and stays here moves up to their place.
  for (const id of inOrder(i.base)) {
    if (i.before.get(id) !== board || !d.nodes[id]) continue;
    if (isOstCard(i.now.nodes[id]) && i.after.get(id) === board) continue;
    const n = d.nodes[id];
    const parent = n.parentId && d.nodes[n.parentId] ? n.parentId : null;
    const list = listIn(d, parent);
    const at = list.indexOf(id);
    const keep = n.children.filter((c) => isOstCard(d.nodes[c]));
    for (const c of keep) d.nodes[c].parentId = parent;
    list.splice(at >= 0 ? at : list.length, at >= 0 ? 1 : 0, ...keep);
    const drop = (x: string) => {
      const m = d.nodes[x];
      if (!m) return;
      for (const c of m.children) if (!keep.includes(c)) drop(c);
      delete d.nodes[x];
    };
    drop(id);
  }

  // Cards on it now, each after the card above it: new ones put in, changed ones written, moved ones hung again.
  for (const id of order) {
    if (i.after.get(id) !== board) continue;
    const now = i.now.nodes[id] as FrameNode;
    const here = !!d.nodes[id];
    const was = i.before.get(id) === board && isOstCard(i.base.nodes[id]);
    if (!here) d.nodes[id] = freshNode(now);
    const n = d.nodes[id] as FrameNode;
    if (!here || !was || !sameCard(ostOf(i.base, id), now.meta.ost)) {
      n.meta = { ...n.meta, ost: structuredClone(now.meta.ost) };
      n.name = now.meta.ost!.title;
    }
    const moved = !here || !was || placeOf(i.base, id) !== placeOf(i.now, id);
    if (moved && (!here || !i.anchors.has(id))) hang(d, id, board, i);
  }
}

/** Put a card under the card above it on the canvas when that's on this board (else at the top), beside the same neighbours. */
function hang(d: Doc, id: string, board: string, i: SplitInput) {
  const above = i.now.nodes[id].parentId;
  const parent = above && i.after.get(above) === board && d.nodes[above] ? above : null;
  detach(d, id);
  const list = listIn(d, parent);
  const sibs = above ? i.now.nodes[above].children : i.now.roots;
  const me = sibs.indexOf(id);
  let at = list.length;
  const next = sibs.slice(me + 1).find((s) => list.includes(s));
  if (next) at = list.indexOf(next);
  else {
    const prev = sibs.slice(0, me).reverse().find((s) => list.includes(s));
    if (prev) at = list.indexOf(prev) + 1;
  }
  list.splice(at, 0, id);
  d.nodes[id].parentId = parent;
}
