/**
 * The organization this window works in, and requests for its files (server/org/routes.ts).
 * Every write names this window (`x-qalam-tab`), so the change isn't announced back to it.
 */

export interface OrgRef {
  id: string;
  name: string;
  /** The folder on this computer. */
  dir: string;
}

/** This window, for the org's change announcements. */
export const TAB = Math.random().toString(36).slice(2, 10);

let org: Promise<OrgRef> | null = null;
let chosen: string | null = null;

/** The organization in the address isn't on this computer. */
export class OrgMissing extends Error {
  constructor(readonly id: string) {
    super("This organization isn't on this computer");
  }
}

/** There's no organization on this computer yet: the first run (the window welcomes them). */
export class NoOrgYet extends Error {
  constructor() {
    super("There's no organization on this computer yet");
  }
}

/** The core didn't answer (`status`: 503 while it starts, 502 if it stopped). */
export class CantReachFiles extends Error {
  constructor(readonly status: number) {
    super(`Qalam can't reach its files (${status})`);
  }
}

/** Work in this organization (from the address); null: the one opened last. */
export function chooseOrg(id: string | null) {
  if (chosen === id && org) return;
  chosen = id;
  org = null;
}

/** The org this window works in: the one in its address, or the one opened last (none the first time: NoOrgYet). */
export function currentOrg(): Promise<OrgRef> {
  org ??= fetch("/api/orgs")
    .then(async (r) => {
      if (!r.ok) throw new CantReachFiles(r.status);
      const j = (await r.json()) as { current: string | null; orgs: OrgRef[] };
      const want = chosen ?? j.current;
      if (!want) throw new NoOrgYet();
      const o = j.orgs.find((x) => x.id === want);
      if (!o) throw new OrgMissing(want);
      return o;
    })
    .catch((e) => {
      org = null;
      throw e;
    });
  return org;
}

/** Every organization on this computer, and the one a new window opens. */
export async function listOrgs(): Promise<{ current: string | null; orgs: OrgRef[] }> {
  const r = await fetch("/api/orgs");
  if (!r.ok) throw new CantReachFiles(r.status);
  return r.json();
}

/** Where a new window goes next time. */
export const rememberOrg = (id: string) =>
  fetch("/api/orgs/last", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }).then(
    () => {},
    () => {},
  );

async function orgsRequest(path: string, body: unknown): Promise<Response> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new OrgRequestError(r.status, ((await r.json().catch(() => ({}))) as { message?: string }).message ?? r.statusText);
  return r;
}

/** A new organization: a folder in ~/Qalam. */
export const createOrg = async (name: string): Promise<OrgRef> => (await orgsRequest("/api/orgs", { name })).json();

/** The desktop app's bridge (electron/preload.cjs): the system's own folder picker. */
const desktop = () => (globalThis as { qalamDesktop?: { chooseFolder(title: string): Promise<string | null> } }).qalamDesktop;

/**
 * Open a folder as an organization. The desktop app asks with its own picker; in a browser the
 * Qalam server asks with the Mac's. Null: nothing picked. `path` skips the picker.
 */
export async function openOrgFolder(path?: string): Promise<OrgRef | null> {
  let dir = path;
  if (!dir && desktop()) {
    dir = (await desktop()!.chooseFolder("Choose a folder for the organization")) ?? undefined;
    if (!dir) return null;
  }
  const j = (await (await orgsRequest("/api/orgs/open", dir ? { path: dir } : {})).json()) as OrgRef & { cancelled?: boolean };
  return j.cancelled ? null : j;
}

/** Rename the organization this window works in. */
export async function renameOrg(name: string): Promise<OrgRef> {
  const r = await fetch(await orgPath("/info"), { method: "PATCH", headers: { "content-type": "application/json", "x-qalam-tab": TAB }, body: JSON.stringify({ name }) });
  if (!r.ok) throw new OrgRequestError(r.status, ((await r.json().catch(() => ({}))) as { message?: string }).message ?? r.statusText);
  const next = (await r.json()) as OrgRef;
  org = Promise.resolve(next);
  return next;
}

/** The organization changed elsewhere (renamed in another window or in its org.json): read it again. */
export function forgetOrg() {
  org = null;
}

/** The org's address for a path, e.g. "/projects/<id>". */
export const orgPath = async (path: string) => `/api/org/${(await currentOrg()).id}${path}`;

/** The document changed since it was loaded here: `current` is what's there now. */
export class ConflictError extends Error {
  constructor(
    readonly version: string,
    readonly current: unknown,
  ) {
    super("Changed in another window or on disk since it opened here");
  }
}

export class OrgRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const versionOf = (res: Response) => res.headers.get("etag")?.replace(/"/g, "") ?? null;

/** A request to the org, failing on errors (409: ConflictError). */
export async function orgFetch(path: string, init: RequestInit & { json?: unknown; ifMatch?: string | null } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-qalam-tab", TAB);
  if (init.ifMatch) headers.set("if-match", `"${init.ifMatch}"`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(await orgPath(path), { ...init, headers, body });
  if (res.status === 409) {
    const j = (await res.json().catch(() => ({}))) as { version?: string; current?: unknown };
    throw new ConflictError(j.version ?? "", j.current);
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { message?: string };
    throw new OrgRequestError(res.status, j.message ?? res.statusText);
  }
  return res;
}

export async function orgJson<T>(path: string, init: Parameters<typeof orgFetch>[1] = {}): Promise<T> {
  return (await orgFetch(path, init)).json() as Promise<T>;
}

/** GET with its version (null: not found). */
export async function orgGet<T>(path: string): Promise<{ value: T; version: string | null } | null> {
  try {
    const res = await orgFetch(path);
    return { value: (await res.json()) as T, version: versionOf(res) };
  } catch (e) {
    if (e instanceof OrgRequestError && e.status === 404) return null;
    throw e;
  }
}

/** A write that returns the new version. */
export async function orgWrite(path: string, init: Parameters<typeof orgFetch>[1]): Promise<string | null> {
  return versionOf(await orgFetch(path, init));
}
