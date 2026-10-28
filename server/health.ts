import { DatabaseSync } from "node:sqlite";
import { diagnose, type HealthRow } from "@/health/doctor";
import { engineView, liveTest } from "./engine";
import { inboxStatus } from "./inbox";
import { models } from "./models/client";
import { storeFor } from "./org/home";

/*
 * This Mac, checked (src/health/doctor.ts): the engine, search, the meaning model and the
 * organization's inbox. Asked by Connections and the sidebar's dot; costs no model call.
 */

let fts: boolean | null = null;
/** This Node's SQLite has full-text search (Node 24, the desktop app's): the index can run. */
export function searchWorks(): boolean {
  if (fts !== null) return fts;
  try {
    new DatabaseSync(":memory:").exec("create virtual table t using fts5(x)");
    fts = true;
  } catch {
    fts = false;
  }
  return fts;
}

export async function healthNow(org?: string | null): Promise<HealthRow[]> {
  const view = await engineView();
  const store = org ? await storeFor(org).catch(() => null) : null;
  const m = models().state();
  return diagnose({
    engine: { kind: view.kind, ready: view.ready, word: view.word, ...(view.detail ? { detail: view.detail } : {}) },
    search: { ok: searchWorks(), node: process.versions.node },
    models: { status: m.status, ...(m.error ? { error: m.error } : {}), ...(m.download ? { download: { done: m.download.done, total: m.download.total } } : {}) },
    inbox: store ? await inboxStatus(store) : null,
  });
}

/** Run a row's fix that the core can run itself. */
export async function fixHealth(id: string) {
  if (id === "models.retry") models().retry();
  else if (id === "engine.test") await liveTest();
}
