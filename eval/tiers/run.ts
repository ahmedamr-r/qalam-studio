import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { DiscoveryBody, extractCall } from "@/ai/discovery";
import { setEngineState } from "@/ai/engine";
import { modelFamily, modelFor, type Tier } from "@/ai/models";
import { claimsCall } from "@/ai/outside";
import { streamStructured, type CallOpts } from "@/ai/server";
import { SetupBody, setupCall, type SetupRequest } from "@/ai/setup";
import { TopicsBody, topicsCall } from "@/ai/topics";
import { packCalls, SOURCE_KIND_LABEL, unread, type SourceRecord } from "@/discovery/sources";
import { sanitizeExtract, type CallChunk } from "@/discovery/synthesis";
import { readOutline, sanitizeShaped } from "@/goals/outline";
import { claimsMaterial, sanitizeClaims } from "@/goals/outside";
import { goalsText } from "@/goals/text";
import { fileMaterial, type FilingDeps } from "@/hub/filing";
import { filingSize, type Filing } from "@/hub/topics";
import { contextText } from "@/org/context-md";
import { findClaude } from "../../server/claude";
import { loadEnvFiles } from "../../server/env";
import { secrets } from "../../server/secrets";
import { buildBasket, SOURCES } from "../retrieval/basket";
import { ANSWERS, OUTLINE, OUTSIDE_NOTES, OUTSIDE_PAGES, OUTSIDE_TASK, SHAPE_PRODUCTS } from "./sample";

/**
 * pnpm eval:tiers: should reading run on Sonnet? The read tier's calls (extract, filing into topic
 * pages, the setup's shape, outside claims) run on the Basket sample three ways: Opus 5.5 at each
 * call's effort (the baseline), Sonnet 5.5 at the same effort, and Opus one effort lower (the
 * cheaper way to compare with). For each kind of call: tokens, cost at API prices, seconds, what
 * the model returned and what the app's own checks keep of it. Each case's outputs are written
 * side by side to a scratch folder.
 *
 * It spends real tokens (on Claude Code, the plan's limits), so it only estimates unless asked:
 *   pnpm eval:tiers                 the plan and the estimate, no model calls (also --dry)
 *   pnpm eval:tiers --yes           run it (--engine api|cli, --runs N, --only extract,claims, --out dir)
 */

type Kind = "extract" | "topics" | "shape" | "claims";
type Effort = CallOpts["effort"];
const KINDS: Kind[] = ["extract", "topics", "shape", "claims"];

interface Config {
  id: "opus" | "sonnet" | "opus-lower";
  name: string;
  tier: Tier;
  lower: boolean;
}
const CONFIGS: Config[] = [
  { id: "opus", name: "Opus 5.5, its effort", tier: "decide", lower: false },
  { id: "sonnet", name: "Sonnet 5.5, its effort", tier: "read", lower: false },
  { id: "opus-lower", name: "Opus 5.5, one lower", tier: "decide", lower: true },
];
const LOWER: Record<Effort, Effort | null> = { xhigh: "high", high: "medium", medium: "low", low: null };

/** Dollars per million tokens: in, out, cache read, cache write (5 minutes on the API; Claude Code writes an hour's, at twice the input price). */
const PRICE: Record<string, { in: number; out: number; read: number; write: number }> = {
  Opus: { in: 4, out: 20, read: 0.2, write: 5 },
  Sonnet: { in: 2, out: 10, read: 0.2, write: 2.5 },
};
/** What a call writes, thinking included, for the estimate (the run measures it). */
const OUT_GUESS: Record<Kind, number> = { extract: 2500, topics: 5000, shape: 1800, claims: 1500 };
const LOWER_OUT = 0.7;
const SECONDS_GUESS: Record<Kind, number> = { extract: 35, topics: 70, shape: 25, claims: 25 };
/** Characters a token, roughly, for prompts and JSON schemas. */
const CHARS_PER_TOKEN = 3.5;

interface Usage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** One model call as a config runs it. */
type Ask = (opts: CallOpts) => Promise<unknown>;

interface Scored {
  returned: number;
  kept: number;
  /** What code kept, for people. */
  items: string[];
}

