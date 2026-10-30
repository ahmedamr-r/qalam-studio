import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetSecrets, secrets } from "../secrets";
import { readSettings, writeSettings } from "../settings";
import { browseDrive, driveList, readDriveFile, signInGoogle } from "./google";
import { connectorsView, forgetConnector, readItems } from "./index";
import { SignInAgain } from "./oauth";

/*
 * A stand-in for Google: its token endpoint (PKCE checked, refresh tokens that can be refused),
 * revocation, and Drive's API taking only the access tokens it gave. The browser is a function that
 * answers the sign-in page by calling Qalam's listener, as Google's page would.
 */
interface Fake {
  calls: { url: URL; body?: URLSearchParams }[];
  revoked: string[];
  challenge: string | null;
  refuseRefresh: boolean;
  tokens: Set<string>;
}
let fake: Fake;

const FILES = [
  { id: "doc1", name: "Pitch", mimeType: "application/vnd.google-apps.document", webViewLink: "https://docs.google.com/document/d/doc1/edit", modifiedTime: "2026-10-20T10:00:00Z" },
  { id: "dir1", name: "Research", mimeType: "application/vnd.google-apps.folder", webViewLink: "https://drive.google.com/drive/folders/dir1" },
  { id: "sheet1", name: "Survey", mimeType: "application/vnd.google-apps.spreadsheet", webViewLink: "https://docs.google.com/spreadsheets/d/sheet1/edit" },
  { id: "txt1", name: "notes.txt", mimeType: "text/plain", size: "40", webViewLink: "https://drive.google.com/file/d/txt1/view" },
  { id: "vid1", name: "Walkthrough.mp4", mimeType: "video/mp4", size: "9000" },
];

const google: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const body = init?.body instanceof URLSearchParams ? init.body : undefined;
  fake.calls.push({ url, ...(body ? { body } : {}) });
  if (url.href === "https://oauth2.googleapis.com/token") {
    if (body?.get("client_id") !== "qalam-test.apps.googleusercontent.com" || body.get("client_secret") !== "GOCSPX-test") return Response.json({ error: "invalid_client" }, { status: 401 });
    if (body.get("grant_type") === "authorization_code") {
      const ok = body.get("code") === "code-1" && fake.challenge === createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url");
      if (!ok) return Response.json({ error: "invalid_grant" }, { status: 400 });
      fake.tokens.add("access-1");
      return Response.json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3599, scope: "https://www.googleapis.com/auth/drive.readonly", token_type: "Bearer" });
    }
    if (body.get("grant_type") === "refresh_token") {
      if (fake.refuseRefresh || body.get("refresh_token") !== "refresh-1") return Response.json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 });
      fake.tokens.add("access-2");
      return Response.json({ access_token: "access-2", expires_in: 3599 });
    }
  }
  if (url.href === "https://oauth2.googleapis.com/revoke") {
    fake.revoked.push(body?.get("token") ?? "");
    return new Response("{}");
  }
  if (url.origin === "https://www.googleapis.com" && url.pathname.startsWith("/drive/v3/files")) {
    const token = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
    if (!fake.tokens.has(token)) return Response.json({ error: { code: 401 } }, { status: 401 });
    const rest = url.pathname.slice("/drive/v3/files".length);
    if (!rest) return Response.json({ files: FILES.map(({ size: _size, ...f }) => f) });
    const [, id, exported] = rest.split("/");
    const f = FILES.find((x) => x.id === id);
    if (!f) return Response.json({ error: { code: 404 } }, { status: 404 });
    if (exported === "export") {
      const mime = url.searchParams.get("mimeType");
      if (f.id === "doc1" && mime === "text/plain") return new Response("Families plan meals on Sunday.\n\nThey rebuild the list by hand.");
      if (f.id === "sheet1" && mime === "text/csv") return new Response("Name,What is hardest?\nSara,I rebuild the same list every week.\nOmar,I buy things twice.\n");
      return Response.json({ error: { code: 400 } }, { status: 400 });
    }
    if (url.searchParams.get("alt") === "media") return new Response(new TextEncoder().encode("Notes from the Thursday calls."));
    return Response.json({ id: f.id, name: f.name, mimeType: f.mimeType, ...(f.size ? { size: f.size } : {}) });
  }
  return new Response("not here", { status: 404 });
};

