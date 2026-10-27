import { orgFetch, orgJson } from "@/org/client";
import type { SourceRecord } from "./sources";

/*
 * A Discovery board's sources live in the organization's folder: each one's text as Markdown
 * (quotes are checked against it) with its quotes and needs beside it (server/org/codecs.ts).
 * Deleting a board deletes its own sources there too.
 */

export const sourcesDb = {
  list: (projectId: string) => orgJson<SourceRecord[]>(`/sources?board=${encodeURIComponent(projectId)}`),
  put: async (s: SourceRecord) => {
    await orgFetch(`/sources/${s.id}`, { method: "PUT", json: s });
  },
  remove: async (_projectId: string, id: string) => {
    await orgFetch(`/sources/${id}`, { method: "DELETE" });
  },
};