interface Case {
  kind: Kind;
  label: string;
  /** Makes the case's calls through `ask` and scores what the checks keep. */
  run: (ask: Ask) => Promise<Scored & { raw: unknown[] }>;
}

interface Tally {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  seconds: number;
  returned: number;
  kept: number;
  errors: number;
  models: Set<string>;
}
const tally = (): Tally => ({ calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, seconds: 0, returned: 0, kept: 0, errors: 0, models: new Set() });

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : []);
const one = (s: string) => s.replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// The cases, built from the sample the way the app builds each call

/** Builds the cases; `problems` hears a request the routes would refuse (the core doesn't check, so the eval does). */
async function casesFor(dir: string, problems: string[]): Promise<{ cases: Case[]; dispose: () => void }> {
  const store = await buildBasket(dir);
  const [about, products, goals] = await Promise.all([store.getAbout(), store.listProducts(), store.getGoals()]);
  const names = new Map(products.map((p) => [p.id, p.name]));
  // As the core tells Qalam AI what the product is (server/capture.ts).
  const productLine = (id: string | null) => {
    const p = products.find((x) => x.id === id);
    return [p ? contextText(p, `The product (${p.name}):`) : "", contextText(about, "The organization:"), goalsText(goals, { product: id ?? null, productName: (x) => names.get(x) })].filter(Boolean).join("\n\n");
  };
  const sources = (await Promise.all(SOURCES.map((s) => store.getSource(s.id)))).filter((s): s is SourceRecord => !!s);
  const cases: Case[] = [];

  // Extract: each source read from the start, in the parts a capture sends (a brain dump isn't read).
  for (const s of sources) {
    const fresh = { ...s, read: [], quotes: [], needs: [] };
    const calls = packCalls(unread(fresh));
    for (const [i, part] of calls.entries()) {
      const chunks: CallChunk[] = part.map((c, j) => ({ ref: `c${j + 1}`, sourceId: s.id, start: c.start, text: s.text.slice(c.start, c.end) }));
      const body = {
        stage: "extract" as const,
        product: productLine(s.product ?? null).slice(0, 2000),
        chunks: chunks.map((c) => ({ id: c.ref, source: s.title.slice(0, 300), kind: SOURCE_KIND_LABEL[s.kind], text: c.text })),
      };
      if (!DiscoveryBody.safeParse(body).success) problems.push(`extract · ${s.title}: the route would refuse this request`);
      cases.push({
        kind: "extract",
        label: calls.length > 1 ? `${s.title} (part ${i + 1})` : s.title,
        run: async (ask) => {
          const raw = await ask(extractCall(body));
          const got = sanitizeExtract(raw, chunks);
          return {
            raw: [raw],
            returned: list(rec(raw).quotes).length + list(rec(raw).needs).length,
            kept: got.quotes.length + got.needs.length,
            items: [...got.quotes.map((q) => `“${one(q.quote.text)}” (${q.quote.kind})`), ...got.needs.map((n) => `Need: ${one(n.need.title)}`)],
          };
        },
      });
    }
  }

  // Filing: every source's quotes into empty topic pages, in the calls the app makes (src/hub/filing.ts).
  cases.push({
    kind: "topics",
    label: "Filing the sample's quotes into topic pages",
    run: async (ask) => {
      const raw: unknown[] = [];
      const filings: Filing[] = [];
      const deps: FilingDeps = {
        products,
        about,
        productLine: (id) => productLine(id),
        listTopics: async () => [],
        pack: async () => null,
        call: async (body) => {
          if (!TopicsBody.safeParse(body).success) problems.push("topics: the route would refuse a filing request");
          const r = await ask(topicsCall(body));
          raw.push(r);
          return r;
        },
        file: async (f) => {
          filings.push(f);
          return { created: [], counts: { added: 0, revised: 0, retired: 0, disputed: 0 }, pages: [] };
        },
      };
      await fileMaterial(deps, sources.map((s) => ({ ...s, filed: [] })));
      const lines = (r: unknown) => ["add", "revise", "retire", "dispute"].reduce((n, k) => n + list(rec(r)[k]).length, 0);
      return {
        raw,
        returned: raw.reduce<number>((n, r) => n + lines(r), 0),
        kept: filings.reduce((n, f) => n + filingSize(f), 0),
        items: filings.flatMap((f) => [...f.add.map((l) => `${l.section} · ${one(l.text)}`), ...f.dispute.map((l) => `against · ${one(l.text)}`)]),
      };
    },
  });

  // Shape: the founder's goals, one a line, read into goals Qalam can track.
  const outline = readOutline(OUTLINE);
  const answers = new Map(Object.entries(ANSWERS));
  const shape: SetupRequest = {
    stage: "shape",
    name: "Basket",
    products: SHAPE_PRODUCTS.map((p) => ({ id: p.ref, name: p.name })),
    goals: outline.map((g) => ({ id: g.ref, text: g.text, parent: g.parent })),
    answers: [...answers].map(([id, answer]) => ({ id, answer })),
  };
  if (!SetupBody.safeParse(shape).success) problems.push("shape: the route would refuse this request");
  cases.push({
    kind: "shape",
    label: `Shaping ${outline.length} goals`,
    run: async (ask) => {
      const raw = await ask(setupCall(shape));
      const proposed = new Map(list(rec(raw).goals).map((g) => [String(g.id), g]));
      const shaped = sanitizeShaped(raw, { goals: outline, products: SHAPE_PRODUCTS, answers });
      // Each goal's title, product and number the model proposed, and the ones code kept.
      let returned = 0;
      let kept = 0;
      for (const g of shaped) {
        const p = proposed.get(g.ref);
        if (!p) continue;
        const title = typeof p.title === "string" ? one(p.title) : "";
        const product = typeof p.product === "string" && p.product !== "org";
        returned += Number(!!title) + Number(product) + Number(!!p.metric);
        // A title is kept when code took the model's words (else it falls back to the line as written).
        kept += Number(!!title && g.title === title.slice(0, 120)) + Number(product && !!g.product) + Number(!!p.metric && !!g.metric);
      }
      return {
        raw: [raw],
        returned,
        kept,
        items: shaped.map((g) => [g.title, g.product ? ("id" in g.product ? g.product.id : `new: ${g.product.name}`) : "org", g.metric ? `${g.metric.name}: ${[g.metric.baseline ?? g.metric.current, g.metric.target].map((x) => x ?? "?").join(" → ")} ${g.metric.unit ?? ""} ${g.metric.timeframe ?? ""}`.trim() : "no number"].join(" · ")),
      };
    },
  });

  // Claims: the numbers two outside pages give for a goal, each found on its page.
  const m = claimsMaterial({ task: OUTSIDE_TASK, notes: OUTSIDE_NOTES, pages: OUTSIDE_PAGES });
  cases.push({
    kind: "claims",
    label: "Outside numbers for “More customers reorder every week”",
    run: async (ask) => {
      const raw = await ask(claimsCall(m));
      const claims = sanitizeClaims(raw, m, { now: Date.now() });
      return { raw: [raw], returned: list(rec(raw).claims).length, kept: claims.length, items: claims.map((c) => `${one(c.what)}: ${c.value}${c.unit ? ` ${c.unit}` : ""} (${one(c.who)})`) };
    },
  });

  return { cases, dispose: () => store.dispose() };
}

