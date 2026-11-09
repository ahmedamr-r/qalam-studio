import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { setEngineState } from "@/ai/engine";
import { structured } from "@/ai/server";
import { findClaude } from "../../server/claude";
import { loadEnvFiles } from "../../server/env";
import { planLimits } from "../../server/limits";
import { realDeps, type MarketDeps } from "../../server/org/market";
import { namesSomething } from "../../server/org/scan";
import { OrgStore } from "../../server/org/store";
import { runBaseline, type BaselineRun } from "./baseline";
import { consultFlow, planFlow, scanFlow, type PlanRun, type ScanRun } from "./bench";
import { lint, paperWalk } from "./lint";
import { baselineCosts, blindEngineer, challenging, consulting, contamination, costs, prdFields, questioning, reasks, searching, trapHits, type CheckedRun } from "./measures";
import { PERSONAS, personaById } from "./personas";
import { makePlayer, type Player } from "./player";
import { neutral, renderBaseline, renderPlan, renderScan, renderTab } from "./render";
import { seedOrg, seedText } from "./seed";
import { CANNED } from "./stage1";
import { Tab, tabDocs, tabFind, tabFocus, tabPlan, type TabResult } from "./tab";
import { newTap, tapped, type Tap } from "./tap";
import type { Persona } from "./types";

/**
 * pnpm eval:personas: can Qalam serve these people, beside a strong plain agent (see eval/personas/types.ts).
 * It spends real tokens on Claude Code, so it only prints its plan unless asked.
 *
 *   pnpm eval:personas                        the plan, no model calls
 *   pnpm eval:personas --stage 0              lint, the paper walk, a stubbed run: no model calls
 *   pnpm eval:personas --stage 1 --yes        the player alone: does it over-inform?
 *   pnpm eval:personas --stage 2 --yes        the first round of questions, both sides
 *   pnpm eval:personas --stage 3 --yes --only b2,c1   whole runs, both sides
 *   pnpm eval:personas --stage check --yes --only a1  the in-process road held to the real app's
 *   pnpm eval:personas --stage measure --from <run>   the re-ask measures on saved runs: no model calls
 *
 * --flip <fact> re-proposes with one answer turned around. --plan-too also runs a scan persona through
 * the chat's plan route. --models keeps search by meaning on (the control). The plain agent asks for as
 * long as it needs, as Qalam does; --baseline-rounds 3 holds it to the rounds it was frozen with.
 */

const ROOT = path.resolve("eval/personas");
const OUT = path.resolve(".qalam-dev/stress");
/** Stop before a plan window runs out: past this, a person's other work would stall. */
const LIMIT = 85;

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

async function storeFor(dir: string, p: Persona) {
  const store = await OrgStore.create(dir, { id: p.id, name: p.org.name, createdAt: Date.now(), shape: p.org.shape === "solo" ? "solo" : "team" } as never);
  if (p.org.about || p.org.audience) await store.putAbout({ context: p.org.about ?? "", audience: p.org.audience ?? "", segments: [] });
  await seedOrg(store, p);
  return store;
}

/** A plan's limits, read with no model call. A number past the mark, or a stop, ends the run. */
async function guard(): Promise<string | null> {
  const l = await planLimits(true).catch(() => null);
  if (!l) return null;
  if (l.reached) return `The plan stopped calls: ${l.reached.why}`;
  const over = l.rows.find((r) => r.percent >= LIMIT);
  return over ? `${over.label} is at ${over.percent}% of the plan: stopping before it runs out.` : null;
}

const tapPlayerDeps = (t: Tap) => ({
  structured: async <T,>(call: any, signal?: AbortSignal) => {
    const was = t.arm;
    t.arm = "player";
    try {
      return await structured<T>(call, signal);
    } finally {
      t.arm = was;
    }
  },
});

const measureDeps = (t: Tap) => async <T,>(call: any, signal?: AbortSignal) => {
  const was = t.arm;
  t.arm = "measure";
  try {
    return await structured<T>(call, signal);
  } finally {
    t.arm = was;
  }
};

interface Options {
  firstRoundOnly: boolean;
  flip?: string;
  planToo: boolean;
  noBaseline: boolean;
  budget?: number;
  /** Another coin for Enter and skip: a close result gets a second run. */
  rep: number;
  /** A first-run person, by the chat's plan route alone. */
  planOnly: boolean;
  /** Hold the plain agent to this many rounds of 3 questions, as it was frozen; none: as long as it needs. */
  baselineRounds?: number;
}

