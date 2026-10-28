import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, constants, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { qalamHome } from "../paths";
import { atomicWrite, readJson, stableStringify } from "./fsx";
import { OrgStore, type OrgEvent, type OrgInfo } from "./store";

/**
 * Where organizations live: one folder each under ~/Qalam (QALAM_HOME moves it, for tests), plus
 * any folder opened as one from elsewhere (a repository, a shared drive). ~/Qalam/.qalam.json
 * remembers those folders and the organization opened last. The first time Qalam runs there's none:
 * the welcome asks them to name it.
 */

export { qalamHome } from "../paths";

export const DEFAULT_ORG = "Personal";

export interface OrgListing {
  id: string;
  name: string;
  dir: string;
}

interface Registry {
  v: 1;
  /** The organization opened last: where a new window goes. */
  last?: string;
  /** Organizations kept outside ~/Qalam. */
  folders?: string[];
}

const registryFile = (home: string) => path.join(home, ".qalam.json");
const readRegistry = async (home: string): Promise<Registry> => (await readJson<Registry>(registryFile(home))) ?? { v: 1 };
const writeRegistry = (home: string, r: Registry) => atomicWrite(registryFile(home), stableStringify(r));

async function orgAt(dir: string): Promise<OrgListing | null> {
  const info = await readJson<OrgInfo>(path.join(dir, "org.json"));
  return info?.qalam === "org/1" && info.id ? { id: info.id, name: info.name, dir } : null;
}