/** Google's page, approved: it sends the browser back to Qalam's listener with a code (and its issuer). */
const approve = (o: { iss?: string; error?: string } = {}) => async (page: string) => {
  const u = new URL(page);
  fake.challenge = u.searchParams.get("code_challenge");
  const back = new URL(u.searchParams.get("redirect_uri")!);
  back.search = new URLSearchParams({ state: u.searchParams.get("state")!, ...(o.error ? { error: o.error } : { code: "code-1" }), ...(o.iss === "" ? {} : { iss: o.iss ?? "https://accounts.google.com" }) }).toString();
  // The browser's request, after the page has gone back.
  setTimeout(() => void fetch(back).catch(() => {}), 10);
};

const card = async () => (await connectorsView()).connectors.find((c) => c.id === "drive")!;
const kept = async () => JSON.parse((await secrets().get("connector:drive:oauth")) ?? "null") as { access: string; refresh?: string; expires: number } | null;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-google-"));
  process.env.QALAM_HOME = dir;
  process.env.QALAM_SECRETS = "memory";
  process.env.QALAM_GOOGLE_CLIENT_ID = "qalam-test.apps.googleusercontent.com";
  process.env.QALAM_GOOGLE_CLIENT_SECRET = "GOCSPX-test";
  resetSecrets();
  fake = { calls: [], revoked: [], challenge: null, refuseRefresh: false, tokens: new Set() };
});
afterEach(() => {
  delete process.env.QALAM_GOOGLE_CLIENT_ID;
  delete process.env.QALAM_GOOGLE_CLIENT_SECRET;
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Qalam's own Google sign-in, for Drive", () => {
  it("is offered only in a copy that has a Google client", async () => {
    expect(await card()).toMatchObject({ canSignIn: true, account: "Google", word: "Not connected" });
    delete process.env.QALAM_GOOGLE_CLIENT_ID;
    expect(await card()).toMatchObject({ canSignIn: false, account: null });
    await expect(signInGoogle({ open: approve(), fetchFn: google })).rejects.toThrow(/no Google sign-in/);
  });

  it("asks for Drive read-only with PKCE, checks the token with Drive, then keeps it", async () => {
    let page = "";
    await signInGoogle({ open: async (p) => ((page = p), approve()(p)), fetchFn: google });
    const u = new URL(page);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ scope: "https://www.googleapis.com/auth/drive.readonly", response_type: "code", code_challenge_method: "S256", access_type: "offline", prompt: "consent" });
    expect(u.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(await kept()).toMatchObject({ access: "access-1", refresh: "refresh-1" });
    expect((await readSettings()).connectors?.drive).toEqual({ via: "google" });
    expect(await card()).toMatchObject({ via: "google", word: "Connected", tone: "ok" });
  });

  it("keeps nothing when the answer isn't Google's or the person said no", async () => {
    await expect(signInGoogle({ open: approve({ iss: "https://evil.example" }), fetchFn: google })).rejects.toThrow(/didn't come from Google/);
    await expect(signInGoogle({ open: approve({ error: "access_denied" }), fetchFn: google })).rejects.toThrow(/wasn't allowed/);
    expect(await kept()).toBeNull();
    expect((await readSettings()).connectors?.drive).toBeUndefined();
  });
});

describe("Drive's API with the kept tokens", () => {
  beforeEach(async () => {
    fake.tokens.add("access-1");
    await secrets().set("connector:drive:oauth", JSON.stringify({ access: "access-1", refresh: "refresh-1", expires: Date.now() + 3_600_000 }));
    await writeSettings({ connectors: { drive: { via: "google" } } });
  });

  it("lists a search, a folder or what was opened lately, folders first", async () => {
    expect(Object.fromEntries(driveList({ query: "meal plans" }))).toMatchObject({ q: "fullText contains 'meal' and fullText contains 'plans' and trashed = false" });
    expect(Object.fromEntries(driveList({ folder: "dir1" }))).toMatchObject({ q: "'dir1' in parents and trashed = false", orderBy: "folder,name" });
    expect(Object.fromEntries(driveList({ folder: "x' or 'y" }))).toMatchObject({ q: "'root' in parents and trashed = false" });
    expect(Object.fromEntries(driveList({}))).toMatchObject({ q: "trashed = false", orderBy: "viewedByMeTime desc", fields: "files(id,name,mimeType,modifiedTime,webViewLink)" });
    const hits = await browseDrive({}, google);
    expect(hits.map((h) => [h.title, h.type])).toEqual([
      ["Research", "folder"],
      ["Pitch", "doc"],
      ["Survey", "sheet"],
      ["notes.txt", "text"],
      ["Walkthrough.mp4", "other"],
    ]);
    expect(hits[1].url).toBe("https://docs.google.com/document/d/doc1/edit");
  });

  it("reads a Doc and a Sheet as Google exports them, a file as it is, and says which it can't", async () => {
    expect((await readDriveFile({ id: "doc1", title: "Pitch" }, google)).text).toBe("Families plan meals on Sunday.\n\nThey rebuild the list by hand.");
    expect((await readDriveFile({ id: "sheet1", title: "Survey" }, google)).text).toContain("Sara: I rebuild the same list every week.");
    expect((await readDriveFile({ id: "txt1", title: "notes.txt" }, google)).text).toBe("Notes from the Thursday calls.");
    await expect(readDriveFile({ id: "vid1", title: "Walkthrough.mp4" }, google)).rejects.toThrow(/can't read Walkthrough\.mp4/);
    await expect(readDriveFile({ id: "../files", title: "x" }, google)).rejects.toThrow(/isn't a Drive file/);
  });

  it("refreshes a token about to expire and keeps the refresh token", async () => {
    await secrets().set("connector:drive:oauth", JSON.stringify({ access: "access-1", refresh: "refresh-1", expires: Date.now() - 1000 }));
    await browseDrive({}, google);
    expect(await kept()).toMatchObject({ access: "access-2", refresh: "refresh-1" });
    expect(fake.calls.filter((c) => c.body?.get("grant_type") === "refresh_token")).toHaveLength(1);
  });

  it("is signed out when Google won't refresh any more", async () => {
    fake.tokens.clear();
    fake.refuseRefresh = true;
    await expect(browseDrive({}, google)).rejects.toBeInstanceOf(SignInAgain);
    expect(await kept()).toBeNull();
    expect(await card()).toMatchObject({ via: "google", word: "Sign in again", tone: "warn" });
  });

  it("revokes at Google on Disconnect, and forgets the tokens", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = google;
    try {
      await forgetConnector("drive");
    } finally {
      globalThis.fetch = real;
    }
    expect(fake.revoked).toEqual(["refresh-1"]);
    expect(await kept()).toBeNull();
    expect((await readSettings()).connectors?.drive).toBeUndefined();
  });

  it("reads picked files for the chat box with their Drive addresses, and notes the one it can't", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = google;
    try {
      const items = await readItems("drive", [{ id: "doc1", title: "Pitch", url: "https://docs.google.com/document/d/doc1/edit" }, { id: "vid1", title: "Walkthrough.mp4" }], () => {});
      expect(items[0]).toEqual({ id: "doc1", title: "Pitch", ingested: expect.objectContaining({ kind: "connector", title: "Pitch", origin: "https://docs.google.com/document/d/doc1/edit", text: "Families plan meals on Sunday.\n\nThey rebuild the list by hand." }) });
      expect(items[1]).toMatchObject({ id: "vid1", why: expect.stringMatching(/can't read/) });
    } finally {
      globalThis.fetch = real;
    }
  });
});