/** One side, on the road a person takes. A path the window drives goes by its plan route here; those run whole in the real app. */
async function runQalam(p: Persona, dir: string, t: Tap, o: Options, ctrl: AbortController, route: Route) {
  const flip = o.flip ? p.flips.find((x) => x.fact === o.flip) : undefined;
  const player = makePlayer(p, tapPlayerDeps(t), { rep: o.rep, ...(flip ? { flip } : {}) });
  const store = await storeFor(dir, p);
  try {
    // As the first run does (src/ui/start/flow.ts): with nothing named to read about, it's worked out in the chat.
    if (route === "consult") return { run: (await consultFlow(store, p, player, t, ctrl.signal, { firstRoundOnly: o.firstRoundOnly })) as PlanRun | ScanRun, player };
    const reads = route === "scan" && (await namesSomething(p.opener, ctrl.signal, tapped(realDeps, t)));
    const run: PlanRun | ScanRun = reads ? await scanFlow(store, p, player, t, ctrl.signal, { firstRoundOnly: o.firstRoundOnly }) : await planFlow(store, p, player, t, ctrl.signal, { firstRoundOnly: o.firstRoundOnly });
    return { run, player };
  } finally {
    store.dispose();
  }
}

/** Which road a side takes: plan mode, the first run's scan, or the consultant. */
type Route = "plan" | "scan" | "consult";

async function oneSide(p: Persona, out: string, route: Route, o: Options, ctrl: AbortController) {
  const t = newTap();
  const began = Date.now();
  const dir = path.join(out, `home-${route}`);
  await mkdir(dir, { recursive: true });
  const { run, player } = await runQalam(p, dir, t, o, ctrl, route);
  const text = o.firstRoundOnly ? "" : neutral(run.path === "scan" ? renderScan(run) : renderPlan(run));
  const measure = measureDeps(t);
  const prd = o.firstRoundOnly ? null : await prdFields(text, measure, ctrl.signal).catch((e: unknown) => ({ error: String(e) }));
  const engineer = o.firstRoundOnly ? null : await blindEngineer(text, measure, ctrl.signal).catch((e: unknown) => ({ error: String(e) }));
  const summary = {
    side: `qalam-${route}`,
    seconds: Math.round((Date.now() - began) / 1000),
    voided: t.failed.length ? `A call failed and fell back: ${t.failed.map((f) => f.kind).join(", ")}` : null,
    route: run.path === "plan" ? { ...run.route, ...(route === "scan" ? { firstRunSentToChat: true } : {}) } : { job: "first run" },
    costs: costs(t),
    /** How the interview ended, then the brief's. */
    ended: run.ended ?? null,
    briefEnded: run.briefAsk?.ended ?? null,
    questioning: questioning(p, player),
    reasks: reasks(p, player),
    contamination: contamination(player, run),
    searching: searching(t, run),
    traps: text ? trapHits(p, text) : [],
    // How the consultant went, where it was the road (src/consult/).
    consulting: run.path === "plan" ? consulting(p, run) : null,
    // What their own evidence said against what was proposed, before they saw it (src/challenge/).
    challenges: run.path === "plan" ? challenging(p, run.checks ?? [], (run.draft?.cards ?? []).map((c) => ({ id: c.ref, kind: c.kind, title: c.title, description: c.description, parent: c.under && "ref" in c.under ? c.under.ref : null }))) : null,
    prd,
    engineer,
  };
  await writeFile(path.join(out, `qalam-${route}.json`), JSON.stringify({ summary, run, ledger: player.ledger, tap: { searches: t.searches, pages: t.pages, failed: t.failed, steps: t.steps } }, null, 2));
  if (text) await writeFile(path.join(out, `qalam-${route}.md`), text);
  return summary;
}

/** What a home's usage log adds up to: a server in its own process reports there. */
async function homeUsage(home: string) {
  const dir = path.join(home, ".qalam", "usage");
  const files = await readdir(dir).catch(() => [] as string[]);
  const text = (await Promise.all(files.map((f) => readFile(path.join(dir, f), "utf8").catch(() => "")))).join("\n");
  const lines = text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null });
  return { calls: lines.length, tokens: lines.reduce((n, e) => n + e.input + e.output + e.cacheRead + e.cacheWrite, 0), fresh: lines.reduce((n, e) => n + e.input + e.output + e.cacheWrite, 0), cost: +lines.reduce((n, e) => n + (e.cost ?? 0), 0).toFixed(3) };
}

/** The checks of what was proposed that the app kept (chats/challenges/), oldest first. */
async function homeChecks(org: string): Promise<CheckedRun[]> {
  const dir = path.join(org, "chats", "challenges");
  const files = await readdir(dir).catch(() => [] as string[]);
  const runs = await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => readFile(path.join(dir, f), "utf8").then((x) => JSON.parse(x) as CheckedRun, () => null)));
  return runs.filter((r): r is CheckedRun => !!r).sort((a, b) => a.at - b.at);
}

