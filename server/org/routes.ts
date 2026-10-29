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
import { needsNow } from "./needs";
import { needSummary } from "@/hub/needs";
import { quickCapture } from "../quick";
import { reviewOrg } from "./review";
import { askOrg } from "../ask";
import { captureSource, fileSources } from "../capture";
import type { Ingested } from "@/discovery/ingest/core";
import type { Proposal } from "@/discovery/proposals";
import { MAX_SOURCE_TEXT, SOURCE_KIND_LABEL, type SourceRecord } from "@/discovery/sources";
import { aiConfigured, rateLimited } from "@/ai/server";
import { foldBearings } from "@/goals/bearings";
import { isStepRef, pinShape } from "@/code/steps";
import { goalPatchShape, newGoalShape } from "@/goals/shape";
import { goalById } from "@/goals/tree";
import type { Hit as ConnectorHit } from "@/connectors/recipes";
import { findProblems, goalPage, linkByHand } from "./goals";
import { pictureFromFigma, pinByHand, placeQuotes } from "./steps";
import { changeJob, noteForJob, openJobs, planJobs, searchForJob, takeInForJob } from "./jobs";
import { breakDown, decidePart, lookOutside } from "./outside";
import { addRepo, answerFromCode, codeView, readRepo, removeRepo, type NewRepo } from "../code";
import { GOAL_LEVERS, type GoalLever } from "@/goals/types";
import { ConflictError, GoalCycleError, GoalInUseError, NotFoundError, type OrgEvent, type OrgStore } from "./store";

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
  if (e instanceof GoalInUseError) return Response.json({ error: "in_use", message: e.message, boards: e.boards }, { status: 409 });
  if (e instanceof GoalCycleError) return Response.json({ error: "bad_request", message: e.message }, { status: 400 });
  return Response.json({ error: "failed", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
}

const bad = (message: string) => Response.json({ error: "bad_request", message }, { status: 400 });

export function orgRoutes(): Hono<Env> {
  const r = new Hono<Env>();

  // Organizations: which there are, the one a new window opens, making and opening them.
  r.get("/api/orgs", async (c) => {
    const current = await currentOrg();
    const orgs = await listOrgs();
    // None yet (the first run): the window welcomes them instead.
    return c.json({ home: qalamHome(), current: current?.id ?? null, orgs: orgs.map(({ id, name, dir }) => ({ id, name, dir })) });
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
  // The goals: one tree, the North Star on top (goals.md), and which are this computer's person's.
  r.get("/api/org/:org/goals", async (c) => {
    const store = c.get("store");
    const g = await store.getGoals();
    return c.json({ ...g, mine: store.mine }, 200, { etag: etag(g.version) });
  });
  r.post("/api/org/:org/goals", async (c) => {
    const g = newGoalShape(await c.req.json().catch(() => null));
    if (!g) return bad("Not a goal");
    try {
      const { by: _b, ...input } = g;
      const r = await c.get("store").createGoal({ ...input, by: g.by ?? "person" }, { tab: tabOf(c.req.raw.headers) });
      return c.json(r);
    } catch (e) {
      return failure(e);
    }
  });
  r.patch("/api/org/:org/goals/:id", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { patch?: unknown; by?: unknown } | null;
    const patch = goalPatchShape(body?.patch);
    if (!patch || !ID.test(c.req.param("id"))) return bad("Not a change to a goal");
    try {
      return c.json(await c.get("store").patchGoal(c.req.param("id"), patch, { ifMatch: ifMatch(c.req.raw.headers), by: body?.by === "qalam" ? "qalam" : "you", tab: tabOf(c.req.raw.headers) }));
    } catch (e) {
      return failure(e);
    }
  });
  r.delete("/api/org/:org/goals/:id", async (c) => {
    try {
      return c.json(await c.get("store").removeGoal(c.req.param("id"), { tab: tabOf(c.req.raw.headers) }));
    } catch (e) {
      return failure(e);
    }
  });
  // A goal's page, and the problems behind it (server/org/goals.ts).
  r.get("/api/org/:org/goals/:id/page", async (c) => {
    const page = await goalPage(c.get("store"), c.req.param("id"));
    return page ? c.json(page) : c.json({ error: "not_found", message: "No such goal" }, 404);
  });
  r.post("/api/org/:org/goals/:id/problems", async (c) => {
    if (!aiConfigured()) return c.json({ error: "not_configured", message: "Qalam AI isn't set up here, so it can't link problems to goals." }, 503);
    const store = c.get("store");
    const id = c.req.param("id");
    if (!goalById(await store.getGoals(), id)) return c.json({ error: "not_found", message: "No such goal" }, 404);
    return streamed(c.req.raw.signal, (emit) => findProblems(store, id, emit));
  });
  r.get("/api/org/:org/bearings", async (c) => c.json(foldBearings(await c.get("store").listBearingLog()).links));
  r.post("/api/org/:org/bearings", async (c) => {
    const b = (await c.req.json().catch(() => null)) as { need?: unknown; goal?: unknown; on?: unknown; how?: unknown; bears?: unknown } | null;
    if (!b || typeof b.need !== "string" || !ID.test(b.need) || typeof b.goal !== "string" || !ID.test(b.goal) || typeof b.on !== "boolean") return bad("Name a problem, a goal, and whether they're linked");
    await linkByHand(c.get("store"), { need: b.need, goal: b.goal, on: b.on, how: typeof b.how === "string" ? b.how : undefined, bears: b.bears === "some" ? "some" : "direct" }, { tab: tabOf(c.req.raw.headers) });
    return c.json({ ok: true });
  });
  // What sits at the steps of a goal's funnel (server/org/steps.ts): Qalam AI places quotes, people pin and unpin.
  r.post("/api/org/:org/goals/:id/steps", async (c) => {
    if (!aiConfigured()) return c.json({ error: "not_configured", message: "Qalam AI isn't set up here, so it can't place quotes at steps." }, 503);
    const store = c.get("store");
    const id = c.req.param("id");
    if (!goalById(await store.getGoals(), id)) return c.json({ error: "not_found", message: "No such goal" }, 404);
    return streamed(c.req.raw.signal, (emit) => placeQuotes(store, id, emit));
  });
  r.post("/api/org/:org/steps", async (c) => {
    const b = (await c.req.json().catch(() => null)) as { step?: unknown; what?: unknown; id?: unknown; on?: unknown } | null;
    const pin = b && typeof b.on === "boolean" ? pinShape({ step: b.step, what: b.what, id: b.id, by: "you", at: Date.now() }) : null;
    if (!pin || !b) return bad("Name a step, what's pinned there, and whether it is");
    try {
      await pinByHand(c.get("store"), { step: pin.step, what: pin.what, id: pin.id, on: b.on as boolean }, { tab: tabOf(c.req.raw.headers) });
      return c.json({ ok: true });
    } catch (e) {
      return failure(e);
    }
  });
  r.post("/api/org/:org/steps/figma", async (c) => {
    const b = (await c.req.json().catch(() => null)) as { step?: unknown; url?: unknown } | null;
    if (!b || !isStepRef(b.step) || typeof b.url !== "string" || b.url.length > 2000) return bad("Name a step and a Figma frame's link");
    const store = c.get("store");
    const step = b.step;
    const url = b.url;
    return streamed(c.req.raw.signal, (emit, signal) => pictureFromFigma(store, step, url, emit, signal, { tab: tabOf(c.req.raw.headers) }));
  });
  // The product's code, read-only (server/code): the repositories this computer reads, and what each product does today.
  const KEY = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,139}$/;
  r.get("/api/org/:org/code", async (c) => c.json(await codeView(c.get("store"))));
  r.post("/api/org/:org/code", async (c) => {
    if (!aiConfigured()) return c.json({ error: "not_configured", message: "Qalam AI isn't set up here, so it can't read the code." }, 503);
    const b = ((await c.req.json().catch(() => null)) ?? {}) as { kind?: unknown; repo?: unknown; path?: unknown; product?: unknown };
    const product = typeof b.product === "string" && ID.test(b.product) ? b.product : null;
    const input: NewRepo | null = b.kind === "github" && typeof b.repo === "string" ? { kind: "github", repo: b.repo.slice(0, 220), product } : b.kind === "folder" && typeof b.path === "string" ? { kind: "folder", path: b.path.slice(0, 2000), product } : null;
    if (!input) return bad("Name a repository or a folder");
    const store = c.get("store");
    return streamed(c.req.raw.signal, async (emit, signal) => {
      const repo = await addRepo(store, input);
      return { repo, ...(await readRepo(store, repo.key, emit, signal)) };
    });
  });
  r.post("/api/org/:org/code/:key/read", async (c) => {
    if (!aiConfigured()) return c.json({ error: "not_configured", message: "Qalam AI isn't set up here, so it can't read the code." }, 503);
    if (!KEY.test(c.req.param("key"))) return bad("No such repository");
    const store = c.get("store");
    return streamed(c.req.raw.signal, (emit, signal) => readRepo(store, c.req.param("key"), emit, signal));
  });
  r.delete("/api/org/:org/code/:key", async (c) => {
    if (!KEY.test(c.req.param("key"))) return bad("No such repository");
    try {
      await removeRepo(c.get("store"), c.req.param("key"));
      return c.json({ ok: true });
    } catch (e) {
      return failure(e);
    }
  });
  r.post("/api/org/:org/jobs/:id/code", async (c) => {
    if (!aiConfigured()) return c.json({ error: "not_configured", message: "Qalam AI isn't set up here, so it can't read the code." }, 503);
    const store = c.get("store");
    return streamed(c.req.raw.signal, (emit, signal) => answerFromCode(store, c.req.param("id"), emit, signal));
  });
  // A goal's funnel counted in PostHog: a saved funnel insight's steps, as code read them from PostHog's answer.
  r.put("/api/org/:org/goals/:id/funnel", async (c) => {
    const b = ((await c.req.json().catch(() => null)) ?? {}) as { insight?: { ref?: unknown; name?: unknown; url?: unknown }; steps?: unknown };
    const steps = (Array.isArray(b.steps) ? b.steps : []).flatMap((s: { label?: unknown; count?: unknown }) => (typeof s?.label === "string" && typeof s.count === "number" && Number.isFinite(s.count) && s.count >= 0 ? [{ label: s.label.slice(0, 120), count: Math.round(s.count) }] : [])).slice(0, 20);
    const ref = typeof b.insight?.ref === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(b.insight.ref) ? b.insight.ref : null;
    if (!ref || steps.length < 2 || !ID.test(c.req.param("id"))) return bad("A funnel's steps, from a saved insight");
    const url = typeof b.insight?.url === "string" && /^https:\/\//.test(b.insight.url) ? b.insight.url.slice(0, 500) : undefined;
    const store = c.get("store");
    if (!goalById(await store.getGoals(), c.req.param("id"))) return c.json({ error: "not_found", message: "No such goal" }, 404);
    await store.changeGoalWork(c.req.param("id"), (w) => ({ ...w, funnel: { at: Date.now(), insight: { ref, name: typeof b.insight?.name === "string" ? b.insight.name.slice(0, 160) : ref, ...(url ? { url } : {}) }, steps } }), { tab: tabOf(c.req.raw.headers) });
    return c.json({ ok: true });
  });
  // What others aim for, and breaking a goal down (server/org/outside.ts).
  r.post("/api/org/:org/goals/:id/outside", async (c) => {
    if (!aiConfigured()) return c.json({ error: "not_configured", message: "Qalam AI isn't set up here, so it can't look this up." }, 503);
    if (rateLimited(c.req.raw)) return c.json({ error: "rate_limited", message: "Too many requests, try again in a few minutes." }, 429);
    const store = c.get("store");
    const id = c.req.param("id");
    if (!goalById(await store.getGoals(), id)) return c.json({ error: "not_found", message: "No such goal" }, 404);
    return streamed(c.req.raw.signal, (emit, signal) => lookOutside(store, id, emit, signal));
  });
  r.post("/api/org/:org/goals/:id/breakdown", async (c) => {
    if (!aiConfigured()) return c.json({ error: "not_configured", message: "Qalam AI isn't set up here, so it can't break the goal down." }, 503);
    if (rateLimited(c.req.raw)) return c.json({ error: "rate_limited", message: "Too many requests, try again in a few minutes." }, 429);
    const { levers } = ((await c.req.json().catch(() => ({}))) ?? {}) as { levers?: unknown };
    const picked = (Array.isArray(levers) ? levers : []).filter((l): l is GoalLever => GOAL_LEVERS.includes(l as GoalLever));
    const store = c.get("store");
    const id = c.req.param("id");
    if (!goalById(await store.getGoals(), id)) return c.json({ error: "not_found", message: "No such goal" }, 404);
    return streamed(c.req.raw.signal, (emit) => breakDown(store, id, { levers: [...new Set(picked)] }, emit));
  });
  r.post("/api/org/:org/goals/:id/breakdown/:part", async (c) => {
    const { accept } = ((await c.req.json().catch(() => ({}))) ?? {}) as { accept?: unknown };
    if (typeof accept !== "boolean" || !ID.test(c.req.param("part"))) return bad("Accept it or discard it");
    try {
      return c.json(await decidePart(c.get("store"), c.req.param("id"), c.req.param("part"), accept, { tab: tabOf(c.req.raw.headers) }));
    } catch (e) {
      return failure(e);
    }
  });
  // Jobs for a goal (server/org/jobs.ts): planned by Qalam AI from what isn't known yet, run here or handed over.
  r.get("/api/org/:org/jobs", async (c) => c.json(await openJobs(c.get("store"))));
  r.post("/api/org/:org/goals/:id/jobs", async (c) => {
    if (!aiConfigured()) return c.json({ error: "not_configured", message: "Qalam AI isn't set up here, so it can't plan jobs." }, 503);
    const store = c.get("store");
    const id = c.req.param("id");
    if (!goalById(await store.getGoals(), id)) return c.json({ error: "not_found", message: "No such goal" }, 404);
    return streamed(c.req.raw.signal, (emit) => planJobs(store, id, emit));
  });
  r.patch("/api/org/:org/jobs/:id", async (c) => {
    const b = (await c.req.json().catch(() => null)) as { status?: unknown; outcome?: unknown } | null;
    const status = b?.status === "todo" || b?.status === "done" || b?.status === "dropped" ? b.status : undefined;
    const outcome = typeof b?.outcome === "string" ? b.outcome.replace(/\s+/g, " ").trim().slice(0, 240) : undefined;
    if (!ID.test(c.req.param("id")) || (!status && outcome === undefined)) return bad("Not a change to a job");
    try {
      await changeJob(c.get("store"), c.req.param("id"), { ...(status ? { status } : {}), ...(outcome !== undefined ? { outcome } : {}) }, { tab: tabOf(c.req.raw.headers) });
      return c.json({ ok: true });
    } catch (e) {
      return failure(e);
    }
  });
  r.post("/api/org/:org/jobs/:id/search", async (c) => {
    const { query } = ((await c.req.json().catch(() => ({}))) ?? {}) as { query?: unknown };
    try {
      return c.json({ hits: await searchForJob(c.get("store"), c.req.param("id"), typeof query === "string" ? query : undefined) });
    } catch (e) {
      return e instanceof NotFoundError ? failure(e) : c.json({ error: "search_failed", message: e instanceof Error ? e.message : String(e) }, 400);
    }
  });
  r.post("/api/org/:org/jobs/:id/take", async (c) => {
    if (!aiConfigured()) return c.json({ error: "no_key", message: "Qalam AI isn't set up here." }, 501);
    const { hits } = ((await c.req.json().catch(() => ({}))) ?? {}) as { hits?: unknown };
    const picked = (Array.isArray(hits) ? hits : []).filter((h): h is ConnectorHit => !!h && typeof h.id === "string" && typeof h.title === "string").slice(0, 20);
    if (!picked.length) return bad("Pick something to bring in");
    const store = c.get("store");
    // Taken in to the end even if the window goes: each item is kept, read, filed and placed.
    return streamed(c.req.raw.signal, (emit) => takeInForJob(store, c.req.param("id"), picked, emit));
  });
  r.put("/api/org/:org/goals-north", async (c) => {
    const { id } = ((await c.req.json().catch(() => ({}))) ?? {}) as { id?: unknown };
    if (id !== null && (typeof id !== "string" || !ID.test(id))) return bad("Name a goal");
    try {
      return c.json(await c.get("store").setNorth(id, { tab: tabOf(c.req.raw.headers) }));
    } catch (e) {
      return failure(e);
    }
  });
  r.put("/api/org/:org/goals-mine", async (c) => {
    const { ids } = ((await c.req.json().catch(() => ({}))) ?? {}) as { ids?: unknown };
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string" && ID.test(x))) return bad("Name goals");
    await c.get("store").setMine(ids as string[]);
    return c.json({ mine: c.get("store").mine });
  });

  // Decisions: the log, newest first (a board's, a card's or a goal's), added to as boards change.
  r.get("/api/org/:org/decisions", (c) => {
    const { board, card, goal, limit } = c.req.query();
    const n = Number(limit);
    return c.json(c.get("store").listDecisions({ board: board || undefined, card: card || undefined, goal: goal || undefined, limit: n > 0 ? Math.min(n, 1000) : undefined }));
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
  /** Every need page, the best-backed first: what to work on next (src/hub/needs.ts). */
  r.get("/api/org/:org/needs", async (c) => c.json(await needsNow(c.get("store"))));
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
    const b = (await c.req.json().catch(() => null)) as { ingested?: unknown; product?: unknown; job?: unknown } | null;
    const ing = ingestedShape(b?.ingested);
    if (!ing) return bad("Not something to add");
    const product = typeof b?.product === "string" && ID.test(b.product) ? b.product : null;
    // Notes from a job that was handed over: kept on the job, and linked to the goals at once.
    const job = typeof b?.job === "string" && ID.test(b.job) ? b.job : null;
    const store = c.get("store");
    return streamed(c.req.raw.signal, async (emit, signal) => {
      const r = await captureSource(store, ing, { product, emit, signal });
      return job ? { ...r, linked: await noteForJob(store, job, r, emit) } : r;
    });
  });
  /** Quick capture (the menu bar, the capture page): into the inbox folder, which takes it from there. */
  r.post("/api/org/:org/quick", async (c) => {
    const b = (await c.req.json().catch(() => null)) as { kind?: unknown; text?: unknown; url?: unknown; speaker?: unknown } | null;
    const kind = b?.kind === "quote" || b?.kind === "link" ? b.kind : "note";
    const text = typeof b?.text === "string" ? b.text.slice(0, 20_000) : "";
    const url = typeof b?.url === "string" && /^https?:\/\//i.test(b.url.trim()) ? b.url.trim().slice(0, 2048) : undefined;
    if (!text.trim() && !url) return bad("Write something, or paste a link");
    const speaker = typeof b?.speaker === "string" ? b.speaker.slice(0, 80) : undefined;
    return c.json(await quickCapture(c.get("store"), { kind, text, ...(url ? { url } : {}), ...(speaker ? { speaker } : {}) }), 202);
  });
  /** File sources into the topic pages, here in the core: it answers at once, and the filing carries on whatever the window does next. */
  r.post("/api/org/:org/file", async (c) => {
    if (!aiConfigured()) return c.json({ error: "no_key", message: "Qalam AI isn't set up here." }, 501);
    if (rateLimited(c.req.raw)) return c.json({ error: "rate_limited", message: "Too many requests, try again in a few minutes." }, 429);
    const b = (await c.req.json().catch(() => null)) as { sources?: unknown; product?: unknown } | null;
    const ids = (Array.isArray(b?.sources) ? b.sources : []).filter((x): x is string => typeof x === "string" && ID.test(x)).slice(0, 20);
    if (!ids.length) return bad("Say which sources");
    const product = typeof b?.product === "string" && ID.test(b.product) ? b.product : null;
    void fileSources(c.get("store"), ids, product).catch((e) => console.warn(`[qalam] filing into the topic pages didn't finish: ${e instanceof Error ? e.message : String(e)}`));
    return c.json({ started: true }, 202);
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
    // A need's strip: how strong it is, who raises it, how it's grown, which boards have it.
    const facts = new Map([...rows].map(([ref, row]) => [ref, { type: row.type, sub: row.sub, source: row.source, stage: row.stage, at: row.at }]));
    const summary = t.kind === "need" ? needSummary(t, { now: Date.now(), topics: await store.listTopics(), pieces: facts, shows: new Map([[t.id, shows]]) }) : null;
    return { cited, sources, shows, summary };
  } catch {
    return { cited: {}, sources: {}, shows: [], summary: null };
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

/** A context as a window sends it. Goals sent with it (a window from before goals.md) go into the goal tree. */
const isContext = (c: unknown): c is ContextFields & { goals?: string[] } => {
  const x = c as ContextFields & { goals?: unknown };
  const goals = x?.goals === undefined || (Array.isArray(x.goals) && x.goals.every((g) => typeof g === "string"));
  return !!x && typeof x.audience === "string" && typeof x.context === "string" && goals && Array.isArray(x.segments) && x.segments.every((g) => typeof g === "string");
};
