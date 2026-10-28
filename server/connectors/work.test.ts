import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgStore } from "../org/store";
import { resetSecrets, secrets } from "../secrets";
import { workCache, workStatuses } from "./work";

let dir: string;
const store = () => ({ dir }) as unknown as OrgStore;
const NOW = Date.UTC(2026, 9, 28, 12);

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-work-"));
  process.env.QALAM_HOME = dir;
  process.env.QALAM_SECRETS = "memory";
  resetSecrets();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const pr = { connector: "github", ref: "basket/app#42", url: "https://github.com/basket/app/pull/42" };
const issue = { connector: "linear", ref: "ENG-12", url: "https://linear.app/b/issue/ENG-12" };
const figma = { connector: "figma", ref: "AbC", url: "https://www.figma.com/design/AbC/x" };

/** Stand-ins for GitHub's and Linear's APIs. */
const apis = (linearType = "started") =>
  vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("https://api.github.com/repos/basket/app/issues/42")) return Response.json({ state: "open", title: "Show fees early", pull_request: {} });
    if (url === "https://api.linear.app/graphql") {
      const body = JSON.parse(String(init?.body)) as { variables?: { id?: string } };
      return Response.json({ data: { issue: body.variables?.id === "ENG-12" ? { title: "Fee breakdown", state: { name: linearType === "completed" ? "Done" : "In Progress", type: linearType } } : null } });
    }
    return new Response("{}", { status: 404 });
  });

describe("where linked work stands", () => {
  it("asks GitHub (public, no token) and Linear (its key from the Keychain), and says when Linear isn't connected", async () => {
    const f = apis();
    const first = await workStatuses(store(), [pr, issue, figma], { now: NOW, fetch: f as unknown as typeof fetch });
    expect(first["github:basket/app#42"]).toMatchObject({ state: "doing", label: "Open", title: "Show fees early" });
    expect(first["linear:ENG-12"]).toMatchObject({ state: "unknown", label: "Connect Linear in Connections" });
    expect(first["figma:AbC"]).toMatchObject({ state: "unknown", label: "" });

    await secrets().set("connector:linear", "lin_api_test");
    const again = await workStatuses(store(), [issue], { now: NOW, force: true, fetch: f as unknown as typeof fetch });
    expect(again["linear:ENG-12"]).toMatchObject({ state: "doing", label: "In Progress", title: "Fee breakdown" });
    expect(Object.keys(await workCache(store())).sort()).toEqual(["figma:AbC", "github:basket/app#42", "linear:ENG-12"]);
  });

  it("keeps answers ten minutes, asks again when forced, and keeps the last answer when the tool can't be reached", async () => {
    await secrets().set("connector:linear", "lin_api_test");
    const f = apis();
    await workStatuses(store(), [issue], { now: NOW, fetch: f as unknown as typeof fetch });
    const calls = f.mock.calls.length;
    await workStatuses(store(), [issue], { now: NOW + 5 * 60_000, fetch: f as unknown as typeof fetch });
    expect(f.mock.calls.length).toBe(calls);
    const done = await workStatuses(store(), [issue], { now: NOW + 5 * 60_000, force: true, fetch: apis("completed") as unknown as typeof fetch });
    expect(done["linear:ENG-12"]).toMatchObject({ state: "done", label: "Done" });
    const offline = vi.fn(async () => {
      throw new Error("offline");
    });
    expect((await workStatuses(store(), [issue], { now: NOW + 30 * 60_000, fetch: offline as unknown as typeof fetch }))["linear:ENG-12"]).toMatchObject({ state: "done" });
  });
});