let nextPort = 3190 + Math.floor(Math.random() * 40);

/** The real app: a flow whose logic lives in the window. */
async function tabSide(p: Persona, out: string, o: Options) {
  const t = newTap();
  const flip = o.flip ? p.flips.find((x) => x.fact === o.flip) : undefined;
  const player = makePlayer(p, tapPlayerDeps(t), { rep: o.rep, ...(flip ? { flip } : {}) });
  const home = path.join(out, "home-tab");
  const tab = new Tab(p, player, home, nextPort++, process.cwd());
  const began = Date.now();
  await tab.prepare();
  let result: TabResult;
  try {
    await tab.start();
    result = p.path === "focus" ? await tabFocus(tab, p, out) : p.path === "find" ? await tabFind(tab, out) : p.path === "docs" ? await tabDocs(tab, p, path.join(ROOT, "fixtures"), out) : await tabPlan(tab, p.planSaid ?? p.opener, out);
  } finally {
    await tab.stop();
  }
  const text = neutral(renderTab(result));
  const measure = measureDeps(t);
  const prd = await prdFields(text, measure).catch((e: unknown) => ({ error: String(e) }));
  const engineer = await blindEngineer(text, measure).catch((e: unknown) => ({ error: String(e) }));
  const usage = await homeUsage(home);
  const checks = await homeChecks(path.join(home, p.org.name));
  const summary = { side: `qalam-${p.path}`, seconds: Math.round((Date.now() - began) / 1000), usage, playerTokens: costs(t).player, deadEnds: result.deadEnds, forced: result.forced, windowErrors: result.errors.slice(0, 8), questioning: questioning(p, player), reasks: reasks(p, player), contamination: contamination(player, null), traps: trapHits(p, text), challenges: challenging(p, checks, result.cards), prd, engineer };
  await writeFile(path.join(out, "qalam-tab.json"), JSON.stringify({ summary, result, ledger: player.ledger }, null, 2));
  await writeFile(path.join(out, "qalam-tab.md"), text);
  return summary;
}

async function baselineSide(p: Persona, out: string, o: Options, ctrl: AbortController, budget: number) {
  const t = newTap();
  const flip = o.flip ? p.flips.find((x) => x.fact === o.flip) : undefined;
  const player = makePlayer(p, tapPlayerDeps(t), { rep: o.rep, ...(flip ? { flip } : {}) });
  const seeded = seedText(p);
  let folder = p.docs?.length ? path.join(ROOT, "fixtures") : undefined;
  let files = p.docs;
  if (seeded) {
    // What the other side has on its canvas, as a file: both start from the same material.
    folder = path.join(out, "material");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "problems.md"), seeded);
    files = ["problems.md"];
  }
  const go = (who: typeof player) => runBaseline(p, who, { budgetUsd: budget, signal: ctrl.signal, firstRoundOnly: o.firstRoundOnly, ...(o.baselineRounds ? { rounds: o.baselineRounds } : {}), ...(folder ? { folder } : {}), ...(files?.length ? { files } : {}), ...(process.env.CLAUDE_CLI_PATH ? { bin: process.env.CLAUDE_CLI_PATH } : {}) });
  let run: BaselineRun = await go(player);
  // A dropped connection says nothing about the agent: once more, from the start.
  if (run.ended === "error" && /ECONNRESET|Connection dropped|overloaded|socket/i.test(`${run.error} ${JSON.stringify(run.turns.at(-1))}`)) {
    console.log(`    baseline dropped (${run.error}); once more`);
    player.ledger.length = 0;
    player.released.clear();
    run = await go(player);
  }
  const text = o.firstRoundOnly ? "" : neutral(renderBaseline(run));
  const measure = measureDeps(t);
  const prd = o.firstRoundOnly ? null : await prdFields(text, measure, ctrl.signal).catch((e: unknown) => ({ error: String(e) }));
  const engineer = o.firstRoundOnly ? null : await blindEngineer(text, measure, ctrl.signal).catch((e: unknown) => ({ error: String(e) }));
  const summary = { side: "baseline", ...baselineCosts(run), error: run.error ?? null, playerTokens: costs(t).player, questioning: questioning(p, player), reasks: reasks(p, player), traps: text ? trapHits(p, text) : [], prd, engineer };
  await writeFile(path.join(out, "baseline.json"), JSON.stringify({ summary, run, ledger: player.ledger }, null, 2));
  if (text) await writeFile(path.join(out, "baseline.md"), text);
  return summary;
}

