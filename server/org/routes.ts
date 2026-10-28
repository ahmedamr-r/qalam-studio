import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { sanitizeDecision, type Decision } from "@/decisions/model";
import type { Doc } from "@/doc/schema";
import type { Project } from "@/projects/model";
import type { ContextFields, Product } from "@/org/context-md";
import { IndexUnavailable } from "../index/db";
import { topicsOf, type OrgIndex, type PieceRow } from "../index/indexer";
import { indexFor } from "../index/registry";
import { packedPieces, packFor, search, showsUp, type Hit } from "../index/search";
import { orgGraph } from "@/hub/graph";
import { filingShape, topicShape, type Topic } from "@/hub/topics";
import { chooseFolder, createOrg, currentOrg, listOrgs, openFolder, qalamHome, rememberOrg, storeFor } from "./home";
import { noticesNow } from "./notices";
import { reviewOrg } from "./review";
import { askOrg } from "../ask";
import { captureSource } from "../capture";
import type { Ingested } from "@/discovery/ingest/core";
import type { Proposal } from "@/discovery/proposals";
import { MAX_SOURCE_TEXT, SOURCE_KIND_LABEL, type SourceRecord } from "@/discovery/sources";
import { aiConfigured, rateLimited } from "@/ai/server";
import { ConflictError, NotFoundError, type OrgEvent, type OrgStore } from "./store";

/**
 * The org's files over HTTP (and over the desktop app's message port, which carries the same
 * requests). Reads return a version in ETag; writes that could lose someone else's change carry
 * If-Match and get 409 with the current version when it moved. `x-qalam-tab` names the window that
 * wrote, so its own changes aren't announced back to it.
 */

