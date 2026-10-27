import { orgFetch, orgJson } from "@/org/client";
import type { Positions } from "./layout";
import type { View } from "./lod";
import type { DecisionTrace } from "./types";

/*
 * The Knowledge hub's own data, in the organization's folder: decision traces with the project's
 * chats (AI working memory, kept out of Git), and where the graph's nodes sit (this computer only).
 * Deleting a project deletes both there.
 */

export interface SavedLayout {
  /** Layout version: positions from another node size are laid out again. */
  v?: number;
  positions: Positions;
  view: View | null;
}

export const tracesDb = {
  list: (projectId: string) => orgJson<DecisionTrace[]>(`/traces/${projectId}`),
  put: async (t: DecisionTrace) => {
    await orgFetch(`/traces/${t.projectId}/${t.id}`, { method: "PUT", json: t });
  },
  remove: async (projectId: string, id: string) => {
    await orgFetch(`/traces/${projectId}/${id}`, { method: "DELETE" });
  },
};

export const layoutDb = {
  get: async (projectId: string) => (await orgJson<SavedLayout | null>(`/layout/${projectId}`)) ?? undefined,
  put: async (projectId: string, l: SavedLayout) => {
    await orgFetch(`/layout/${projectId}`, { method: "PUT", json: l });
  },
};