async function runPersona(p: Persona, root: string, o: Options, ctrl: AbortController) {
  const out = path.join(root, p.id + (o.flip ? `-flip-${o.flip}` : "") + (o.rep ? `-rep${o.rep}` : ""));
  await mkdir(out, { recursive: true });
  const sides: unknown[] = [];
  let spent = 0;
  const inWindow = !o.firstRoundOnly && (p.path === "focus" || p.path === "docs" || p.path === "find");
  const routes: Route[] = inWindow ? [] : p.path === "consult" ? ["consult"] : p.path === "scan" ? (o.planOnly ? ["plan"] : o.planToo ? ["scan", "plan"] : ["scan"]) : ["plan"];
  if (inWindow) {
    console.log(`  ${p.id}: Qalam, in the real app (${p.path})…`);
    const s = await tabSide(p, out, o);
    spent = s.usage.cost;
    sides.push(s);
    console.log(`    ${s.seconds}s · ${s.usage.tokens} tokens · $${s.usage.cost} · asked ${s.questioning.asked}, learned ${s.questioning.learned}/${s.questioning.mustLearn}${s.deadEnds.length ? ` · ${s.deadEnds.length} dead ends` : ""}`);
  }
  for (const r of routes) {
    console.log(`  ${p.id}: Qalam, ${r} route…`);
    const s = await oneSide(p, out, r, o, ctrl);
    spent = Math.max(spent, s.costs.qalam.cost);
    sides.push(s);
    console.log(`    ${s.seconds}s · ${s.costs.qalam.tokens} tokens · $${s.costs.qalam.cost} · asked ${s.questioning.asked}, learned ${s.questioning.learned}/${s.questioning.mustLearn}${s.voided ? ` · VOID: ${s.voided}` : ""}`);
  }
  if (!o.noBaseline) {
    console.log(`  ${p.id}: baseline…`);
    // Held to what the other side spent, with room for its own conversation.
    const budget = o.budget ?? Math.max(1.5, spent * 1.25);
    const s = await baselineSide(p, out, o, ctrl, budget);
    sides.push(s);
    console.log(`    ${s.seconds}s · ${s.tokens} tokens · $${s.cost} · ${s.searches} searches, ${s.fetches} fetches · asked ${s.questioning.asked}, learned ${s.questioning.learned}/${s.questioning.mustLearn} · ${s.ended}`);
  }
  await writeFile(path.join(out, "summary.json"), JSON.stringify(sides, null, 2));
  return sides;
}

/** The shape of a value: which keys, of which types. Words differ from run to run; the shape must not. */
function shapeOf(v: unknown): unknown {
  if (Array.isArray(v)) {
    // Every element's keys: an optional field on only one of them still counts.
    const parts = v.map(shapeOf);
    if (parts.every((p) => p && typeof p === "object" && !Array.isArray(p))) return parts.length ? [Object.assign({}, ...(parts as object[]))] : [];
    return parts.length ? [parts[0]] : [];
  }
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shapeOf((v as Record<string, unknown>)[k])]));
  return v === null ? "null" : typeof v;
}

function shapeDiff(a: unknown, b: unknown, at = ""): string[] {
  if (Array.isArray(a) && Array.isArray(b)) return a.length && b.length ? shapeDiff(a[0], b[0], `${at}[]`) : [];
  // An answer's key is its question's id, the model's choice.
  if (at.endsWith(".answers")) return [];
  if (a && b && typeof a === "object" && typeof b === "object") {
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    return [...new Set([...Object.keys(x), ...Object.keys(y)])].flatMap((k) => (!(k in x) ? [`${at}.${k}: only the real app sends it`] : !(k in y) ? [`${at}.${k}: only the bench sends it`] : shapeDiff(x[k], y[k], `${at}.${k}`)));
  }
  return a === b ? [] : [`${at}: ${String(a)} here, ${String(b)} in the real app`];
}

/**
 * Holds the in-process road to the real app's: the same person through the plan route both ways. What's
 * proposed will differ, as any two runs do. What's sent must have the same shape, in the same order, with
 * each answer exactly as the person gave it. A difference voids the in-process results.
 */
