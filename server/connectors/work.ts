import path from "node:path";
import { githubStatus, linearState, workKey, type WorkStatus } from "@/connectors/work";
import type { OstWork } from "@/discovery/types";
import { atomicWrite, locked, readJson } from "../org/fsx";
import type { OrgStore } from "../org/store";
import { secrets } from "../secrets";

/*
 * Where the work linked to solutions stands, asked of the tools that hold it: Linear (with the
 * personal API key Qalam keeps in the Keychain) and GitHub (public repositories need none). The
 * answers are kept per computer in the organization's .qalam/local/work.json, for the cards, the
 * card panel and the checks, and asked again when they're ten minutes old. Jira and Figma links
 * have no status yet: they show as links.
 */

const FRESH_MS = 10 * 60_000;
const file = (store: OrgStore) => path.join(store.dir, ".qalam", "local", "work.json");

export async function workCache(store: OrgStore): Promise<Record<string, WorkStatus>> {
  return (await readJson<Record<string, WorkStatus>>(file(store))) ?? {};
}

const LINEAR = "https://api.linear.app/graphql";

async function linear<T>(token: string, query: string, variables: Record<string, unknown>, f: typeof fetch = fetch): Promise<T> {
  const res = await f(LINEAR, { method: "POST", headers: { authorization: token, "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
  if (res.status === 401 || res.status === 400) throw new Error("Linear didn't accept this key.");
  if (!res.ok) throw new Error(`Linear answered ${res.status}.`);
  const j = (await res.json()) as { data?: T; errors?: { message?: string }[] };
  if (!j.data) throw new Error(j.errors?.[0]?.message ?? "Linear didn't say.");
  return j.data;
}

/** Whose key it is (and that it works). */
export async function linearWhoAmI(token: string, f?: typeof fetch): Promise<string> {
  return (await linear<{ viewer?: { name?: string } }>(token, "query { viewer { name } }", {}, f)).viewer?.name ?? "Linear";
}

async function linearIssue(token: string, id: string, at: number, f?: typeof fetch): Promise<WorkStatus> {
  const d = await linear<{ issue?: { title?: string; state?: { name?: string; type?: string } } | null }>(token, "query($id: String!) { issue(id: $id) { title state { name type } } }", { id }, f);
  if (!d.issue) return { state: "unknown", label: "Not found", at };
  return { state: linearState(d.issue.state?.type), label: d.issue.state?.name ?? "", ...(d.issue.title ? { title: d.issue.title } : {}), at };
}

async function githubItem(ref: string, at: number, f: typeof fetch = fetch): Promise<WorkStatus> {
  const m = /^([^/]+)\/([^#]+)#(\d+)$/.exec(ref);
  if (!m) return { state: "unknown", label: "", at };
  const res = await f(`https://api.github.com/repos/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}/issues/${m[3]}`, { headers: { accept: "application/vnd.github+json", "user-agent": "Qalam" } });
  // A private repository (or one that's gone) says nothing without a token.
  if (res.status === 404) return { state: "unknown", label: "Can't see it", at };
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
  return githubStatus((await res.json()) as Parameters<typeof githubStatus>[0], at);
}

/** Each link's status, asked again when it's older than ten minutes (or `force`). */
export async function workStatuses(store: OrgStore, links: OstWork[], o: { force?: boolean; now?: number; fetch?: typeof fetch } = {}): Promise<Record<string, WorkStatus>> {
  const now = o.now ?? Date.now();
  const cache = await workCache(store);
  const linearKey = await secrets().get("connector:linear").catch(() => null);
  const asked: Record<string, WorkStatus> = {};
  await Promise.all(
    [...new Map(links.map((l) => [workKey(l), l])).values()].map(async (l) => {
      const key = workKey(l);
      const kept = cache[key];
      if (kept && !o.force && now - kept.at < FRESH_MS) return void (asked[key] = kept);
      try {
        if (l.connector === "linear") asked[key] = linearKey ? await linearIssue(linearKey, l.ref, now, o.fetch) : { state: "unknown", label: "Add Linear's key in Connections", at: now };
        else if (l.connector === "github") asked[key] = await githubItem(l.ref, now, o.fetch);
        else asked[key] = { state: "unknown", label: "", at: now };
      } catch {
        // Unreachable now: the last answer stands, if there is one.
        if (kept) asked[key] = kept;
      }
    }),
  );
  await locked(file(store), async () => atomicWrite(file(store), `${JSON.stringify({ ...(await workCache(store)), ...asked }, null, 2)}\n`));
  return asked;
}