// ---------------------------------------------------------------------------
// One call, read to its end with what it used (safe to run three at once)

async function callOnce(opts: CallOpts): Promise<{ data: unknown; usage: Usage; model: string }> {
  const reader = streamStructured(opts).body!.getReader();
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
      const msg = JSON.parse(line) as { type: string; data?: unknown; usage?: Usage; model?: string; error?: string; message?: string };
      if (msg.type === "result") return { data: msg.data, usage: msg.usage ?? {}, model: msg.model ?? opts.model ?? "" };
      if (msg.type === "error") throw new Error(msg.message ?? msg.error ?? "The call failed.");
    }
  }
  throw new Error("The response ended early.");
}

function costOf(u: Usage, model: string, engine: "api" | "cli"): number {
  const p = PRICE[modelFamily(model)] ?? PRICE.Opus;
  const write = engine === "cli" ? p.in * 2 : p.write;
  return ((u.input_tokens ?? 0) * p.in + (u.output_tokens ?? 0) * p.out + (u.cache_read_input_tokens ?? 0) * p.read + (u.cache_creation_input_tokens ?? 0) * write) / 1e6;
}

// ---------------------------------------------------------------------------
// The estimate: each case's calls, made with a stand-in that answers nothing

async function plan(cases: Case[]) {
  const sent = new Map<Kind, { calls: number; input: number; effort: Effort }>();
  for (const c of cases) {
    await c.run(async (opts) => {
      const s = sent.get(c.kind) ?? { calls: 0, input: 0, effort: opts.effort };
      const chars = (Array.isArray(opts.system) ? opts.system.join("\n\n") : opts.system).length + opts.content.reduce((n, b) => n + (b.type === "text" ? b.text.length : 0), 0) + JSON.stringify(opts.schema).length;
      s.calls++;
      s.input += Math.round(chars / CHARS_PER_TOKEN) + 50;
      sent.set(c.kind, s);
      return {};
    });
  }
  return sent;
}

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const pad = (s: string, n: number) => s.padEnd(n);
const lpad = (s: string, n: number) => s.padStart(n);

