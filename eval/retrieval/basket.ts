import { reconcile } from "@/goals/mirror";
import type { Project } from "@/projects/model";
import { AT, BOARDS, boardDoc, DECISIONS, PRODUCTS, SOURCES, sourceRecord } from "@/sample/basket";
import { OrgStore } from "../../server/org/store";

/** The retrieval eval's sample organization, written through the store like the app writes it. */

export { BOARDS, DECISIONS, PRODUCTS, quoteRef, SOURCES } from "@/sample/basket";

/** Write the sample organization into `dir` (made if it isn't there). */
export async function buildBasket(dir: string): Promise<OrgStore> {
  const store = await OrgStore.create(dir, { id: "basket-eval", name: "Basket", createdAt: AT });
  await store.putAbout({ audience: "Families and offices in Dubai and Abu Dhabi", goals: ["2M dirhams a month in orders by end of Q2"], context: "Basket is a grocery delivery company with a consumer app and a business service.", segments: [] });
  for (const p of PRODUCTS) await store.putProduct(p);
  for (const b of BOARDS) {
    const project: Project = { id: b.id, type: "discovery", name: b.name, createdAt: AT, updatedAt: AT, product: b.product };
    await store.putProject(project);
    await store.putDoc(b.id, boardDoc(b));
  }
  // The boards' outcome cards are their goals, linked as opening each board links them (src/goals/mirror.ts).
  for (const b of BOARDS) {
    const r = reconcile({ board: b.id, product: b.product, doc: boardDoc(b), goals: await store.getGoals(), synced: new Map(), now: AT });
    for (const [goal, card] of r.link) await store.patchGoal(goal, { on: { board: b.id, card } });
    for (const [goal, copy] of r.toGoal) await store.patchGoal(goal, { metric: copy.metric ?? null });
    for (const g of r.create) await store.createGoal({ id: g.id, title: g.title, parent: g.parent, product: g.product, ...(g.metric ? { metric: g.metric } : {}), status: g.status, ...(g.on ? { on: g.on } : {}) });
  }
  for (const s of SOURCES) await store.putSource({ ...sourceRecord(s), boards: [s.product === "business" ? "pantry" : "reorders"] });
  await store.appendDecisions(DECISIONS);
  return store;
}
