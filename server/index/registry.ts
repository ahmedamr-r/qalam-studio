import { models } from "../models/client";
import type { OrgStore } from "../org/store";
import { IndexUnavailable } from "./db";
import { OrgIndex } from "./indexer";

/**
 * One search index per open organization, opened with its store and closed with it. It catches
 * up with the folder in the background; searches made meanwhile answer from what's indexed.
 */

const g = globalThis as { __qalamIndexes?: WeakMap<OrgStore, OrgIndex | IndexUnavailable> };
const open = (g.__qalamIndexes ??= new WeakMap());

/** The organization's index (throws IndexUnavailable where SQLite has no full-text search). */
export function indexFor(store: OrgStore): OrgIndex {
  let ix = open.get(store);
  if (ix instanceof IndexUnavailable) throw ix;
  if (!ix || ix.closed) {
    try {
      ix = OrgIndex.open(store, process.env.QALAM_NO_MODELS ? null : models());
    } catch (e) {
      if (e instanceof IndexUnavailable) open.set(store, e);
      throw e;
    }
    open.set(store, ix);
    void ix.sync().catch(() => {});
  }
  return ix;
}
