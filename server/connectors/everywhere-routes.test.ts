import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOrg } from "../org/home";
import { connectionsRoutes } from "../routes/connections";
import { resetSecrets } from "../secrets";

// Words and links only: no model process in tests.
process.env.QALAM_NO_MODELS = "1";

let base: string;
let org: string;
const home = process.env.QALAM_HOME;
const app = connectionsRoutes();
const post = (url: string, body: unknown) => app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const lines = async (res: Response) => (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as { type: string; message?: string });

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "qalam-everywhere-"));
  process.env.QALAM_HOME = path.join(base, "Qalam");
  process.env.QALAM_SECRETS = "memory";
  resetSecrets();
  org = (await createOrg("Basket", process.env.QALAM_HOME)).id;
});
afterEach(async () => {
  process.env.QALAM_HOME = home;
  await rm(base, { recursive: true, force: true });
});

describe("a look in every connected tool, by its routes", () => {
  it("asks what to look for, and says so when nothing is connected to look in", async () => {
    expect((await post(`/api/org/${org}/everywhere`, { about: " " })).status).toBe(400);
    const res = await post(`/api/org/${org}/everywhere`, { about: "What do we know about checkout drop-off?" });
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect((await lines(res)).at(-1)).toEqual({ type: "error", message: "No tool is connected to look in yet. Connections connects one." });
  });

  it("brings in only what was picked, from a tool it knows", async () => {
    expect(await (await post(`/api/org/${org}/everywhere/bring`, { picks: [] })).json()).toMatchObject({ message: "Pick something to bring in." });
    // A tool that isn't in the catalog, or an item with no title or a folder, isn't a pick.
    const odd = await post(`/api/org/${org}/everywhere/bring`, { picks: [{ tool: "dropbox", hit: { id: "x", title: "X" } }, { tool: "notion", hit: { id: "y" } }, { tool: "notion", hit: { id: "f", title: "Folder", folder: true } }] });
    expect(odd.status).toBe(400);
    // A tool that isn't connected says why, for each item.
    const res = await post(`/api/org/${org}/everywhere/bring`, { picks: [{ tool: "notion", hit: { id: "n1", title: "Checkout research" } }], scope: {} });
    expect((await lines(res)).at(-1)).toMatchObject({ type: "result", data: { added: [], failed: [{ title: "Checkout research", why: "Connect it first." }] } });
  });

  it("under a question, answers what every tool its kind fits has: none connected, none", async () => {
    expect((await post(`/api/org/${org}/everywhere/words`, { kind: "both", words: "x", question: "Q?" })).status).toBe(400);
    expect(await (await post(`/api/org/${org}/everywhere/words`, { kind: "docs", words: "checkout research", question: "Where do people leave checkout?" })).json()).toEqual({ found: [] });
    expect(await (await post("/api/everywhere/words", { kind: "numbers", words: "checkout funnel", question: "How many finish checkout?" })).json()).toEqual({ found: [] });
  });

  it("is the organization's: an unknown one is not found", async () => {
    expect((await post("/api/org/nope/everywhere", { about: "checkout" })).status).toBe(404);
    expect((await post("/api/org/nope/everywhere/bring", { picks: [] })).status).toBe(404);
  });
});