function printEstimate(sent: Awaited<ReturnType<typeof plan>>, runs: number, engine: "api" | "cli", problems: string[]) {
  console.log(`Estimate for ${runs} run${runs === 1 ? "" : "s"} (input from the requests as built; output guessed, thinking included)\n`);
  console.log(`${pad("Call", 9)}${lpad("Calls", 6)}${lpad("Effort", 8)}${lpad("In/call", 9)}${lpad("Out/call", 10)}${CONFIGS.map((c) => lpad(c.name, 24)).join("")}`);
  const totals = new Map<string, { cost: number; calls: number; tokens: number }>(CONFIGS.map((c) => [c.id, { cost: 0, calls: 0, tokens: 0 }]));
  let seconds = 0;
  for (const kind of KINDS) {
    const s = sent.get(kind);
    if (!s) continue;
    const cells = CONFIGS.map((c) => {
      if (c.lower && !LOWER[s.effort]) return lpad("n/a (already low)", 24);
      const p = c.tier === "read" ? PRICE.Sonnet : PRICE.Opus;
      const out = OUT_GUESS[kind] * (c.lower ? LOWER_OUT : 1);
      const cost = (s.calls * runs * (s.input / s.calls) * p.in + s.calls * runs * out * p.out) / 1e6;
      const t = totals.get(c.id)!;
      t.cost += cost;
      t.calls += s.calls * runs;
      t.tokens += s.calls * runs * (s.input / s.calls + out);
      return lpad(usd(cost), 24);
    });
    seconds += SECONDS_GUESS[kind] * s.calls * runs;
    console.log(`${pad(kind, 9)}${lpad(String(s.calls * runs), 6)}${lpad(s.effort, 8)}${lpad(k(s.input / s.calls), 9)}${lpad(k(OUT_GUESS[kind]), 10)}${cells.join("")}`);
  }
  const all = [...totals.values()];
  console.log(`${pad("All", 9)}${lpad("", 33)}${CONFIGS.map((c) => lpad(usd(totals.get(c.id)!.cost), 24)).join("")}`);
  console.log(`\n${all.reduce((n, t) => n + t.calls, 0)} calls across the three ways.`);
  const dollars = all.reduce((n, t) => n + t.cost, 0);
  const tokens = all.reduce((n, t) => n + t.tokens, 0);
  console.log(`About ${k(tokens)} tokens in all, ${usd(dollars)} at API prices (no cache counted, so likely less). The three ways run side by side: about ${Math.ceil(seconds / 60)} minutes.`);
  console.log(engine === "cli" ? "On Claude Code: no money, but it counts against the plan's usage limits." : "On an API key: billed to that key.");
  for (const p of [...new Set(problems)]) console.log(`! ${p}`);
}

// ---------------------------------------------------------------------------

