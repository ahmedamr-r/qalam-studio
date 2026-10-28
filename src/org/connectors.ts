import type { ConnectorGroup } from "@/connectors/catalog";
import type { ListedStatus } from "@/connectors/claude-code";
import type { Hit } from "@/connectors/recipes";
import type { InsightNumbers } from "@/connectors/numbers";
import type { WorkStatus } from "@/connectors/work";
import type { OstWork } from "@/discovery/types";
import { orgPath } from "./client";

/*
 * Connectors in the window (server/connectors): their state on this computer, connecting one
 * (through Claude Code, Qalam's own sign-in in the browser, or a token kept in the Keychain), and
 * bringing an organization's material in from one.
 */

export interface ConnectorState {
  id: string;
  label: string;
  group: ConnectorGroup;
  feeds: "material" | "work" | "numbers";
  imports: boolean;
  /** A linked item's status shows on solution cards ("token": once one is kept; "public": always). */
  status: "token" | "public" | null;
  /** An outcome can read its number from it. */
  numbers: boolean;
  /** Claude Code's server for it, as `claude mcp list` last said. */
  claudeCode: { server: string; status: ListedStatus } | null;
  token: { last4: string } | null;
  canToken: boolean;
  tokenHelp: { label: string; href: string; placeholder: string } | null;
  /** Qalam can sign in to the service itself, in the browser. */
  canSignIn: boolean;
  /** The regions whose server it can sign in to, when there are several (the first by default). */
  regions: { id: string; label: string }[] | null;
  /** A service that takes only an app of the workspace's own: whether it's kept here, the link that creates it, where its credentials are, the address it lists. */
  ownApp: { kept: boolean; create: string; where: string; callback: string } | null;
  via: "claude-code" | "token" | "oauth" | null;
  word: string;
  tone: "ok" | "warn" | "off";
}

export interface ImportResult {
  added: string[];
  skipped: string[];
  failed: { title: string; why: string }[];
  /** The sources the items it added became. */
  sources?: string[];
  /** The topic pages filing them changed. */
  pages?: string[];
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Qalam couldn't answer (${res.status})`);
  return (await res.json()) as T;
}
const send = (path: string, method: string, body?: unknown) => fetch(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/** An NDJSON answer: each line to `on` until the result comes (or the error, thrown). */
async function streamed<T>(res: Response, on: (line: { type: string; label?: string; url?: string }) => void): Promise<T> {
  if (!res.ok || !res.body) return json<T>(res);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const m = JSON.parse(line) as { type: string; label?: string; url?: string; data?: T; message?: string };
      if (m.type === "result" && m.data) return m.data;
      if (m.type === "error") throw new Error(m.message ?? "It stopped.");
      on(m);
    }
  }
  throw new Error("It stopped before saying how it went.");
}

type View = { checkedAt: number | null; connectors: ConnectorState[] };

export const connectorsDb = {
  list: () => fetch("/api/connectors").then((r) => json<View>(r)),
  /** Ask Claude Code which it has (it checks each, about twenty seconds). */
  check: () => send("/api/connectors/check", "POST").then((r) => json<View>(r)),
  viaClaudeCode: (id: string, server: string) => send(`/api/connectors/${id}`, "PUT", { via: "claude-code", server }).then((r) => json<View>(r)),
  saveToken: (id: string, token: string) => send(`/api/connectors/${id}/token`, "PUT", { token }).then((r) => json<View & { who: string }>(r)),
  forget: (id: string) => send(`/api/connectors/${id}`, "DELETE").then((r) => json<View>(r)),
  /** Sign in in the system's browser; `onPage` hears the page's address (a link, in case it didn't open). Ends once it's done there. */
  signIn: async (id: string, onPage: (url: string) => void, region?: string) => streamed<View>(await send(`/api/connectors/${id}/signin`, "POST", region ? { region } : {}), (m) => m.type === "open" && m.url && onPage(m.url)),
  stopSignIn: (id: string) => send(`/api/connectors/${id}/signin`, "DELETE"),
  /** Keep the ID and secret of the workspace's own app, in the Keychain. */
  keepApp: (id: string, clientId: string, clientSecret?: string) => send(`/api/connectors/${id}/app`, "PUT", { clientId, ...(clientSecret ? { clientSecret } : {}) }).then((r) => json<View>(r)),
  search: async (id: string, query: string) => json<{ hits: Hit[] }>(await send(await orgPath(`/connectors/${id}/search`), "POST", { query })),
  /** Takes each picked item in; `onActivity` hears how it's going. */
  bringIn: async (id: string, hits: Hit[], onActivity: (label: string) => void): Promise<ImportResult> => {
    return streamed<ImportResult>(await send(await orgPath(`/connectors/${id}/import`), "POST", { hits }), (m) => m.type === "activity" && m.label && onActivity(m.label));
  },
};

/** Where the work linked to solutions stands (Linear, GitHub), kept per computer for ten minutes. */
export const workDb = {
  status: async (links: OstWork[], force = false) => json<{ statuses: Record<string, WorkStatus> }>(await send(await orgPath("/work/status"), "POST", { links, force })),
};

/** An outcome's number from a saved PostHog insight (through Claude Code: about a minute each). */
export const numbersDb = {
  insights: (query: string) => send("/api/connectors/posthog/insights", "POST", { query }).then((r) => json<{ hits: Hit[] }>(r)),
  read: (ref: string) => send("/api/connectors/posthog/read", "POST", { ref }).then((r) => json<InsightNumbers>(r)),
};
