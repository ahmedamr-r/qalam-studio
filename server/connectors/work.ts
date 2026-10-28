import path from "node:path";
import { githubStatus, linearState, WORK_RECIPES, workKey, type WorkStatus } from "@/connectors/work";
import type { OstWork } from "@/discovery/types";
import { atomicWrite, locked, readJson } from "../org/fsx";
import type { OrgStore } from "../org/store";
import { secrets } from "../secrets";
import { readSettings } from "../settings";
import { SignInAgain, withSignedIn } from "./oauth";

/*
 * Where the work linked to solutions stands, asked of the tools that hold it: Linear (through its
 * MCP server once Qalam signed in to it, else with the personal API key Qalam keeps in the
 * Keychain), Jira (through Atlassian's MCP server once signed in) and GitHub (public repositories
 * need none). The answers are kept per computer in the organization's .qalam/local/work.json, for
 * the cards, the card panel and the checks, and asked again when they're ten minutes old. Figma
 * links have no status yet: they show as links.
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

/** Linked items through a service's MCP server, with Qalam's sign-in: one session for all of them. */
async function signedInStatuses(connector: string, url: string, links: OstWork[], at: number, f?: typeof fetch): Promise<Map<string, WorkStatus>> {
  const recipe = WORK_RECIPES[connector];
  return withSignedIn(
    connector,
    url,
    async (call) => {
      const out = new Map<string, WorkStatus>();
      for (const l of links) {
        const answer = await call(recipe.status(l));
        // The server said no: it doesn't know the item, or this person can't see it.
        out.set(l.ref, answer === null ? { state: "unknown", label: "Can't see it", at } : (recipe.read(answer, l.ref, at) ?? { state: "unknown", label: "", at }));
      }
      return out;
    },
    f,
  );
}

/** Each link's status, asked again when it's older than ten minutes (or `force`). */
export async function workStatuses(store: OrgStore, links: OstWork[], o: { force?: boolean; now?: number; fetch?: typeof fetch } = {}): Promise<Record<string, WorkStatus>> {
  const now = o.now ?? Date.now();
  const cache = await workCache(store);
  const asked: Record<string, WorkStatus> = {};
  const due: OstWork[] = [];
  for (const l of new Map(links.map((l) => [workKey(l), l])).values()) {
    const kept = cache[workKey(l)];
    if (kept && !o.force && now - kept.at < FRESH_MS) asked[workKey(l)] = kept;
    else due.push(l);
  }
  // Through a service's MCP server where Qalam signed in to it (Linear, Jira): one session each.
  const settings = (await readSettings()).connectors ?? {};
  const sessions = new Map<string, Promise<Map<string, WorkStatus>>>();
  for (const connector of Object.keys(WORK_RECIPES)) {
    const via = settings[connector];
    const mine = due.filter((l) => l.connector === connector);
    if (via?.via !== "oauth" || !mine.length) continue;
    const session = signedInStatuses(connector, via.url, mine, now, o.fetch);
    session.catch(() => {});
    sessions.set(connector, session);
  }
  const linearKey = settings.linear?.via === "oauth" ? null : await secrets().get("connector:linear").catch(() => null);
  await Promise.all(
    due.map(async (l) => {
      const key = workKey(l);
      const kept = cache[key];
      const session = sessions.get(l.connector);
      try {
        if (session) asked[key] = (await session).get(l.ref) ?? { state: "unknown", label: "", at: now };
        else if (l.connector === "linear") asked[key] = linearKey ? await linearIssue(linearKey, l.ref, now, o.fetch) : { state: "unknown", label: "Connect Linear in Connections", at: now };
        else if (l.connector === "jira") asked[key] = { state: "unknown", label: "Connect Jira in Connections", at: now };
        else if (l.connector === "github") asked[key] = await githubItem(l.ref, now, o.fetch);
        else asked[key] = { state: "unknown", label: "", at: now };
      } catch (e) {
        // Unreachable now: the last answer stands, if there is one. A sign-in the service stopped taking says so.
        if (kept) asked[key] = kept;
        else if (e instanceof SignInAgain) asked[key] = { state: "unknown", label: e.message.replace(/\.$/, ""), at: now };
      }
    }),
  );
  await locked(file(store), async () => atomicWrite(file(store), `${JSON.stringify({ ...(await workCache(store)), ...asked }, null, 2)}\n`));
  return asked;
}