async function main() {
  const { values } = parseArgs({
    options: { dry: { type: "boolean" }, yes: { type: "boolean" }, engine: { type: "string" }, runs: { type: "string" }, only: { type: "string" }, out: { type: "string" } },
  });
  loadEnvFiles(process.cwd());
  const runs = Math.max(1, Math.min(5, Number(values.runs ?? 1) || 1));
  const only = values.only ? new Set(values.only.split(",").map((s) => s.trim())) : null;
  const engine: "api" | "cli" = values.engine === "cli" || values.engine === "api" ? values.engine : process.env.ANTHROPIC_API_KEY ? "api" : "cli";
  const dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-eval-tiers-")), "Basket");
  const problems: string[] = [];
  const { cases: every, dispose } = await casesFor(dir, problems);
  const cases = every.filter((c) => !only || only.has(c.kind));
  try {
    const models = Object.fromEntries(CONFIGS.map((c) => [c.id, modelFor(c.tier, { backend: engine, mix: "balanced", env: {} })]));
    console.log(`Tier eval on the Basket sample · engine: ${engine === "api" ? "an API key" : "Claude Code"} · ${cases.length} cases · ${CONFIGS.map((c) => `${c.name} (${models[c.id]})`).join(", ")}\n`);
    const sent = await plan(cases);
    printEstimate(sent, runs, engine, problems);
    if (values.dry || !values.yes) {
      console.log(`\nNothing was sent to a model. To run it: pnpm eval:tiers --yes${engine === "cli" ? " --engine cli" : ""}${runs > 1 ? ` --runs ${runs}` : ""}`);
      return;
    }

    if (engine === "api") {
      const key = process.env.ANTHROPIC_API_KEY || (await secrets().get("anthropic-api-key").catch(() => null));
      if (!key) throw new Error("No API key: set ANTHROPIC_API_KEY, keep one in Connections, or run with --engine cli.");
      setEngineState({ kind: "api", key });
    } else setEngineState({ kind: "cli", bin: process.env.CLAUDE_CLI_PATH || findClaude() || "claude" });

    const out = values.out ? path.resolve(values.out) : path.join(tmpdir(), "qalam-eval-tiers", new Date().toISOString().replace(/[:.]/g, "-"));
    await mkdir(out, { recursive: true });
    const totals = new Map<string, Tally>();
    const t = (kind: Kind, id: string) => totals.get(`${kind} ${id}`) ?? (totals.set(`${kind} ${id}`, tally()).get(`${kind} ${id}`) as Tally);
    const side: string[] = ["# Tier eval: outputs side by side", "", `Engine: ${engine === "api" ? "API key" : "Claude Code"} · ${new Date().toISOString()}`, ""];
    let n = 0;
    for (let run = 1; run <= runs; run++) {
      for (const c of cases) {
        n++;
        console.log(`\n[${run}/${runs}] ${c.kind} · ${c.label}`);
        const results = await Promise.all(
          CONFIGS.map(async (cfg) => {
            const kept = { model: models[cfg.id], effort: "" as string, ok: true };
            const row = t(c.kind, cfg.id);
            const t0 = performance.now();
            try {
              const r = await c.run(async (opts) => {
                const effort = cfg.lower ? LOWER[opts.effort] : opts.effort;
                if (!effort) throw new Skip();
                kept.effort = effort;
                const got = await callOnce({ ...opts, model: models[cfg.id], effort });
                row.calls++;
                row.input += got.usage.input_tokens ?? 0;
                row.output += got.usage.output_tokens ?? 0;
                row.cacheRead += got.usage.cache_read_input_tokens ?? 0;
                row.cacheWrite += got.usage.cache_creation_input_tokens ?? 0;
                row.cost += costOf(got.usage, got.model, engine);
                row.models.add(got.model);
                return got.data;
              });
              row.seconds += (performance.now() - t0) / 1000;
              row.returned += r.returned;
              row.kept += r.kept;
              console.log(`  ${pad(cfg.name, 24)} returned ${r.returned}, kept ${r.kept} · ${((performance.now() - t0) / 1000).toFixed(0)} s`);
              return { cfg, ...kept, ...r };
            } catch (e) {
              if (e instanceof Skip) return { cfg, ...kept, ok: false, skipped: true, returned: 0, kept: 0, items: [], raw: [] };
              row.errors++;
              const message = e instanceof Error ? e.message : String(e);
              console.log(`  ${pad(cfg.name, 24)} failed: ${message}`);
              return { cfg, ...kept, ok: false, error: message, returned: 0, kept: 0, items: [], raw: [] };
            }
          }),
        );
        const slug = `${String(n).padStart(2, "0")}-${c.kind}-${c.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;
        await mkdir(path.join(out, c.kind), { recursive: true });
        await writeFile(path.join(out, c.kind, `${slug}.json`), JSON.stringify({ kind: c.kind, label: c.label, run, configs: Object.fromEntries(results.map((r) => [r.cfg.id, { ...r, cfg: undefined }])) }, null, 2));
        side.push(`## ${c.kind} · ${c.label}${runs > 1 ? ` (run ${run})` : ""}`, "");
        for (const r of results) {
          side.push(`### ${r.cfg.name} · ${r.model}${r.effort ? ` · ${r.effort}` : ""}`, "");
          if ("skipped" in r && r.skipped) side.push("Not run: the call is already at the lowest effort.", "");
          else if ("error" in r && r.error) side.push(`Failed: ${r.error}`, "");
          else side.push(`Returned ${r.returned}, kept ${r.kept}.`, "", ...r.items.map((x) => `- ${x}`), "");
        }
      }
    }
    await writeFile(path.join(out, "side-by-side.md"), side.join("\n"));
    report(totals, out);
  } finally {
    dispose();
    await rm(path.dirname(dir), { recursive: true, force: true });
  }
}