async function twoWay(p: Persona, root: string, ctrl: AbortController) {
  const out = path.join(root, `check-${p.id}`);
  await mkdir(out, { recursive: true });
  console.log(`\nTwo-way check on ${p.id}: in process…`);
  const t = newTap();
  const benchPlayer = makePlayer(p, tapPlayerDeps(t));
  const dir = path.join(out, "home-bench");
  await mkdir(dir, { recursive: true });
  const store = await storeFor(dir, p);
  const bench = await planFlow(store, p, benchPlayer, t, ctrl.signal).finally(() => store.dispose());
  console.log(`  ${bench.bodies.map((b) => b.path).join(" → ")}`);

  console.log("  in the real app…");
  const t2 = newTap();
  const tabPlayer = makePlayer(p, tapPlayerDeps(t2));
  const home = path.join(out, "home-tab");
  const tab = new Tab(p, tabPlayer, home, nextPort++, process.cwd());
  await tab.prepare();
  let result: TabResult;
  try {
    await tab.start();
    result = await tabPlan(tab, p.planSaid ?? p.opener, out);
  } finally {
    await tab.stop();
  }
  const sent = result.bodies.filter((b) => /^plan\/(look|next|propose)$|^briefs$/.test(b.path));
  console.log(`  ${sent.map((b) => b.path).join(" → ")}`);

  const differences: string[] = [];
  const firstOf = (list: { path: string; body: unknown }[], at: string) => list.filter((b) => b.path === at).at(-1)?.body;
  for (const at of ["plan/look", "plan/next", "plan/propose", "briefs"]) {
    const a = firstOf(bench.bodies, at);
    const b = firstOf(sent, at);
    if (!a || !b) {
      differences.push(`${at}: ${a ? "never sent by the real app" : b ? "never sent in process" : "sent by neither"}`);
      continue;
    }
    differences.push(...shapeDiff(shapeOf(a), shapeOf(b), at));
  }
  // Each answer the window sent is what the person gave, unchanged.
  const propose = firstOf(sent, "plan/propose") as { rounds?: { questions: { id: string; title: string }[]; answers?: Record<string, string> }[] } | undefined;
  const wrong: string[] = [];
  for (const r of propose?.rounds ?? []) {
    for (const q of r.questions) {
      const said = (r.answers ?? {})[q.id] ?? "";
      const line = tabPlayer.ledger.find((l) => l.question === q.title);
      if (!line) wrong.push(`Asked but never answered by the player: ${q.title}`);
      else if (line.how !== "skip" && said.trim() !== line.answer.trim()) wrong.push(`"${q.title}": the player gave "${line.answer}", the window sent "${said}"`);
    }
  }
  const report = { differences, wrong, benchOrder: bench.bodies.map((b) => b.path), tabOrder: sent.map((b) => b.path), tabDeadEnds: result.deadEnds, tabErrors: result.errors.slice(0, 8), benchShape: shapeOf(firstOf(bench.bodies, "plan/propose")), tabShape: shapeOf(firstOf(sent, "plan/propose")) };
  await writeFile(path.join(out, "two-way.json"), JSON.stringify({ report, bench: bench.bodies, tab: sent, tabLog: result.log }, null, 2));
  console.log(`\n  Shape differences: ${differences.length ? `\n    ${differences.join("\n    ")}` : "none"}`);
  console.log(`  Answers changed on the way: ${wrong.length ? `\n    ${wrong.join("\n    ")}` : "none"}`);
  console.log(`  Dead ends in the real app: ${result.deadEnds.length}${result.deadEnds.length ? ` (${result.deadEnds[0].seen})` : ""}`);
  console.log(`  ${out}`);
}

function printPlan() {
  console.log(`Persona stress tests · ${PERSONAS.length} people, on Claude Code\n`);
  for (const p of PERSONAS) console.log(`  ${p.id}  ${p.path.padEnd(6)} ${p.title}`);
  console.log(`\nStage 0  lint, paper walk, stubbed run                       0 tokens`);
  console.log(`Stage 1  the player alone, on canned questions                about 40k`);
  console.log(`Stage 2  the first round of questions, both sides             about 500k`);
  console.log(`Stage 3  whole runs, both sides                               about 220k each\n`);
  console.log(`Those are estimates from earlier runs, not measures. Nothing was sent to a model. To run one: pnpm eval:personas --stage <n> --yes`);
}

/** A stand-in for the model and the web, so the wiring can be walked with no tokens. */
function stubDeps(): MarketDeps {
  let asked = false;
  return {
    research: async () => null,
    read: async () => null,
    structured: (async (call: { kind?: string }) => {
      if (call.kind === "chat-route") return { data: { route: "plan" } };
      // The plan's interview (src/asking/): one round, then nothing left open.
      if (call.kind === "ask-turn") {
        if (asked) return { data: { questions: [], lookups: [], done: true, understood: [], terms: [] } };
        asked = true;
        return { data: { questions: [{ id: "q1", title: "Who is it for?", why: "", multi: false, options: [], recommended: [], allowOther: true, after: [] }], lookups: [], done: false, understood: [], terms: [] } };
      }
      if (call.kind === "plan-place") {
        const card = { under: "", why: "A stub.", type: "none", how: "", needed: "no", helps: [], cites: [], metric: { name: "", target: "" }, assumptions: [], test: { assumption: "", what: "", how: "", pass: "" } };
        return { data: { start: "n2", doubt: "A stub.", cards: [{ ...card, ref: "n1", kind: "opportunity", title: "A stub problem", description: "A stub." }, { ...card, ref: "n2", kind: "solution", under: "n1", title: "A stub solution", description: "A stub.", type: "feature", how: "by hand" }] } };
      }
      if (call.kind === "scan-brief") return { data: { features: [{ title: "A stub feature", why: "", acceptance: ["It can be seen"], data: [], connects: [], quotes: [] }] } };
      return { data: {} };
    }) as MarketDeps["structured"],
  };
}

