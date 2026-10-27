import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { readJson } from "./fsx";
import { OrgStore, type OrgInfo } from "./store";

/**
 * Where organizations live: one folder each under ~/Qalam (QALAM_HOME moves it, for tests).
 * The first time Qalam runs it makes "Personal", so there's always somewhere to save.
 */

export const qalamHome = () => path.resolve(process.env.QALAM_HOME || path.join(homedir(), "Qalam"));

export const DEFAULT_ORG = "Personal";

export interface OrgListing {
  id: string;
  name: string;
  dir: string;
}

export async function listOrgs(home = qalamHome()): Promise<OrgListing[]> {
  let names: string[] = [];
  try {
    names = (await readdir(home, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name);
  } catch {
    return [];
  }
  const out: OrgListing[] = [];
  for (const name of names.sort()) {
    const info = await readJson<OrgInfo>(path.join(home, name, "org.json"));
    if (info?.qalam === "org/1" && info.id) out.push({ id: info.id, name: info.name, dir: path.join(home, name) });
  }
  return out;
}

const newOrgId = () => randomBytes(6).toString("base64url");

/** The org to open: the first there is, or a new "Personal" one. */
export async function defaultOrg(home = qalamHome()): Promise<OrgListing> {
  const orgs = await listOrgs(home);
  if (orgs[0]) return orgs[0];
  const dir = path.join(home, DEFAULT_ORG);
  const store = await OrgStore.create(dir, { id: newOrgId(), name: DEFAULT_ORG, createdAt: Date.now() });
  stores().set(store.info.id, Promise.resolve(store));
  store.watch();
  return { id: store.info.id, name: store.info.name, dir };
}

// One store per org for the life of the process. The dev server reloads this module when its code
// changes: the stores the old copy opened stop watching, and this copy opens its own.
const MODULE = Symbol("org-stores");
type Registry = { owner: symbol; map: Map<string, Promise<OrgStore>>; home: string };
const g = globalThis as { __qalamOrgStores?: Registry };

function stores(): Map<string, Promise<OrgStore>> {
  const home = qalamHome();
  const reg = g.__qalamOrgStores;
  if (reg && (reg.owner !== MODULE || reg.home !== home)) {
    for (const s of reg.map.values()) void s.then((x) => x.dispose()).catch(() => {});
    g.__qalamOrgStores = undefined;
  }
  g.__qalamOrgStores ??= { owner: MODULE, map: new Map(), home };
  return g.__qalamOrgStores.map;
}

/** The store for an org id, opened (and watched) on first use. Null: no such org. */
export async function storeFor(id: string): Promise<OrgStore | null> {
  const map = stores();
  let s = map.get(id);
  if (!s) {
    const org = (await listOrgs()).find((o) => o.id === id);
    if (!org) return null;
    s = OrgStore.open(org.dir).then((store) => {
      store.watch();
      return store;
    });
    map.set(id, s);
    s.catch(() => map.delete(id));
  }
  return s;
}
