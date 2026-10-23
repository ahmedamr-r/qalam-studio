import { openStores } from "@/ui/idb";
import type { SourceRecord } from "./sources";

/*
 * A Discovery board's own data, in its own IndexedDB database: its sources (the raw text quotes
 * are checked against) and, later, its weekly snapshots. It's separate from "qalam-projects" so
 * that database's version never changes: an upgrade there would wait on every open tab. Keys
 * start with the project's id ("<projectId>:<id>"), so a project's data goes with it.
 */

const open = openStores("qalam-discovery", 1, ["sources", "snapshots"]);
const sources = open("sources");
const snapshots = open("snapshots");

const prefix = (projectId: string) => `${projectId}:`;

export const sourcesDb = {
  list: (projectId: string) => sources.getPrefixed<SourceRecord>(prefix(projectId)),
  put: (s: SourceRecord) => sources.put(`${prefix(s.projectId)}${s.id}`, s),
  remove: (projectId: string, id: string) => sources.remove(`${prefix(projectId)}${id}`),
};

/** Everything a project kept here, gone (the project is being deleted). */
export async function clearDiscoveryData(projectId: string) {
  await Promise.all([sources.removePrefixed(prefix(projectId)), snapshots.removePrefixed(prefix(projectId))]);
}