/** A stand-in for the model on the consultant's road (src/consult/): a read, three turns, a proposal. */
function consultStubDeps(): MarketDeps {
  let turn = 0;
  const q = (id: string, title: string, x: Record<string, unknown> = {}) => ({ id, title, why: "So we know where to look", multi: false, options: [], recommended: [], allowOther: true, from: "none", look_for: "", example: "", explain: { term: "", plain: "" }, after: [], ...x });
  const choice = (id: string, title: string) => q(id, title, { options: [{ value: "a", label: "A fee", description: "" }, { value: "b", label: "A cut", description: "" }] });
  const base = { done: false, understood: [], terms: [], open: [], situation: { level: "new", role: "", position: "", stage: "running", theirs: "yes", whose: "unsure", from: [] }, playbook: "page", business: [] as unknown[] };
  const plan = stubDeps();
  return {
    ...plan,
    structured: (async (call: { kind?: string }, signal?: AbortSignal) => {
      // The read of who's asking: someone new, with their own app, at one page.
      if (call.kind === "chat-route") return { data: { said: "named", product: "", name: "Delivery app", role: "", position: "", level: "new", stage: "running", theirs: "yes", whose: "unsure", layer: "page" } };
      if (call.kind === "ask-turn") {
        turn++;
        // Five questions, a look before any answer (dropped), and a note from an answer there isn't (dropped).
        if (turn === 1) return { data: { ...base, questions: [q("q1", "What happens on the basket page?", { example: "People add things, then leave" }), choice("q3", "How does the app earn on an order?"), q("q2", "When did it start?"), q("q4", "Who has it?"), q("q5", "What have you tried?")], lookups: [{ id: "l1", kind: "web", query: "basket abandonment", why: "To see what usually makes people leave" }], business: [{ section: "earns", text: "A delivery fee", q: "q9", theirs: true }] } };
        // After an answer: a look with its reason, what's settled and open, and a note in their own words.
        if (turn === 2) return { data: { ...base, questions: [q("q6", "Did anything change around then?")], understood: [{ text: "People add things and then leave", from: ["q1"] }], open: ["What changed around then"], lookups: [{ id: "l2", kind: "web", query: "delivery fee shown at the basket", why: "To see whether a fee shown late makes people leave" }], business: [{ section: "serves", text: "People add things and then leave", q: "q1", theirs: true }] } };
        return { data: { ...base, questions: [], lookups: [], done: true } };
      }
      return plan.structured(call as never, signal);
    }) as MarketDeps["structured"],
  };
}

/** A person for the stubbed road: the first choice, or the same words, for every question. */
const stubPlayer = (): Player => ({
  fill: async (qs) => Object.fromEntries(qs.map((x) => [x.id, x.options.length ? x.options[0].label : "People add things and then leave"])),
  answer: async () => "",
  pressesPicks: () => false,
  tookPick: () => {},
  ledger: [],
  released: new Set(),
  typed: () => 0,
});

/** The consultant's road walked with a stand-in for the model: what its rules promise, held. */
async function consultStub() {
  const p = personaById("d1")!;
  const dir = path.join(OUT, `stub-consult-${stamp()}`);
  await mkdir(dir, { recursive: true });
  const store = await storeFor(dir, p);
  try {
    const run = await consultFlow(store, p, stubPlayer(), newTap(), new AbortController().signal, { deps: consultStubDeps() });
    const c = run.consult!;
    const fail = (why: string) => {
      throw new Error(`Consultant stub: ${why}`);
    };
    if (c.situation?.level !== "new" || c.playbook !== "page") fail(`read them as ${c.situation?.level} at ${c.playbook}`);
    if (c.lookups.some((l) => l.afterAnswered === 0)) fail("looked something up before they'd answered anything");
    if (c.rounds[0]?.questions.map((x) => x.id).join(",") !== "q1,q2,q4") fail(`the first round was ${c.rounds[0]?.questions.map((x) => x.id).join(",")}, not three open questions`);
    if (!c.rounds[0].questions[0].example) fail("the example for someone new was lost");
    if (!c.rounds[1]?.reflect?.open.length) fail("no reflect-back before the second round");
    if (!c.lookups.some((l) => l.why && l.afterAnswered >= 1)) fail("the later lookup lost its reason");
    const line = c.business.lines.find((l) => l.section === "serves");
    if (!line || line.by !== "said" || line.from?.[0]?.q !== "q1") fail("the business line wasn't kept as their words with the answer it came from");
    if (c.business.lines.some((l) => l.from?.[0]?.q === "q9")) fail("a note from an answer there isn't was kept");
    const m = consulting(p, run)!;
    console.log(`Stubbed consultant on ${p.id}: read ${m.levelRead}, ${m.rounds} rounds, biggest for someone new ${m.biggestRoundForNew}, first web look after ${m.roundsBeforeWeb} answered, ${m.business.lines} business lines. Fine.`);
  } finally {
    store.dispose();
  }
}

