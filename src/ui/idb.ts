/**
 * A small IndexedDB wrapper: one database, its object stores (keys given on put), and promise
 * requests. Chats, assets, projects and Discovery sources each keep their own database through it.
 */

export interface IdbStore {
  get<T>(key: string): Promise<T | undefined>;
  getAll<T>(): Promise<T[]>;
  /** Every value whose key starts with `prefix` (keys like "<projectId>:<id>"). */
  getPrefixed<T>(prefix: string): Promise<T[]>;
  put(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  /** Remove every value whose key starts with `prefix`. */
  removePrefixed(prefix: string): Promise<void>;
}

/** Keys from `prefix` up to the last string that starts with it. */
const prefixRange = (prefix: string) => IDBKeyRange.bound(prefix, `${prefix}￿`);

/** Stores of one database, opened on first use. Missing stores are created on upgrade. */
export function openStores(name: string, version: number, stores: readonly string[]): (store: string) => IdbStore {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = () =>
    (dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = () => {
        for (const s of stores) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));

  return (store) => {
    const run = <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> =>
      db().then(
        (d) =>
          new Promise<T>((resolve, reject) => {
            const req = fn(d.transaction(store, mode).objectStore(store));
            req.onsuccess = () => resolve(req.result as T);
            req.onerror = () => reject(req.error);
          }),
      );
    return {
      get: <T>(key: string) => run<T | undefined>("readonly", (s) => s.get(key)),
      getAll: <T>() => run<T[]>("readonly", (s) => s.getAll()),
      getPrefixed: <T>(prefix: string) => run<T[]>("readonly", (s) => s.getAll(prefixRange(prefix))),
      put: (key, value) => run<unknown>("readwrite", (s) => s.put(value, key)).then(() => undefined),
      remove: (key) => run<unknown>("readwrite", (s) => s.delete(key)).then(() => undefined),
      removePrefixed: (prefix) => run<unknown>("readwrite", (s) => s.delete(prefixRange(prefix))).then(() => undefined),
    };
  };
}
