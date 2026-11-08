import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { OrgStore } from "../org/store";
import { resetSecrets, secrets } from "../secrets";
import { connectDatabase, forgetDatabase, secretName, withDatabase } from "./connect";
import { startSampleDb, type SampleDb } from "./testing/sample";

process.env.QALAM_SECRETS = "memory";

let db: SampleDb;
beforeAll(async () => {
  db = await startSampleDb();
}, 90_000);
afterAll(async () => {
  await db?.close();
});

let dir: string;
let store: OrgStore;
beforeEach(async () => {
  resetSecrets();
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-db-")), "Basket Co");
  store = await OrgStore.create(dir, { id: "org1", name: "Basket Co", createdAt: 1 });
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

describe("connecting a project's database on this computer", () => {
  it("keeps a reader's string in the Keychain only, and what to show in this computer's state", async () => {
    await db.as("reader");
    const url = db.url("reader").replace("reader@", "reader:hunter2@");
    const r = await connectDatabase(store, { url }, { now: 7 });
    expect(r).toMatchObject({ state: "connected", local: { kind: "postgres", user: "reader", canWrite: false, hidden: ["public.notes"], at: 7 } });
    expect(JSON.parse((await secrets().get(secretName(store)))!)).toEqual({ url });
    const state = await readFile(path.join(dir, ".qalam/local/state.json"), "utf8");
    expect(JSON.parse(state).database.label).toBe(`reader@127.0.0.1:${db.port}/postgres`);
    expect(state).not.toContain("hunter2");
  }, 30_000);

  it("keeps nothing for a user that can write until they say to use it anyway", async () => {
    await db.as("writer");
    const r = await connectDatabase(store, { url: db.url("writer") });
    expect(r).toMatchObject({ state: "writes", rights: { writes: ["public.orders"] }, sql: expect.stringMatching(/qalam_reader/) });
    expect(store.databaseLocal).toBeNull();
    expect(await secrets().get(secretName(store))).toBeNull();
    const anyway = await connectDatabase(store, { url: db.url("writer"), anyway: true });
    expect(anyway).toMatchObject({ state: "connected", local: { canWrite: true, letIn: true, writes: ["public.orders"] } });
  }, 30_000);

  it("checks the user again at every session, and stops when it can write and wasn't let in", async () => {
    await db.as("reader");
    await connectDatabase(store, { url: db.url("reader") });
    expect(await withDatabase(store, async (r) => (await r.read("SELECT count(*) FROM orders")).rows[0][0])).toBe("300");
    // The same login, given more since it was connected (here: the session's role changes under it).
    await db.as("writer");
    await expect(withDatabase(store, async () => 1)).rejects.toMatchObject({ code: "writes", message: expect.stringMatching(/can change the database now/) });
  }, 30_000);

  it("forgets the string and the connection, and says to connect first", async () => {
    await db.as("reader");
    await connectDatabase(store, { url: db.url("reader") });
    await forgetDatabase(store);
    expect(await secrets().get(secretName(store))).toBeNull();
    await expect(withDatabase(store, async () => 1)).rejects.toMatchObject({ code: "unconnected" });
  }, 30_000);

  it("refuses what isn't a CA certificate", async () => {
    await expect(connectDatabase(store, { url: db.url("reader"), ca: "hello" })).rejects.toThrow(/CA certificate/);
  });
});
