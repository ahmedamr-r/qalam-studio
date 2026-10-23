import { openStores } from "@/ui/idb";
import type { Positions } from "./layout";
import type { View } from "./lod";
import type { DecisionTrace } from "./types";

/*
 * The Knowledge hub's own data, in its own IndexedDB database: decision traces and where the
 * graph's nodes sit. Separate from "qalam-projects" so that database's version never changes (an
 * upgrade there would wait on every open tab). Keys start with the project's id.
 */

const open = openStores("qalam-knowledge", 1, ["traces", "layout"]);
const traces = open("traces");
const layout = open("layout");

const prefix = (projectId: string) => `${projectId}:`;

export interface SavedLayout {
  /** Layout version: positions from another node size are laid out again. */
  v?: number;
  positions: Positions;
  view: View | null;
}

export const tracesDb = {
  list: (projectId: string) => traces.getPrefixed<DecisionTrace>(prefix(projectId)),
  put: (t: DecisionTrace) => traces.put(`${prefix(t.projectId)}${t.id}`, t),
  remove: (projectId: string, id: string) => traces.remove(`${prefix(projectId)}${id}`),
};

export const layoutDb = {
  get: (projectId: string) => layout.get<SavedLayout>(projectId),
  put: (projectId: string, l: SavedLayout) => layout.put(projectId, l),
};

/** Everything a project kept here, gone (the project is being deleted). */
export async function clearKnowledgeData(projectId: string) {
  await Promise.all([traces.removePrefixed(prefix(projectId)), layout.remove(projectId)]);
}