export async function listOrgs(home = qalamHome()): Promise<OrgListing[]> {
  const dirs: string[] = [];
  try {
    for (const d of await readdir(home, { withFileTypes: true })) if (d.isDirectory() && !d.name.startsWith(".")) dirs.push(path.join(home, d.name));
  } catch {
    // no ~/Qalam yet
  }
  const reg = await readRegistry(home);
  for (const f of reg.folders ?? []) if (!dirs.includes(f)) dirs.push(f);
  const out: OrgListing[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    const org = await orgAt(dir);
    if (org && !seen.has(org.id)) {
      seen.add(org.id);
      out.push(org);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const newOrgId = () => randomBytes(6).toString("base64url");

/** A folder name from an organization's name: what a file system allows, kept readable (any script). */
function folderName(name: string): string {
  const n = name
    .normalize("NFC")
    .replace(/[/\\:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 60)
    .trim();
  return n || "Organization";
}

/** A new organization: a folder in ~/Qalam named after it. */
export async function createOrg(name: string, home = qalamHome()): Promise<OrgListing> {
  const base = folderName(name);
  let dir = path.join(home, base);
  for (let n = 2; await exists(dir); n++) dir = path.join(home, `${base} ${n}`);
  const store = await OrgStore.create(dir, { id: newOrgId(), name: name.trim().slice(0, 80) || base, createdAt: Date.now() });
  stores().set(store.info.id, Promise.resolve(opened(store)));
  return { id: store.info.id, name: store.info.name, dir };
}

/**
 * The organization a new window opens: the last one opened, else the first there is. With none
 * yet, null: the window welcomes them and they name their first (src/ui/welcome). `create` makes a
 * "Personal" instead, as Qalam did before it had a welcome.
 */
export async function currentOrg(home = qalamHome(), o: { create?: boolean } = {}): Promise<OrgListing | null> {
  const orgs = await listOrgs(home);
  const last = (await readRegistry(home)).last;
  const found = orgs.find((x) => x.id === last) ?? orgs[0];
  if (found || !o.create) return found ?? null;
  const made = await createOrg(DEFAULT_ORG, home);
  await rememberOrg(made.id, home);
  return made;
}

/** Remember the organization opened last. */
export async function rememberOrg(id: string, home = qalamHome()) {
  const reg = await readRegistry(home);
  if (reg.last === id) return;
  await writeRegistry(home, { ...reg, last: id });
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

/** Places that can't be an organization: the disk's root, your home itself, system folders. */
function refused(dir: string, home: string): string | null {
  const parts = dir.split(path.sep).filter(Boolean);
  if (parts.length < 2) return "Pick a folder inside your home or another drive, not the disk itself.";
  if (dir === homedir()) return "Pick a folder inside your home folder, not the home folder itself.";
  if (dir === home) return `That's where Qalam keeps organizations; pick a folder inside it, or another one.`;
  if (/^\/(System|usr|bin|sbin|etc|Library|Applications|dev|cores)(\/|$)/.test(dir)) return "That's a system folder.";
  return null;
}

/**
 * Use a folder as an organization: one that is already an organization is opened; any other
 * folder becomes one (named after the folder), its files left as they are. Remembered so it's
 * listed next time.
 */
export async function openFolder(raw: string, home = qalamHome()): Promise<OrgListing> {
  const dir = path.resolve(raw.replace(/^~(?=$|\/)/, homedir()));
  const why = refused(dir, home);
  if (why) throw new Error(why);
  const s = await stat(dir).catch(() => null);
  if (!s?.isDirectory()) throw new Error("That folder doesn't exist.");
  await access(dir, constants.W_OK).catch(() => {
    throw new Error("Qalam can't write in that folder.");
  });
  let org = await orgAt(dir);
  if (!org) {
    const store = await OrgStore.create(dir, { id: newOrgId(), name: path.basename(dir), createdAt: Date.now() });
    stores().set(store.info.id, Promise.resolve(opened(store)));
    org = { id: store.info.id, name: store.info.name, dir };
  }
  if (path.dirname(dir) !== home) {
    const reg = await readRegistry(home);
    if (!(reg.folders ?? []).includes(dir)) await writeRegistry(home, { ...reg, folders: [...(reg.folders ?? []), dir] });
  }
  return org;
}

/** Ask for a folder with the Mac's own picker (the dev server and the browser mode; the desktop app asks itself). */
export function chooseFolder(prompt: string): Promise<string | null | "unsupported"> {
  if (process.platform !== "darwin") return Promise.resolve("unsupported");
  return new Promise((resolve) => {
    execFile("osascript", ["-e", `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)})`], { timeout: 300_000 }, (err, out) => resolve(err ? null : out.trim().replace(/\/$/, "") || null));
  });
}

// One store per org for the life of the process. The dev server reloads this module when its code
// changes: the stores the old copy opened stop watching, and this copy opens its own.
const MODULE = Symbol("org-stores");
type Stores = { owner: symbol; map: Map<string, Promise<OrgStore>>; home: string };
const g = globalThis as { __qalamOrgStores?: Stores };

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

const openers = new Set<(store: OrgStore) => void>();

/** Run `fn` for each organization's store as it opens (and for those open already). */
export function onStoreOpen(fn: (store: OrgStore) => void) {
  openers.add(fn);
  for (const s of stores().values()) void s.then(fn, () => {});
}

/** A store is open and watched: tell whoever wants to know. */
function opened(store: OrgStore): OrgStore {
  store.watch();
  for (const fn of openers) fn(store);
  return store;
}

/** The store for an org id, opened (and watched) on first use. Null: no such org. */
export async function storeFor(id: string): Promise<OrgStore | null> {
  const map = stores();
  let s = map.get(id);
  if (!s) {
    // Kept before anything is awaited: a window's first requests arrive together, and each must
    // find this one, not open (and watch) its own copy of the organization.
    const opening = listOrgs().then(async (orgs) => {
      const org = orgs.find((o) => o.id === id);
      if (!org) throw new NoSuchOrg();
      return opened(await OrgStore.open(org.dir));
    });
    map.set(id, opening);
    opening.catch(() => map.delete(id));
    s = opening;
  }
  return s.catch((e) => {
    if (e instanceof NoSuchOrg) return null;
    throw e;
  });
}

class NoSuchOrg extends Error {}

/** Tell every open organization (its windows, its inbox) about a change that's this computer's, not one folder's. */
export async function announceAll(e: OrgEvent) {
  for (const s of await Promise.allSettled([...stores().values()])) if (s.status === "fulfilled") s.value.announce(e);
}

/** Open the organization opened last when Qalam starts, so its inbox is read from then on, before (or without) a window asking for it. */
export function openLastOrg(): Promise<OrgStore | null> {
  return currentOrg()
    .then((o) => (o ? storeFor(o.id) : null))
    .catch((e) => {
      console.warn(`[qalam] couldn't open the organization opened last: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
}
