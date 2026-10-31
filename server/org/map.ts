import { boardCardsOf, type MapBoard } from "@/discovery/board-cards";
import type { Doc } from "@/doc/schema";
import { boardsInSpace } from "@/space/members";
import type { OrgStore } from "./store";

/**
 * Every board's cards, for the space's map (src/goals/map.ts): read from each board's file, as the
 * notices are, so the home needn't open every board's document.
 */
export async function boardCards(store: OrgStore): Promise<MapBoard[]> {
  const out: MapBoard[] = [];
  for (const p of store.listProjects()) {
    if (p.type !== "discovery") continue;
    const doc = (await store.getDoc(p.id).catch(() => null))?.doc ?? null;
    out.push({ id: p.id, name: p.name, product: p.product ?? null, cards: doc ? boardCardsOf(doc) : [] });
  }
  return out;
}

export interface SpaceBoardAt {
  id: string;
  name: string;
  product: string | null;
  /** The document's version, which a save names (src/space). */
  version: string;
  doc: Doc | null;
}

/** The boards a space's canvas holds, each with its whole document (src/space/members.ts). */
export async function spaceBoards(store: OrgStore, space: string | null): Promise<SpaceBoardAt[]> {
  const projects = store.listProjects();
  const ids = boardsInSpace(projects, (await store.getGoals()).goals, space);
  const out: SpaceBoardAt[] = [];
  for (const id of ids) {
    const p = projects.find((x) => x.id === id)!;
    const d = await store.getDoc(id).catch(() => null);
    if (d) out.push({ id, name: p.name, product: p.product ?? null, version: d.version, doc: d.doc });
  }
  return out;
}