type Env = { Variables: { store: OrgStore } };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const HASH = /^[0-9a-f]{24}$/;
const tabOf = (h: Headers) => h.get("x-qalam-tab") ?? undefined;
const ifMatch = (h: Headers) => h.get("if-match")?.replace(/^W\//, "").replace(/"/g, "") || undefined;
const etag = (v: string) => `"${v}"`;

function failure(e: unknown): Response {
  if (e instanceof ConflictError) return Response.json({ error: "conflict", message: e.message, version: e.version, current: e.current }, { status: 409, headers: { etag: etag(e.version) } });
  if (e instanceof NotFoundError) return Response.json({ error: "not_found", message: e.message }, { status: 404 });
  return Response.json({ error: "failed", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
}

const bad = (message: string) => Response.json({ error: "bad_request", message }, { status: 400 });

export function orgRoutes(): Hono<Env> {
  const r = new Hono<Env>();

  // Organizations: which there are, the one a new window opens, making and opening them.
  r.get("/api/orgs", async (c) => {
    const current = await currentOrg();
    const orgs = await listOrgs();
    return c.json({ home: qalamHome(), current: current.id, orgs: orgs.map(({ id, name, dir }) => ({ id, name, dir })) });
  });
  r.post("/api/orgs", async (c) => {
    const { name } = (await c.req.json().catch(() => ({}))) as { name?: string };
    if (!name?.trim()) return bad("Name the organization");
    return c.json(await createOrg(name));
  });
  /** Open a folder as an organization: the one given, or one picked with the Mac's own picker. */
  r.post("/api/orgs/open", async (c) => {
    let { path: dir } = (await c.req.json().catch(() => ({}))) as { path?: string };
    if (!dir) {
      const picked = await chooseFolder("Choose a folder for the organization");
      if (picked === "unsupported") return c.json({ error: "no_picker", message: "Type the folder's path instead." }, 400);
      if (!picked) return c.json({ cancelled: true });
      dir = picked;
    }
    try {
      return c.json(await openFolder(dir));
    } catch (e) {
      return bad(e instanceof Error ? e.message : String(e));
    }
  });
  r.post("/api/orgs/last", async (c) => {
    const { id } = (await c.req.json().catch(() => ({}))) as { id?: string };
    if (!id || !ID.test(id) || !(await listOrgs()).some((o) => o.id === id)) return bad("No such organization");
    await rememberOrg(id);
    return c.json({ ok: true });
  });

  r.use("/api/org/:org/*", async (c, next) => {
    const id = c.req.param("org");
    const store = ID.test(id) ? await storeFor(id) : null;
    if (!store) return c.json({ error: "no_org", message: "That organization isn't here." }, 404);
    c.set("store", store);
    await next();
  });

  r.get("/api/org/:org/info", (c) => {
    const { id, name } = c.get("store").info;
    return c.json({ id, name, dir: c.get("store").dir });
  });
  r.patch("/api/org/:org/info", async (c) => {
    const { name } = (await c.req.json().catch(() => ({}))) as { name?: string };
    if (!name?.trim()) return bad("Name the organization");
    await c.get("store").rename(name);
    const { id, name: n } = c.get("store").info;
    return c.json({ id, name: n, dir: c.get("store").dir });
  });

  // What the organization and its products are (about.md, products/*.md), and their goals.
  r.get("/api/org/:org/about", async (c) => c.json(await c.get("store").getAbout()));
  r.put("/api/org/:org/about", async (c) => {
    const a = (await c.req.json()) as ContextFields;
    if (!isContext(a)) return bad("Not an organization's context");
    await c.get("store").putAbout(a, { tab: tabOf(c.req.raw.headers) });
    return c.json({ ok: true });
  });
  r.get("/api/org/:org/products", async (c) => c.json(await c.get("store").listProducts()));
  r.put("/api/org/:org/products/:id", async (c) => {
    const p = (await c.req.json()) as Product;
    if (!p || p.id !== c.req.param("id") || !ID.test(p.id) || typeof p.name !== "string" || !p.name.trim() || !isContext(p)) return bad("Not a product");
    await c.get("store").putProduct({ ...p, name: p.name.trim().slice(0, 80) }, { tab: tabOf(c.req.raw.headers) });
    return c.json({ ok: true });
  });
  r.delete("/api/org/:org/products/:id", async (c) => {
    await c.get("store").removeProduct(c.req.param("id"), { tab: tabOf(c.req.raw.headers) });
    return c.json({ ok: true });
  });
  r.get("/api/org/:org/goals", async (c) => c.json(await c.get("store").listGoals()));

  // Decisions: the log, newest first (a board's or a card's), added to as boards change.
  r.get("/api/org/:org/decisions", (c) => {
    const { board, card, limit } = c.req.query();
    const n = Number(limit);
    return c.json(c.get("store").listDecisions({ board: board || undefined, card: card || undefined, limit: n > 0 ? Math.min(n, 1000) : undefined }));
  });
  r.post("/api/org/:org/decisions", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { decisions?: unknown[] } | null;
    const list = Array.isArray(body?.decisions) && body.decisions.length <= 200 ? body.decisions.map(sanitizeDecision) : [];
    if (!list.length || list.some((d) => !d)) return bad("Not decisions");
    await c.get("store").appendDecisions(list as Decision[], { tab: tabOf(c.req.raw.headers) });
    return c.json({ ok: true });
  });
  r.patch("/api/org/:org/decisions/:id", async (c) => {
    const p = (await c.req.json().catch(() => null)) as { why?: unknown; undone?: unknown } | null;
    const why = p?.why;
    if (!p || (why !== undefined && why !== null && typeof why !== "string") || (p.undone !== undefined && typeof p.undone !== "boolean")) return bad("Not a change to a decision");
    try {
      const d = await c.get("store").updateDecision(c.req.param("id"), { why: typeof why === "string" ? why.replace(/\s+/g, " ").slice(0, 500) : (why as null | undefined), undone: p.undone as boolean | undefined }, { tab: tabOf(c.req.raw.headers) });
      return c.json(d);
    } catch (e) {
      return failure(e);
    }
  });

  // Search: what the organization knows, by words, meaning and links; and a budget of it for a model call.
  r.get("/api/org/:org/search", (c) =>
    withIndex(c.get("store"), async (ix) => {
      const { q, anchor, product, limit } = c.req.query();
      const { hits, used } = await search(ix, { query: q ?? "", anchor: anchor || undefined, product: productParam(product), limit: clamp(limit, 1, 100, 20) });
      return c.json({ hits: hits.map(publicPiece), used, index: ix.status(), models: ix.models?.state() ?? null });
    }),
  );
  r.post("/api/org/:org/pack", async (c) => {
    const b = (await c.req.json().catch(() => null)) as { query?: unknown; anchor?: unknown; product?: unknown; budget?: unknown; wholeTop?: unknown; types?: unknown; exclude?: unknown } | null;
    if (!b || typeof b.query !== "string") return bad("Say what the call is about");
    const strings = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length <= 200).slice(0, max) : undefined);
    return withIndex(c.get("store"), async (ix) => {
      const p = await packFor(ix, {
        query: b.query as string,
        anchor: typeof b.anchor === "string" ? b.anchor : undefined,
        product: b.product === null ? null : typeof b.product === "string" ? b.product : undefined,
        budget: clamp(b.budget, 200, 100_000, 6000),
        wholeTop: clamp(b.wholeTop, 0, 50, 8),
        types: strings(b.types, 10),
        exclude: strings(b.exclude, 2000),
      });
      // Each piece as the call sends it, with what the board needs to use it (a quote's source).
      return c.json({ block: p.block, items: packedPieces(p), tokens: p.tokens, left: p.left, used: p.used });
    });
  });
  r.get("/api/org/:org/pieces", (c) =>
    withIndex(c.get("store"), (ix) => {
      const ref = c.req.query("ref") ?? "";
      const row = ix.piecesByRef([ref]).get(ref);
      if (!row) return c.json({ error: "not_found" }, 404);
      const links = ix.links(ref);
      const near = ix.piecesByRef(links.map((l) => l.ref));
      return c.json({ ...publicPiece(row), links: links.map((l) => ({ ...l, title: near.get(l.ref)?.title ?? null, type: near.get(l.ref)?.type ?? null })) });
    }),
  );
  r.get("/api/org/:org/index", (c) => withIndex(c.get("store"), (ix) => c.json({ ...ix.status(), models: ix.models?.state() ?? null })));
  r.get("/api/org/:org/graph", (c) =>
    withIndex(c.get("store"), (ix) => {
      const { pieces, links } = ix.everything();
      return c.json(orgGraph(pieces, links, { product: productParam(c.req.query("product")) }));
    }),
  );

  // Topic pages: what the organization knows about each need, segment and product (hub/topics).
  r.get("/api/org/:org/topics", async (c) => c.json(await c.get("store").listTopics()));
  r.get("/api/org/:org/topics/:id", async (c) => {
    const store = c.get("store");
    const t = await store.getTopic(c.req.param("id"));
    if (!t) return c.json({ error: "not_found" }, 404);
    return c.json({ topic: t, ...(await topicContext(store, t)) }, 200, { etag: etag(t.version) });
  });
  r.put("/api/org/:org/topics/:id", async (c) => {
    const t = topicShape(await c.req.json().catch(() => null), c.req.param("id"));
    if (!t) return bad("Not a topic page");
    try {
      const v = await c.get("store").putTopic(t, { ifMatch: ifMatch(c.req.raw.headers), tab: tabOf(c.req.raw.headers) });
      return c.json({ version: v }, 200, { etag: etag(v) });
    } catch (e) {
      return failure(e);
    }
  });
  r.delete("/api/org/:org/topics/:id", async (c) => {
    await c.get("store").removeTopic(c.req.param("id"), { tab: tabOf(c.req.raw.headers) });
    return c.json({ ok: true });
  });
  /** What Qalam AI filed into the pages, as code kept it, and the quotes the pages have now seen. */
  r.post("/api/org/:org/topics/file", async (c) => {
    const b = (await c.req.json().catch(() => null)) as { filing?: unknown; from?: unknown; filed?: unknown } | null;
    const f = filingShape(b?.filing);
    if (!f || typeof b?.from !== "string" || b.from.length > 400) return bad("Not a filing");
    const filed: Record<string, string[]> = {};
    for (const [id, quotes] of Object.entries((b.filed ?? {}) as Record<string, unknown>).slice(0, 200)) {
      if (!ID.test(id) || !Array.isArray(quotes)) return bad("Not a list of filed quotes");
      filed[id] = quotes.filter((q): q is string => typeof q === "string" && ID.test(q)).slice(0, 2000);
    }
    const res = await c.get("store").fileTopics(f, { from: b.from, filed, tab: tabOf(c.req.raw.headers) });
    return c.json({ created: res.created, counts: res.counts, pages: res.pages.map((p) => ({ id: p.id, title: p.title, kind: p.kind })) });
  });

  // Needs a look: what code's checks and Qalam AI's reviews found, less what was dismissed; a
  // board asks for what's about its cards.
  r.get("/api/org/:org/notices", async (c) => {
    const n = await noticesNow(c.get("store"));
    const board = c.req.query("board");
    return c.json(board ? { ...n, notices: n.notices.filter((x) => x.board === board || x.other?.board === board) } : n);
  });
  r.post("/api/org/:org/notices/dismiss", async (c) => {
    const { key, on } = (await c.req.json().catch(() => ({}))) as { key?: unknown; on?: unknown };
    if (typeof key !== "string" || !key || key.length > 400) return bad("Say which notice");
    await c.get("store").dismissNotice(key, on !== false, { tab: tabOf(c.req.raw.headers) });
    return c.json({ ok: true });
  });
  /** This computer opened the home: what was its last visit before. */
  r.post("/api/org/:org/notices/visit", async (c) => c.json({ previous: await c.get("store").visit() }));
  /** Review now: Qalam AI reads the organization for what needs a look (its findings join the notices). */
  r.post("/api/org/:org/review", async (c) => {
    if (!aiConfigured()) return c.json({ error: "no_key", message: "Qalam AI isn't set up here." }, 501);
    if (rateLimited(c.req.raw)) return c.json({ error: "rate_limited", message: "Too many requests, try again in a few minutes." }, 429);
    try {
      return c.json({ findings: await reviewOrg(c.get("store"), { tab: tabOf(c.req.raw.headers) }) });
    } catch (e) {
      return c.json({ error: "failed", message: e instanceof Error ? e.message : String(e) }, 502);
    }
  });
  /** Ask the organization: Qalam AI's answer, checked by code, streamed (NDJSON) with what it's doing meanwhile. */
  r.post("/api/org/:org/ask", async (c) => {
    if (!aiConfigured()) return c.json({ error: "no_key", message: "Qalam AI isn't set up here." }, 501);
    if (rateLimited(c.req.raw)) return c.json({ error: "rate_limited", message: "Too many requests, try again in a few minutes." }, 429);
    const b = (await c.req.json().catch(() => null)) as { question?: unknown; product?: unknown } | null;
    const question = typeof b?.question === "string" ? b.question.replace(/\s+/g, " ").trim().slice(0, 1000) : "";
    if (question.length < 3) return bad("Ask a question");
    const product = typeof b?.product === "string" && ID.test(b.product) ? b.product : null;
    const store = c.get("store");
    return streamed(c.req.raw.signal, (emit, signal) => askOrg(store, { question, product }, { emit, signal }));
  });
  /**
   * Capture: material added to the organization (read in the window: a paste, a file, a page). The
   * core keeps it as a source and does what a board would: picks out what customers said, files it
   * into the topic pages, proposes where it fits on the boards. Streamed (NDJSON) as it goes.
   */
  r.post("/api/org/:org/capture", async (c) => {
    if (!aiConfigured()) return c.json({ error: "no_key", message: "Qalam AI isn't set up here." }, 501);
    if (rateLimited(c.req.raw)) return c.json({ error: "rate_limited", message: "Too many requests, try again in a few minutes." }, 429);
    const b = (await c.req.json().catch(() => null)) as { ingested?: unknown; product?: unknown } | null;
    const ing = ingestedShape(b?.ingested);
    if (!ing) return bad("Not something to add");
    const product = typeof b?.product === "string" && ID.test(b.product) ? b.product : null;
    const store = c.get("store");
    return streamed(c.req.raw.signal, (emit, signal) => captureSource(store, ing, { product, emit, signal }));
  });
  /** What Qalam AI proposed for a board from what was added to the organization, by source. */
  r.get("/api/org/:org/placements", async (c) => {
    const board = c.req.query("board") ?? "";
    if (!ID.test(board)) return bad("Say which board");
    const store = c.get("store");
    const out = [];
    for (const [sourceId, proposals] of Object.entries(await store.placementsFor(board))) {
      const s = await store.getSource(sourceId);
      if (s && proposals.length) out.push({ sourceId, title: s.title, at: s.addedAt, proposals });
    }
    return c.json(out);
  });
  /** What's left waiting on a board from one source, after the board reviewed some (none: all done). */
  r.post("/api/org/:org/placements", async (c) => {
    const b = (await c.req.json().catch(() => null)) as { board?: unknown; sourceId?: unknown; proposals?: unknown } | null;
    if (typeof b?.board !== "string" || !ID.test(b.board) || typeof b.sourceId !== "string" || !ID.test(b.sourceId) || !Array.isArray(b.proposals) || b.proposals.length > 200) return bad("Say which board, which source, and what's left");
    await c.get("store").setPlacements(b.board, b.sourceId, b.proposals as Proposal[], { tab: tabOf(c.req.raw.headers) });
    return c.json({ ok: true });
  });
  // Cards on two boards linked as the same need.
  /** All links, or one card's: the cards it's linked to, with their titles and boards. */
  r.get("/api/org/:org/relations", async (c) => {
    const store = c.get("store");
    const card = c.req.query("card");
    const links = await store.listRelations();
    if (!card) return c.json(links);
    const out: { ref: string; board: string; boardName: string; card: string; title: string; at: number }[] = [];
    for (const l of links) {
      const other = l.a === card ? l.b : l.b === card ? l.a : null;
      const m = other ? /^hub:card:([^:]+):([^:]+)$/.exec(other) : null;
      const p = m ? store.getProject(m[1])?.record : null;
      if (!m || !p) continue;
      const node = (await store.getDoc(p.id))?.doc?.nodes[m[2]] as { meta?: { ost?: { title?: string } } } | undefined;
      if (node?.meta?.ost) out.push({ ref: other!, board: p.id, boardName: p.name, card: m[2], title: node.meta.ost.title ?? "", at: l.at });
    }
    return c.json(out);
  });
  r.post("/api/org/:org/relations", async (c) => {
    const { a, b, on } = (await c.req.json().catch(() => ({}))) as { a?: unknown; b?: unknown; on?: unknown };
    if (!isCardRef(a) || !isCardRef(b) || a === b) return bad("Say which two cards");
    await c.get("store").linkCards(a, b, on !== false, { tab: tabOf(c.req.raw.headers) });
    return c.json({ ok: true });
  });

  // Projects: records, then each one's document.
  r.get("/api/org/:org/projects", (c) => c.json(c.get("store").listProjects()));
  r.get("/api/org/:org/projects/:id", (c) => {
    const p = c.get("store").getProject(c.req.param("id"));
    return p ? c.json(p.record, 200, { etag: etag(p.version) }) : c.json({ error: "not_found" }, 404);
  });
  r.put("/api/org/:org/projects/:id", async (c) => {
    const p = (await c.req.json()) as Project;
    if (!p || p.id !== c.req.param("id") || !ID.test(p.id) || !["screens", "system", "discovery"].includes(p.type)) return bad("Not a project");
    try {
      const v = await c.get("store").putProject(p, { ifMatch: ifMatch(c.req.raw.headers), tab: tabOf(c.req.raw.headers) });
      return c.json({ version: v }, 200, { etag: etag(v) });
    } catch (e) {
      return failure(e);
    }
  });
  r.patch("/api/org/:org/projects/:id", async (c) => {
    const patch = (await c.req.json()) as Record<string, unknown>;
    if (!patch || typeof patch !== "object") return bad("Not a change");
    try {
      const { record, version } = await c.get("store").patchProject(c.req.param("id"), patch, { tab: tabOf(c.req.raw.headers) });
      return c.json(record, 200, { etag: etag(version) });
    } catch (e) {
      return failure(e);
    }
  });
  r.delete("/api/org/:org/projects/:id", async (c) => {
    await c.get("store").removeProject(c.req.param("id"), { tab: tabOf(c.req.raw.headers) });
    return c.json({ ok: true });
  });
  r.get("/api/org/:org/projects/:id/doc", async (c) => {
    const d = await c.get("store").getDoc(c.req.param("id"));
    return d ? c.json({ doc: d.doc }, 200, { etag: etag(d.version) }) : c.json({ error: "not_found" }, 404);
  });
  r.put("/api/org/:org/projects/:id/doc", async (c) => {
    const body = (await c.req.json()) as { doc?: Doc; patch?: Record<string, unknown> };
    if (!body?.doc || typeof body.doc.nodes !== "object" || !Array.isArray(body.doc.roots)) return bad("Not a document");
    try {
      const v = await c.get("store").putDoc(c.req.param("id"), body.doc, { ifMatch: ifMatch(c.req.raw.headers), patch: body.patch, tab: tabOf(c.req.raw.headers) });
      return c.json({ version: v }, 200, { etag: etag(v) });
    } catch (e) {
      return failure(e);
    }
  });

  // Sources: the organization's, each on the boards that use it.
  r.get("/api/org/:org/sources", async (c) => c.json(await c.get("store").listSources(c.req.query("board") || undefined)));
  r.get("/api/org/:org/sources/:id", async (c) => {
    const s = await c.get("store").getSource(c.req.param("id"));
    return s ? c.json(s) : c.json({ error: "not_found" }, 404);
  });
  r.post("/api/org/:org/sources/:id/boards", async (c) => {
    const { board, on } = (await c.req.json().catch(() => ({}))) as { board?: string; on?: boolean };
    if (!board || !ID.test(board) || typeof on !== "boolean") return bad("Say which board, and whether it's on it");
    try {
      await c.get("store").linkSource(c.req.param("id"), board, on, { tab: tabOf(c.req.raw.headers) });
      return c.json({ ok: true });
    } catch (e) {
      return failure(e);
    }
  });
  r.put("/api/org/:org/sources/:id", async (c) => {
    const s = (await c.req.json()) as SourceRecord;
    if (!s || s.id !== c.req.param("id") || !ID.test(s.id) || typeof s.text !== "string") return bad("Not a source");
    await c.get("store").putSource(s, { tab: tabOf(c.req.raw.headers) });
    return c.json({ ok: true });
  });
  r.delete("/api/org/:org/sources/:id", async (c) => {
    await c.get("store").removeSource(c.req.param("id"), { tab: tabOf(c.req.raw.headers) });
    return c.json({ ok: true });
  });

  // Chats and AI traces.
  r.get("/api/org/:org/chats", async (c) => c.json(await c.get("store").listChats()));
  r.put("/api/org/:org/chats/:id", async (c) => {
    const chat = (await c.req.json()) as { id: string; projectId?: string };
    if (!chat || chat.id !== c.req.param("id") || !ID.test(chat.id) || (chat.projectId !== undefined && !ID.test(chat.projectId))) return bad("Not a chat");
    await c.get("store").putChat(chat, { tab: tabOf(c.req.raw.headers) });
    return c.json({ ok: true });
  });
  r.delete("/api/org/:org/chats/:id", async (c) => {
    await c.get("store").removeChat(c.req.param("id"));
    return c.json({ ok: true });
  });
  r.get("/api/org/:org/traces/:project", async (c) => {
    const project = c.req.param("project");
    return ID.test(project) ? c.json(await c.get("store").listTraces(project)) : bad("Not a project");
  });
  r.put("/api/org/:org/traces/:project/:id", async (c) => {
    const t = (await c.req.json()) as { id: string; projectId: string };
    if (!t || t.id !== c.req.param("id") || t.projectId !== c.req.param("project") || !ID.test(t.id) || !ID.test(t.projectId)) return bad("Not a trace");
    await c.get("store").putTrace(t);
    return c.json({ ok: true });
  });
  r.delete("/api/org/:org/traces/:project/:id", async (c) => {
    const { project, id } = c.req.param();
    if (!ID.test(project) || !ID.test(id)) return bad("Not a trace");
    await c.get("store").removeTrace(project, id);
    return c.json({ ok: true });
  });
  r.get("/api/org/:org/layout/:project", async (c) => {
    const project = c.req.param("project");
    return ID.test(project) ? c.json((await c.get("store").getLayout(project)) ?? null) : bad("Not a project");
  });
  r.put("/api/org/:org/layout/:project", async (c) => {
    const project = c.req.param("project");
    if (!ID.test(project)) return bad("Not a project");
    await c.get("store").putLayout(project, await c.req.json());
    return c.json({ ok: true });
  });

  // Images, by content hash (immutable).
  r.get("/api/org/:org/assets/:hash", (c) => {
    const hash = c.req.param("hash");
    const a = HASH.test(hash) ? c.get("store").getAsset(hash) : null;
    if (!a) return c.json({ error: "not_found" }, 404);
    const body = Readable.toWeb(createReadStream(a.file)) as ReadableStream<Uint8Array>;
    return new Response(body, { headers: { "content-type": a.type, "cache-control": "private, max-age=31536000, immutable" } });
  });
  r.put("/api/org/:org/assets/:hash", async (c) => {
    const hash = c.req.param("hash");
    if (!HASH.test(hash)) return bad("Not an image name");
    try {
      await c.get("store").putAsset(hash, new Uint8Array(await c.req.arrayBuffer()), c.req.header("content-type") ?? "application/octet-stream");
      return c.json({ ok: true });
    } catch (e) {
      return bad(e instanceof Error ? e.message : String(e));
    }
  });

  // Design systems and naming memory.
  r.get("/api/org/:org/systems", async (c) => c.json(await c.get("store").listSystems()));
  r.put("/api/org/:org/systems/:id", async (c) => {
    const s = (await c.req.json()) as { id: string; name?: string; source?: string };
    if (!s || s.id !== c.req.param("id") || !ID.test(s.id) || s.source === "builtin") return bad("Not a design system");
    await c.get("store").putSystem(s, { tab: tabOf(c.req.raw.headers) });
    return c.json({ ok: true });
  });
  r.delete("/api/org/:org/systems/:id", async (c) => {
    await c.get("store").removeSystem(c.req.param("id"), { tab: tabOf(c.req.raw.headers) });
    return c.json({ ok: true });
  });
  r.get("/api/org/:org/naming", async (c) => c.json(await c.get("store").getNaming()));
  r.put("/api/org/:org/naming", async (c) => {
    const list = await c.req.json();
    if (!Array.isArray(list)) return bad("Not a list");
    await c.get("store").putNaming(list, { tab: tabOf(c.req.raw.headers) });
    return c.json({ ok: true });
  });

  // What changed, as it changes (NDJSON: one event per line, a ping every 20 s).
  r.get("/api/org/:org/events", (c) => {
    const store = c.get("store");
    const enc = new TextEncoder();
    let stop = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        const send = (o: unknown) => {
          try {
            ctrl.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
          } catch {
            stop();
          }
        };
        const on = (e: OrgEvent) => send({ type: "event", ...e });
        const end = () => {
          stop();
          try {
            ctrl.close();
          } catch {
            // already closed
          }
        };
        store.events.on("event", on);
        // The store was replaced (the dev server reloaded its code): end, so the window reconnects.
        store.events.once("dispose", end);
        const ping = setInterval(() => send({ type: "ping" }), 20_000);
        stop = () => {
          store.events.off("event", on);
          store.events.off("dispose", end);
          clearInterval(ping);
        };
        c.req.raw.signal.addEventListener("abort", end);
        send({ type: "hello", org: store.info.id });
      },
      cancel: () => stop(),
    });
    return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
  });

  return r;
}

