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

/** The org this window opens (the server makes "Personal" the first time). */
export function currentOrg(): Promise<OrgRef> {
  org ??= fetch("/api/orgs")
    .then(async (r) => {
      if (!r.ok) throw new Error(`Qalam can't reach its files (${r.status})`);
      const j = (await r.json()) as { current: string; orgs: OrgRef[] };
      const o = j.orgs.find((x) => x.id === j.current);
      if (!o) throw new Error("No organization to open");
      return o;
    })
    .catch((e) => {
      org = null;
      throw e;
    });
  return org;
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