async function stage0() {
  const problems = lint(ROOT);
  console.log(problems.length ? `Lint:\n${problems.map((x) => `  - ${x}`).join("\n")}` : "Lint: clean");
  const walk = paperWalk();
  console.log("\nThe paper walk: what the app does with each first message");
  for (const w of walk) console.log(`  ${w.id}  chat: ${w.chat.padEnd(7)} first run, idea card: ${w.firstRunIdea.padEnd(11)} company card: ${w.firstRunCompany}`);
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, "paper-walk.json"), JSON.stringify(walk, null, 2));

  // The wiring, end to end, with a stand-in for the model and the web.
  const p = personaById("b3")!;
  const dir = path.join(OUT, `stub-${stamp()}`);
  await mkdir(dir, { recursive: true });
  const t = newTap();
  const store = await storeFor(dir, p);
  const player = makePlayer(p, { structured: (async () => ({ data: { ids: [], pick: "", words: "" } })) as never });
  try {
    const deps = stubDeps();
    const run = await planFlow(store, p, player, t, new AbortController().signal, { deps });
    const text = renderPlan(run);
    console.log(`\nStubbed run on ${p.id}: route ${JSON.stringify(run.route)}, outline ${run.body.outline.length} problems, ${run.draft?.cards.length ?? 0} cards kept, brief ${run.brief ? `${run.brief.markdown.length} chars` : "none"}.`);
    console.log(`The outline, as the evidence ranks it: ${run.body.outline.map((c) => c.title).join(" | ") || "(empty: no index on this Node?)"}`);
    if (!text.includes("A stub solution")) throw new Error("The stub's card didn't reach the output.");
    if (!run.brief?.markdown.includes("A stub solution")) throw new Error("The stub's card didn't reach the brief.");
    console.log("Stubbed run: fine.");
  } finally {
    store.dispose();
  }
  await consultStub();
}

/** The player alone: on questions with a known answer, does it say only what it was asked? */
async function stage1(ids: Set<string> | null, root: string) {
  const t = newTap();
  const results: unknown[] = [];
  let wrong = 0;
  let total = 0;
  for (const c of CANNED.filter((x) => !ids || ids.has(x.persona))) {
    const p = personaById(c.persona)!;
    const player = makePlayer({ ...p, behavior: { ...p.behavior, enterRate: 0, skipRate: 0 } }, tapPlayerDeps(t));
    for (const q of c.questions) {
      total++;
      const answer = await player.answer(q.q, { flow: "stage1", round: 0 });
      const line = player.ledger.at(-1)!;
      const got = [...line.facts, ...line.unknowns];
      const others = p.facts.filter((f) => !line.facts.includes(f.id));
      const leak = others.find((f) => (f.value.match(/\d[\d,.]*/g) ?? []).some((n) => answer.includes(n)));
      const ok = (q.expect ? got.includes(q.expect) : !line.facts.length) && !leak;
      if (!ok) wrong++;
      results.push({ persona: p.id, question: q.q, expect: q.expect, got, answer, how: line.how, leak: leak?.id ?? null, rejected: line.rejected ?? null, ok });
      console.log(`  ${ok ? "ok " : "NO "} ${p.id} · ${q.q.slice(0, 54).padEnd(54)} → ${got.join(",") || "-"} · ${answer.slice(0, 70)}`);
    }
  }
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "stage1.json"), JSON.stringify(results, null, 2));
  console.log(`\n${total - wrong} of ${total} as expected · ${t.usage.reduce((n, u) => n + u.input + u.output + u.cacheRead + u.cacheWrite, 0)} tokens · $${t.usage.reduce((n, u) => n + (u.cost ?? 0), 0).toFixed(3)} · ${root}`);
}

