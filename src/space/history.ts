import type { Doc } from "@/doc/schema";
import { isOstCard } from "@/doc/board";
import { isProblemPage, type SpaceDoc } from "./compose";
import { sameCard } from "./split";

/*
 * What came in from elsewhere put into the canvas's steps back (pure), so undo keeps working: a
 * card's new words when the cards are the same ones, and goals that came in with no board yet (a
 * goal accepted under another) put where they hang now. Anything else that came or went would be
 * undone by a step back, so those steps go (./session.ts).
 */

const cardIds = (d: Doc) => Object.keys(d.nodes).filter((id) => isOstCard(d.nodes[id]) && !isProblemPage(id));

/** Whether two canvases hold the same cards in the same places (problems' pages aside: they're never saved). */
export function sameCards(a: Doc, b: Doc): boolean {
  const ids = cardIds(b);
  if (ids.length !== cardIds(a).length) return false;
  const kids = (d: Doc, id: string) => d.nodes[id].children.filter((c) => !isProblemPage(c)).join();
  return ids.every((id) => !!a.nodes[id] && a.nodes[id].parentId === b.nodes[id].parentId && kids(a, id) === kids(b, id));
}

/**
 * The goal cards that came in with no board yet (accepted under a goal elsewhere), when they're all
 * that changed in the tree: everything else hangs where it did (null otherwise). Parents first.
 */
export function addedGoals(a: Doc, b: Doc, s: Pick<SpaceDoc, "virtual" | "things">): string[] | null {
  const fresh = cardIds(b).filter((id) => !a.nodes[id]);
  if (!fresh.length || fresh.some((id) => !s.virtual.has(id) || s.things.get(id)?.type !== "goal")) return null;
  const was = cardIds(a);
  if (was.some((id) => !b.nodes[id])) return null;
  const kids = (d: Doc, id: string) => d.nodes[id].children.filter((c) => !isProblemPage(c) && !fresh.includes(c)).join();
  if (!was.every((id) => a.nodes[id].parentId === b.nodes[id].parentId && kids(a, id) === kids(b, id))) return null;
  const depth = (id: string) => {
    let n = 0;
    for (let p = b.nodes[id].parentId; p; p = b.nodes[p]?.parentId ?? null) n++;
    return n;
  };
  return fresh.sort((x, y) => depth(x) - depth(y));
}

/** A step back with the goals that came in put where they hang now (the canvas lays it out again when it comes back). */
export function withGoals(d: Doc, now: Doc, ids: string[], was?: Doc): Doc {
  const nodes = { ...d.nodes };
  for (const id of ids) {
    const n = now.nodes[id];
    const parent = n?.parentId;
    if (!parent || !nodes[parent] || nodes[id]) continue;
    nodes[id] = { ...n, children: n.children.filter((c) => !!nodes[c]) } as Doc["nodes"][string];
    // After the sibling it follows now, among the step's own children.
    const order = now.nodes[parent].children;
    const kids = [...nodes[parent].children];
    let at = 0;
    for (let j = order.indexOf(id) - 1; j >= 0; j--) {
      const k = kids.indexOf(order[j]);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    kids.splice(at, 0, id);
    nodes[parent] = { ...nodes[parent], children: kids } as Doc["nodes"][string];
  }
  return withContent({ ...d, nodes }, now, was);
}

/**
 * A step back with the content that came from elsewhere: each card as it is now, where it changed
 * since the canvas was last saved or composed (`was`). A card that didn't change elsewhere keeps the
 * step's own words, so an edit made here still undoes.
 */
export function withContent(d: Doc, now: Doc, was?: Doc): Doc {
  let nodes: Doc["nodes"] | null = null;
  for (const [id, n] of Object.entries(d.nodes)) {
    const m = now.nodes[id];
    if (!isOstCard(n) || !isOstCard(m) || sameCard(n.meta.ost, m.meta.ost)) continue;
    const before = was?.nodes[id];
    if (isOstCard(before) && sameCard(before.meta.ost, m.meta.ost)) continue;
    nodes ??= { ...d.nodes };
    nodes[id] = { ...n, name: m.name, meta: { ...n.meta, ost: m.meta.ost } };
  }
  return nodes ? { ...d, nodes } : d;
}
