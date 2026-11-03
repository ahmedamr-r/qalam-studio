import { reconcile } from "@/goals/mirror";
import type { Project } from "@/projects/model";
import { AT, boardDoc, BOARDS, DECISIONS, SOURCES, sourceRecord } from "@/sample/basket";
import { SAMPLE_ABOUT, SAMPLE_BEARINGS, SAMPLE_GOALS, SAMPLE_NAME, samplePages, sampleBrief } from "@/sample/project";
import { createOrg, listOrgs, storeFor, type OrgListing } from "./home";
import type { OrgStore } from "./store";

/**
 * "Try it with a sample": a project anyone can open with nothing set up. Written through the store
 * as the app writes it, no model called, so it needs no engine. There's one per computer: opened
 * again it's as they left it, and they're free to change or delete it. One product, however many
 * Basket has elsewhere (the eval's): someone new sees one project.
 */

async function writeSample(store: OrgStore): Promise<void> {
  await store.putAbout(SAMPLE_ABOUT);
  for (const g of SAMPLE_GOALS) await store.createGoal({ id: g.id, title: g.title, parent: g.parent, metric: g.metric, cites: g.cites, by: "person", ...(g.north ? { north: true } : {}) });
  const north = SAMPLE_GOALS.find((g) => g.north)!.id;
  for (const b of BOARDS) {
    const project: Project = { id: b.id, type: "discovery", name: b.name, createdAt: AT, updatedAt: AT };
    await store.putProject(project);
    const doc = boardDoc(b);
    await store.putDoc(b.id, doc);
    // The boards' outcome cards are their goals, linked as opening each board links them (src/goals/mirror.ts), all feeding the North Star.
    const r = reconcile({ board: b.id, product: null, doc, goals: await store.getGoals(), synced: new Map(), now: AT });
    for (const g of r.create) await store.createGoal({ id: g.id, title: g.title, parent: north, ...(g.metric ? { metric: g.metric } : {}), status: g.status, ...(g.on ? { on: g.on } : {}) });
  }
  // Everything here is on the pages already, so nothing offers to file it again.
  for (const s of SOURCES) {
    const { product: _product, ...record } = sourceRecord(s);
    await store.putSource({ ...record, boards: [record.projectId], filed: record.quotes.map((q) => q.id) });
  }
  await store.appendDecisions(DECISIONS.map(({ product: _product, ...d }) => d));
  for (const t of samplePages()) await store.putTopic(t);
  await store.addBearings(SAMPLE_BEARINGS);
  const brief = sampleBrief();
  await store.putBrief(brief.meta, brief.body);
  await store.finishFirstRun();
  // Only now is it the sample: one cut short by a crash isn't opened as if it were whole.
  await store.markSample();
}

/** The sample project, made the first time it's asked for. */
export async function openSample(): Promise<OrgListing> {
  const there = (await listOrgs()).find((o) => o.sample);
  if (there) return there;
  const made = await createOrg(SAMPLE_NAME, undefined, "solo");
  const store = await storeFor(made.id);
  if (!store) throw new Error("The sample couldn't be made here.");
  await writeSample(store);
  return { ...made, sample: true };
}
