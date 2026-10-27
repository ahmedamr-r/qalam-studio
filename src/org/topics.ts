import type { Applied, Filing, Topic, TopicInfo } from "@/hub/topics";
import { orgFetch, orgGet, orgJson, orgWrite } from "./client";

/**
 * The organization's topic pages (hub/topics/*.md, server/org/store.ts): listed, read with what
 * their lines cite and the cards they show up on, saved as people change them, and filed into by
 * Qalam AI (src/org/filing.ts). This window's own writes are announced here; other windows' and
 * the folder's come through src/org/live.ts.
 */

/** A piece a line cites, as the index has it. */
export interface CitedPiece {
  ref: string;
  type: string;
  sub: string | null;
  text: string;
  line: string;
  title: string | null;
  product: string | null;
  board: string | null;
  card: string | null;
  source: string | null;
  speaker: string | null;
  stage: string | null;
  at: number;
}

/** A card on a board that rests on (or is spoken against by) the page's pieces. */
export interface ShowsUpOn {
  ref: string;
  board: string;
  boardName: string | null;
  card: string;
  title: string;
  kind: string;
  stage: string | null;
  shared: number;
}

export interface TopicView {
  topic: TopicInfo;
  cited: Record<string, CitedPiece>;
  /** The sources of quotes it cites, with the boards that use them. */
  sources: Record<string, { title: string; boards: string[] }>;
  shows: ShowsUpOn[];
}

export interface Filed {
  created: string[];
  counts: Applied["counts"];
  pages: Pick<Topic, "id" | "title" | "kind">[];
}

const listeners = new Set<() => void>();

/** Hear about this window's own changes to the pages (the server announces only other windows'). */
export function onTopicsWritten(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const written = () => listeners.forEach((fn) => fn());

export const topicsDb = {
  list: () => orgJson<TopicInfo[]>("/topics"),
  get: async (id: string) => (await orgGet<TopicView>(`/topics/${encodeURIComponent(id)}`))?.value ?? null,
  /** Save a page as people changed it; conflicts when it changed since `version`. Returns the new version. */
  put: async (t: Topic, version: string | null) => {
    const v = await orgWrite(`/topics/${encodeURIComponent(t.id)}`, { method: "PUT", json: t, ifMatch: version });
    written();
    return v;
  },
  remove: async (id: string) => {
    await orgFetch(`/topics/${encodeURIComponent(id)}`, { method: "DELETE" });
    written();
  },
  /** What Qalam AI filed, as code kept it, and the quotes the pages have now seen (by source). */
  file: async (filing: Filing, from: string, filed: Record<string, string[]>) => {
    const r = await orgJson<Filed>("/topics/file", { method: "POST", json: { filing, from, filed } });
    written();
    return r;
  },
};