/** Run with the organization's index, or say why there's none here. */
async function withIndex(store: OrgStore, fn: (ix: OrgIndex) => Response | Promise<Response>): Promise<Response> {
  try {
    return await fn(indexFor(store));
  } catch (e) {
    if (e instanceof IndexUnavailable) return Response.json({ error: "index_unavailable", message: e.message }, { status: 503 });
    return failure(e);
  }
}

/**
 * What a page's lines cite, as the page shows them (a quote's source with the boards that use it,
 * to open it on one), and the cards on boards that rest on the same pieces. Without the index here
 * (Node without full-text search) the page shows its lines alone.
 */
async function topicContext(store: OrgStore, t: Topic) {
  try {
    const ix = indexFor(store);
    const refs = [...new Set(t.lines.flatMap((l) => [...l.cites, ...(l.disputes ?? []).flatMap((d) => d.cites)]))];
    const rows = ix.piecesByRef(refs);
    const cited = Object.fromEntries([...rows].map(([ref, row]) => [ref, publicPiece(row)]));
    const sources: Record<string, { title: string; boards: string[] }> = {};
    for (const id of new Set([...rows.values()].map((r) => r.source).filter((x): x is string => !!x))) {
      const s = await store.getSource(id);
      if (s) sources[id] = { title: s.title, boards: (s.boards ?? []).filter((b) => store.getProject(b)) };
    }
    const shows = showsUp(ix, t.title, refs).map((s) => ({ ...s, boardName: store.getProject(s.board)?.record.name ?? null }));
    return { cited, sources, shows };
  } catch {
    return { cited: {}, sources: {}, shows: [] };
  }
}

