import { create } from "zustand";
import { callAI } from "@/ai/client";
import type { DraftAnswer } from "@/database/draft";
import type { MetricsEdit } from "@/database/edit";
import type { MetricUnit } from "@/database/types";
import type { Checked, DatabaseView, ReadResult } from "@/database/view";
import { orgJson, orgPath } from "./client";
import { onOrgChange } from "./live";

/*
 * The project's database in the window (server/database): what this computer reads, its layout,
 * Qalam AI's drafts waiting to be checked, and the team's numbers with where each stands here.
 * Loaded once a page wants it, then followed as it changes (another window, a hand edit of
 * hub/metrics.md). The connection string only ever goes to the core.
 */

export type { DatabaseView, Checked, ReadResult } from "@/database/view";

export type ConnectAnswer =
  | { state: "connected"; view: DatabaseView }
  /** Its user can change the database: nothing kept until they say to use it anyway. */
  | { state: "writes"; writes: string[]; writesCount: number; user: string; superuser: boolean; sql: string };

export interface DraftEditIn {
  name?: string;
  means?: string;
  sql?: string;
  unit?: MetricUnit;
  assumes?: string[];
}

interface DatabaseState {
  view: DatabaseView | null;
  loaded: boolean;
  error: string | null;
}

export const useDatabase = create<DatabaseState>(() => ({ view: null, loaded: false, error: null }));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
let following: (() => void) | null = null;

export async function loadDatabase(): Promise<void> {
  following ??= onOrgChange((c) => {
    if (c.kind === "metrics") void loadDatabase();
  });
  try {
    useDatabase.setState({ view: await databaseDb.view(), loaded: true, error: null });
  } catch (e) {
    useDatabase.setState({ loaded: true, error: message(e) });
  }
}

const take = (view: DatabaseView) => (useDatabase.setState({ view, error: null }), view);

const streamed = async <T>(path: string, body: unknown, onActivity?: (label: string) => void, signal?: AbortSignal) =>
  (await callAI<T>(await orgPath(path), body, undefined, signal, (e) => e.type === "activity" && onActivity?.(e.label))).data;

export const databaseDb = {
  view: () => orgJson<DatabaseView>("/database"),
  connect: async (b: { url: string; ca?: string; anyway?: boolean }) => {
    const r = await orgJson<ConnectAnswer>("/database", { method: "POST", json: b });
    if (r.state === "connected") take(r.view);
    return r;
  },
  forget: async () => take(await orgJson<DatabaseView>("/database", { method: "DELETE" })),
  /** The Supabase projects this computer's Supabase sign-in reaches. */
  supabaseProjects: async () => (await orgJson<{ projects: { ref: string; name: string; region?: string }[] }>("/database/supabase/projects")).projects,
  connectSupabase: async (ref: string, name?: string, anyway = false) => {
    const r = await orgJson<ConnectAnswer>("/database", { method: "POST", json: { supabase: ref, ...(name ? { name } : {}), anyway } });
    if (r.state === "connected") take(r.view);
    return r;
  },
  readLayout: async (onActivity?: (label: string) => void, signal?: AbortSignal) => take((await streamed<{ view: DatabaseView }>("/database/layout", {}, onActivity, signal)).view),
  draft: async (answers: DraftAnswer[], onActivity?: (label: string) => void, signal?: AbortSignal) => take(await streamed<DatabaseView>("/database/draft", { answers }, onActivity, signal)),
  use: async (id: string, edit?: DraftEditIn) => take(await orgJson<DatabaseView>(`/database/drafts/${encodeURIComponent(id)}`, { method: "PUT", json: { use: true, ...(edit ? { edit } : {}) } })),
  leave: async (id: string) => take(await orgJson<DatabaseView>(`/database/drafts/${encodeURIComponent(id)}`, { method: "PUT", json: { leave: true } })),
  check: (id: string) => orgJson<Checked>(`/database/metrics/${encodeURIComponent(id)}/check`, { method: "POST", json: {} }),
  approve: async (id: string, q: string, value: number | null) => take(await orgJson<DatabaseView>(`/database/metrics/${encodeURIComponent(id)}/approve`, { method: "POST", json: { q, value } })),
  read: async (ids: string[], fresh = false) => (await orgJson<{ read: Record<string, ReadResult> }>("/database/read", { method: "POST", json: { ids, fresh } })).read,
  edit: async (e: MetricsEdit) => take(await orgJson<DatabaseView>("/metrics", { method: "PUT", json: e })),
};

/** A reading as a value, or why there's none. */
export const readValue = (r: ReadResult | undefined): number | null | undefined => (r && "value" in r ? r.value : undefined);
