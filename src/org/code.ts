import { callAI } from "@/ai/client";
import type { CodeRepo, ProductMap } from "@/code/map";
import { orgFetch, orgJson, orgPath } from "./client";

/*
 * A product's code in the window (server/code): the repositories this computer reads, what each
 * product does today, reading one (copied and read in the core), Qalam's own GitHub sign-in, and
 * a read-code job's answer.
 */

export interface CodeView {
  /** Who this Mac's GitHub CLI is signed in as (null: not installed or not signed in). */
  gh: string | null;
  /** Qalam's GitHub App is registered here: "Sign in with GitHub" works. */
  app: boolean;
  signedIn: boolean;
  repos: CodeRepo[];
  maps: ProductMap[];
}

export interface ReadResult {
  flows: number;
  steps: number;
  events: number;
  screens: number;
}

const run = async <T>(path: string, body: unknown, onActivity: (label: string) => void) =>
  (
    await callAI<T>(await orgPath(path), body, undefined, undefined, (e) => {
      if (e.type === "activity") onActivity(e.label);
    })
  ).data;

async function post<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const j = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(j.message ?? `Qalam couldn't answer (${res.status})`);
  return j;
}

export const codeDb = {
  view: () => orgJson<CodeView>("/code"),
  /** Link a repository or a folder to a product and read it; `onActivity` hears how it's going. */
  add: (input: { kind: "github"; repo: string; product: string | null } | { kind: "folder"; path: string; product: string | null }, onActivity: (label: string) => void) => run<ReadResult & { repo: CodeRepo }>("/code", input, onActivity),
  read: (key: string, onActivity: (label: string) => void) => run<ReadResult>(`/code/${encodeURIComponent(key)}/read`, {}, onActivity),
  remove: (key: string) => orgFetch(`/code/${encodeURIComponent(key)}`, { method: "DELETE" }).then(() => undefined),
  /** The Mac's own folder picker. */
  chooseFolder: () => post<{ path: string | null }>("/api/code/folder"),
  /** Qalam's own GitHub sign-in: the code to enter on github.com, then whether it's done. */
  signIn: () => post<{ id: string; code: string; url: string; interval: number }>("/api/code/github/signin"),
  poll: (id: string) => post<{ state: "pending" | "done" | "expired" | "denied" }>(`/api/code/github/signin/${encodeURIComponent(id)}`),
  /** A read-code job's question, answered from the product's code. */
  answer: (job: string, onActivity: (label: string) => void) => run<{ text: string | null }>(`/jobs/${encodeURIComponent(job)}/code`, {}, onActivity),
};
