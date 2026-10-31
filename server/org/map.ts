import { boardCardsOf, type MapBoard } from "@/discovery/board-cards";
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