class Skip extends Error {}

function report(totals: Map<string, Tally>, out: string) {
  const get = (kind: Kind, id: string) => totals.get(`${kind} ${id}`) ?? tally();
  console.log(`\n${pad("Call", 9)}${pad("Config", 24)}${lpad("Calls", 6)}${lpad("In", 8)}${lpad("Out", 8)}${lpad("Cost", 9)}${lpad("$/call", 9)}${lpad("s/call", 8)}${lpad("Returned", 10)}${lpad("Kept", 6)}${lpad("vs Opus", 9)}`);
  const verdicts: string[] = [];
  let balanced = true;
  for (const kind of KINDS) {
    const base = get(kind, "opus");
    if (!base.calls && !base.errors) continue;
    for (const c of CONFIGS) {
      const r = get(kind, c.id);
      if (!r.calls && !r.errors) {
        console.log(`${pad(kind, 9)}${pad(c.name, 24)}  not run (already at the lowest effort)`);
        continue;
      }
      const vs = base.kept ? `${((r.kept / base.kept) * 100).toFixed(0)}%` : "—";
      console.log(
        `${pad(kind, 9)}${pad(c.name, 24)}${lpad(String(r.calls), 6)}${lpad(k(r.input + r.cacheRead + r.cacheWrite), 8)}${lpad(k(r.output), 8)}${lpad(usd(r.cost), 9)}${lpad(r.calls ? usd(r.cost / r.calls) : "—", 9)}${lpad(r.calls ? (r.seconds / r.calls).toFixed(0) : "—", 8)}${lpad(String(r.returned), 10)}${lpad(String(r.kept), 6)}${lpad(vs, 9)}${r.errors ? `  ${r.errors} failed` : ""}`,
      );
    }
    // The rule: Sonnet keeps checked items within 5% of the baseline, and costs less a call than Opus one effort lower.
    const sonnet = get(kind, "sonnet");
    const lower = get(kind, "opus-lower");
    const quality = !sonnet.errors && sonnet.kept >= base.kept * 0.95;
    const cheaper = !lower.calls || (sonnet.calls > 0 && sonnet.cost / sonnet.calls < lower.cost / lower.calls);
    if (!quality || !cheaper) balanced = false;
    const lowerHolds = lower.calls > 0 && !lower.errors && lower.kept >= base.kept * 0.95;
    verdicts.push(
      `${kind}: Sonnet kept ${sonnet.kept} of Opus's ${base.kept} (${quality ? "within" : "not within"} 5%)${lower.calls ? `, ${cheaper ? "cheaper" : "not cheaper"} a call than Opus one lower` : ""}${lowerHolds && !cheaper ? "; Opus one lower holds too, and costs less" : ""}.`,
    );
  }
  console.log(`\n${verdicts.join("\n")}`);
  console.log(`\n${balanced ? 'Recommend "balanced" as the default: Sonnet reads as well as Opus here, for less.' : 'Keep "best" as the default: Sonnet didn\'t hold on every read call at a lower cost than Opus one effort lower.'}`);
  console.log(`\nOutputs side by side: ${path.join(out, "side-by-side.md")} (each case's raw answers in ${out}/<call>/)`);
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