/**
 * The re-ask measures worked out again on runs saved before (no model calls): each person's sides, from
 * the ledger kept with each. Runs from before `documented` don't count questions about documents.
 */
async function remeasure(dirs: string[]) {
  for (const dir of dirs) {
    console.log(`\n${dir}`);
    const people = (await readdir(dir).catch(() => [] as string[])).filter((d) => /^[abc]\d/.test(d)).sort();
    for (const d of people) {
      const p = personaById(d.slice(0, 2));
      if (!p) continue;
      for (const f of (await readdir(path.join(dir, d)).catch(() => [] as string[])).filter((x) => /^(qalam-[\w-]+|baseline)\.json$/.test(x))) {
        const saved = JSON.parse(await readFile(path.join(dir, d, f), "utf8")) as { ledger?: Parameters<typeof reasks>[1]["ledger"] };
        if (!saved.ledger) continue;
        const r = reasks(p, { ledger: saved.ledger });
        console.log(`  ${d.padEnd(8)} ${f.replace(".json", "").padEnd(12)} again in its flow ${r.sameFlow} · from an earlier flow ${r.crossFlow} · unknown asked again ${r.unknownAgain} · about their documents ${r.askedDocumented} · longest don't-know run ${r.longestDontKnow}`);
        for (const e of r.examples.filter((x) => x.flow !== x.first)) console.log(`      ${e.flow} (first in ${e.first}): ${e.question.slice(0, 110)}`);
      }
    }
  }
}

async function main() {
  const { values } = parseArgs({ options: { yes: { type: "boolean" }, stage: { type: "string" }, only: { type: "string" }, flip: { type: "string" }, "plan-too": { type: "boolean" }, "no-baseline": { type: "boolean" }, models: { type: "boolean" }, budget: { type: "string" }, out: { type: "string" }, rep: { type: "string" }, "plan-only": { type: "boolean" }, "baseline-rounds": { type: "string" }, from: { type: "string", multiple: true } } });
  loadEnvFiles(process.cwd());
  if (!values.stage) return printPlan();
  if (values.stage === "0") return stage0();
  if (values.stage === "measure") return remeasure((values.from ?? []).map((d) => path.resolve(d)));
  if (!values.yes) return printPlan();
  setEngineState({ kind: "cli", bin: process.env.CLAUDE_CLI_PATH || findClaude() || "claude" });
  const ids = values.only ? new Set(values.only.split(",").map((s) => s.trim())) : null;
  const root = values.out ? path.resolve(values.out) : path.join(OUT, "runs", `stage${values.stage}-${stamp()}`);
  if (values.stage === "1") return stage1(ids, root);
  if (values.stage === "check") {
    const ctrl = new AbortController();
    process.on("SIGINT", () => ctrl.abort());
    return twoWay(personaById(values.only ?? "a1")!, root, ctrl);
  }
  const firstRoundOnly = values.stage === "2";
  const people = PERSONAS.filter((p) => !ids || ids.has(p.id));
  if (!people.length) throw new Error(`No such person. There are: ${PERSONAS.map((p) => p.id).join(", ")}`);
  await mkdir(root, { recursive: true });
  const ctrl = new AbortController();
  process.on("SIGINT", () => ctrl.abort());
  const all: Record<string, unknown> = {};
  for (const p of people) {
    const stop = await guard();
    if (stop) {
      console.log(stop);
      break;
    }
    console.log(`\n${p.id}: ${p.title}`);
    const sides = await runPersona(p, root, { firstRoundOnly, ...(values.flip ? { flip: values.flip } : {}), planToo: !!values["plan-too"], noBaseline: !!values["no-baseline"], ...(values.budget ? { budget: Number(values.budget) } : {}), rep: Number(values.rep ?? 0), planOnly: !!values["plan-only"], ...(values["baseline-rounds"] ? { baselineRounds: Number(values["baseline-rounds"]) } : {}) }, ctrl).catch((e: unknown) => {
      console.log(`  failed: ${e instanceof Error ? e.stack : String(e)}`);
      return null;
    });
    if (sides) all[p.id] = sides;
    await writeFile(path.join(root, "all.json"), JSON.stringify(all, null, 2));
  }
  console.log(`\nResults: ${root}`);
}

// A scratch home: never ~/Qalam.
process.env.QALAM_HOME ??= path.resolve(".qalam-dev/stress/home");
// Search by meaning is off unless asked for; empty, it's on here and in the real app's server (tab.ts passes it on).
if (!process.argv.includes("--models")) process.env.QALAM_NO_MODELS ??= "1";
else process.env.QALAM_NO_MODELS = "";

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  },
);