/** A long piece of work as NDJSON: what it's doing as it goes ("activity"), then its result, or why it failed. */
function streamed(request: AbortSignal, run: (emit: (label: string) => void, signal: AbortSignal) => Promise<unknown>): Response {
  const enc = new TextEncoder();
  const stop = new AbortController();
  request.addEventListener("abort", () => stop.abort());
  let open = true;
  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (o: unknown) => {
        if (open) ctrl.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
      };
      try {
        send({ type: "result", data: await run((label) => send({ type: "activity", label }), stop.signal) });
      } catch (e) {
        if (!stop.signal.aborted) send({ type: "error", error: "failed", message: e instanceof Error ? e.message : String(e) });
      }
      if (open) ctrl.close();
      open = false;
    },
    cancel() {
      open = false;
      stop.abort();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

const KINDS = new Set(Object.keys(SOURCE_KIND_LABEL));

/** Material a window read (src/discovery/ingest/core.ts Ingested), or null. */
function ingestedShape(raw: unknown): Ingested | null {
  const i = raw as Record<string, unknown> | null;
  if (!i || !KINDS.has(i.kind as string) || i.kind === "dump" || typeof i.title !== "string" || !i.title.trim() || typeof i.text !== "string" || !i.text.trim() || i.text.length > MAX_SOURCE_TEXT) return null;
  const pages = Array.isArray(i.pages) && i.pages.every((n) => typeof n === "number") ? (i.pages as number[]) : undefined;
  const talk = Array.isArray(i.segments) && i.transcript && typeof i.transcript === "object" ? { segments: i.segments as Ingested["segments"], transcript: i.transcript as Ingested["transcript"] } : {};
  return {
    kind: i.kind as Ingested["kind"],
    title: i.title.replace(/\s+/g, " ").trim().slice(0, 160),
    ...(typeof i.origin === "string" ? { origin: i.origin.slice(0, 2000) } : {}),
    text: i.text,
    ...(pages ? { pages } : {}),
    ...(i.truncated === true ? { truncated: true } : {}),
    ...talk,
  };
}

const isCardRef = (v: unknown): v is string => typeof v === "string" && /^hub:card:[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,64}$/.test(v);

/** "org": the whole organization; a product's id; nothing: no product in hand. */
const productParam = (v: string | undefined) => (v === "org" ? null : v && ID.test(v) ? v : undefined);

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== "" && v !== null && v !== undefined ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** A piece as the API shows it. */
function publicPiece(p: PieceRow | Hit) {
  const { id: _id, key: _key, hash: _hash, topics: _topics, ...rest } = p;
  return { ...rest, topics: topicsOf(p) };
}

const isContext = (c: unknown): c is ContextFields => {
  const x = c as ContextFields;
  return !!x && typeof x.audience === "string" && typeof x.context === "string" && Array.isArray(x.goals) && x.goals.every((g) => typeof g === "string") && Array.isArray(x.segments) && x.segments.every((g) => typeof g === "string");
};
