import { orgFetch, orgJson } from "@/org/client";
import type { SourceRecord } from "./sources";

/*
 * Sources belong to the organization (its sources/ folder: each one's text as Markdown, quotes
 * are checked against it, with its quotes and needs beside it; server/org/codecs.ts). A board
 * uses some of them; deleting a board leaves them in the organization.
 */

export const sourcesDb = {
  list: (projectId: string) => orgJson<SourceRecord[]>(`/sources?board=${encodeURIComponent(projectId)}`),
  put: async (s: SourceRecord) => {
    await orgFetch(`/sources/${s.id}`, { method: "PUT", json: s });
  },
  /** Put a source on a board, or take it off (it stays in the organization). */
  link: async (id: string, board: string, on: boolean) => {
    await orgFetch(`/sources/${id}/boards`, { method: "POST", json: { board, on } });
  },
  /** Every source in the organization. */
  all: () => orgJson<SourceRecord[]>("/sources"),
  /** One of the organization's sources, on this board or not. */
  get: (id: string) => orgJson<SourceRecord>(`/sources/${encodeURIComponent(id)}`),
  /** Delete a source from the organization: every board loses it. */
  remove: async (id: string) => {
    await orgFetch(`/sources/${id}`, { method: "DELETE" });
  },
};
