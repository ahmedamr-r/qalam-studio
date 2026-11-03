import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { setEngineState } from "@/ai/engine";
import { research } from "@/ai/server";
import { onUsage } from "@/ai/usage";
import type { UsageEntry } from "@/ai/usage-shared";
import { postAddress, REVIEW_PAGES, reviewFeed, reviewsIn, withoutHandles } from "@/discovery/ingest/posts";
import { htmlText } from "@/discovery/ingest/text";
import { findQuote } from "@/discovery/quotes";
import { quotePiece, type SourceRecord } from "@/discovery/sources";
import { needLine } from "@/hub/needs";
import type { ScanSession } from "@/scan/session";
import { findClaude } from "../../server/claude";
import { loadEnvFiles } from "../../server/env";
import { needsNow } from "../../server/org/needs";
import { readJson, readPage } from "../../server/org/pages";
import { scanToEnd } from "../../server/org/scan";
import { OrgStore } from "../../server/org/store";
import { LOOP_INPUTS, type LoopInput } from "./inputs";

/**
 * pnpm eval:loop: the launch loop's go or no-go check (docs/launch-loop.md, phase 2). Each input runs a
 * real scan in a scratch folder, beside plain Claude with web search on the same question. It records
 * time, tokens, problems, quotes kept and thrown out, checks every kept quote against a fresh read of
 * its page, looks for usernames in what's kept, and writes a report per input for a person to read:
 * code can't say whether a problem is specific, or better than plain Claude's answer.
 *
 * It spends real tokens (on Claude Code, the plan's limits), so it only prints its plan unless asked:
 *   pnpm eval:loop                         the plan, no model calls
 *   pnpm eval:loop --yes                   run all of it
 *   pnpm eval:loop --yes --only duolingo   run some of it (ids, comma separated; --out dir)
 */

const PER_SCAN = { research: 3, small: 2, reads: "up to 11", filing: "about 3 to 6" };

function printPlan(inputs: LoopInput[]) {
  console.log(`Launch loop eval · ${inputs.length} inputs on Claude Code\n`);
  for (const i of inputs) console.log(`  ${i.id.padEnd(18)} ${i.group}`);
  console.log(`\nEach input: ${PER_SCAN.research} web lookups (one of them plain Claude's), ${PER_SCAN.small} small calls, ${PER_SCAN.reads} read calls at about 24,000 characters each, ${PER_SCAN.filing} filing calls.`);
  console.log("Measure one input first (--only) to see what a whole run would cost on your plan.");
  console.log("\nNothing was sent to a model. To run it: pnpm eval:loop --yes");
}

const hnText = (item: unknown): { text: string; authors: string[] } => {
  const texts: string[] = [];
  const authors: string[] = [];
  const walk = (n: unknown) => {
    const x = (n ?? {}) as { text?: unknown; author?: unknown; children?: unknown };
    if (typeof x.text === "string") texts.push(withoutHandles(htmlText(x.text).text));
    if (typeof x.author === "string") authors.push(x.author);
    for (const c of Array.isArray(x.children) ? x.children : []) walk(c);
  };
  walk(item);
  return { text: texts.join("\n\n"), authors };
};

/** A source's page read again by code, with who wrote it where the page says. */
async function freshRead(s: SourceRecord, signal: AbortSignal): Promise<{ text: string; authors: string[] } | null> {
  const origin = s.origin ?? "";
  const hn = /news\.ycombinator\.com\/item\?id=(\d+)/.exec(origin)?.[1];
  if (hn) return hnText(await readJson(`https://hn.algolia.com/api/v1/items/${hn}`, signal));
  const where = postAddress(origin);
  if (where.kind === "appstore") {
    const texts: string[] = [];
    const authors: string[] = [];
    for (let page = 1; page <= REVIEW_PAGES; page++) {
      const json = (await readJson(reviewFeed(where.id, where.country, page), signal)) as { feed?: { entry?: unknown } } | null;
      const got = reviewsIn(json);
      texts.push(...got.map((r) => `${r.title}. ${r.words}`));
      // A feed with one review gives it as an object, not a list.
      const entry = json?.feed?.entry;
      for (const e of (Array.isArray(entry) ? entry : entry ? [entry] : []) as { author?: { name?: { label?: string } } }[]) if (e.author?.name?.label) authors.push(e.author.name.label);
      if (got.length < 50) break;
    }
    return { text: texts.join("\n\n"), authors };
  }
  const page = await readPage({ url: origin }, signal);
  return page && { text: withoutHandles(page.text), authors: [] };
}

/** Every kept quote looked for on a fresh read of its page, and usernames looked for in what's kept. */
async function checkSources(sources: SourceRecord[], signal: AbortSignal) {
  let found = 0;
  let total = 0;
  let unread = 0;
  const missing: { source: string; quote: string }[] = [];
  const names: { source: string; name: string }[] = [];
  for (const s of sources) {
    const fresh = await freshRead(s, signal);
    if (!fresh?.text) {
      unread += s.quotes.length;
      continue;
    }
    for (const q of s.quotes) {
      total++;
      if (findQuote(fresh.text, q.text)) found++;
      else missing.push({ source: s.title, quote: q.text.slice(0, 200) });
    }
    // Only names long enough not to be everyday words by chance: a person reads what this lists.
    for (const a of new Set(fresh.authors)) if (a.length >= 5 && new RegExp(`\\b${a.replace(/[^\w]/g, "\\$&")}\\b`).test(s.text)) names.push({ source: s.title, name: a });
  }
  return { found, total, unread, missing, names };
}

const line = (s: string) => s.replace(/\s+/g, " ").trim();

async function report(i: LoopInput, s: ScanSession, store: OrgStore, sources: SourceRecord[], plain: string, m: Record<string, unknown>) {
  const quotes = new Map(sources.flatMap((x) => x.quotes.map((q) => [quotePiece(q.id), { text: q.text, title: x.title, origin: x.origin }] as const)));
  const { needs } = await needsNow(store);
  const out = [`# ${i.id} (${i.group})`, "", `Asked: ${s.target.kind === "idea" ? s.target.said : s.target.name}`, "", `State: ${s.state}${s.thin ? " · said it found little" : ""}${s.error ? ` · ${s.error}` : ""}`, "", "```json", JSON.stringify(m, null, 2), "```", "", "## What it read", ""];
  out.push(...s.competitors.map((c) => `- Uses today: ${c.name}${c.app ? ` (app: ${c.app.name})` : " (no app found)"}`));
  out.push(...s.read.map((r) => `- ${r.title} · ${r.quotes ?? 0} quotes${r.reviews ? ` · ${r.reviews.kept} of ${r.reviews.read} reviews read` : ""} · ${r.origin}`));
  out.push(...(s.notRead ?? []).map((n) => `- Not read (${n.why}): ${n.url}`));
  if (s.known?.length) out.push("", "## Read elsewhere", "", ...s.known.map((k) => `- ${k.name ? `${k.name}: ` : ""}${line(k.text)} (${k.title}, ${k.url})`));
  out.push("", "## Problems, ranked", "");
  for (const n of needs) {
    const t = await store.getTopic(n.topic);
    out.push(`### ${n.title}`, "", needLine(n), "");
    for (const l of t?.lines ?? []) {
      out.push(`- [${l.section}] ${line(l.text)}`);
      for (const c of l.cites.slice(0, 3)) {
        const q = quotes.get(c);
        if (q) out.push(`  - “${line(q.text).slice(0, 300)}” (${q.title}, ${q.origin})`);
      }
    }
    out.push("");
  }
  out.push("## Plain Claude with web search, same question", "", plain || "(no answer)", "", "## For a person to mark", "", "- At least 3 problems specific to this product or idea? yes / no", "- Clearly better than plain Claude's answer? yes / no", "- Why:", "");
  return out.join("\n");
}

async function runOne(i: LoopInput, root: string, out: string) {
  const dir = path.join(root, i.id);
  const store = await OrgStore.create(dir, { id: i.id, name: i.id, createdAt: Date.now(), shape: "solo" });
  const spent: UsageEntry[] = [];
  // One listener at a time: each input's run takes it over.
  onUsage((e) => void spent.push(e));
  const ctrl = new AbortController();
  const began = Date.now();
  try {
    const session = await scanToEnd(store, i.request);
    const seconds = Math.round((Date.now() - began) / 1000);
    const scanTokens = spent.reduce((n, e) => n + e.input + e.output + e.cacheRead + e.cacheWrite, 0);
    const about = session.target.kind === "idea" ? session.target.said : session.target.name;
    const plainNotes = (await research({ purpose: "posts", task: `What do people complain about here, in their own words, and what's worth building? ${about}`, connectors: ["web"] }, () => {}, ctrl.signal).catch(() => null))?.notes ?? "";
    const sources = (await store.listSources()).filter((s) => s.kind === "post" || s.kind === "url");
    const check = await checkSources(sources, ctrl.signal);
    const metrics = {
      id: i.id,
      group: i.group,
      state: session.state,
      seconds,
      calls: spent.length,
      tokens: scanTokens,
      read: session.read.length,
      problems: session.problems.length,
      kept: session.checked.kept,
      notFound: session.checked.notFound,
      unbacked: session.checked.unbacked,
      thin: session.thin,
      skipped: session.skipped,
      quotesOnFreshRead: `${check.found} of ${check.total}${check.unread ? ` (${check.unread} on pages that couldn't be read again)` : ""}`,
      missing: check.missing,
      possibleUsernames: check.names,
    };
    await writeFile(path.join(out, `${i.id}.md`), await report(i, session, store, sources, plainNotes, metrics));
    return metrics;
  } finally {
    store.dispose();
  }
}

async function main() {
  const { values } = parseArgs({ options: { yes: { type: "boolean" }, only: { type: "string" }, out: { type: "string" } } });
  loadEnvFiles(process.cwd());
  const only = values.only ? new Set(values.only.split(",").map((s) => s.trim())) : null;
  const inputs = LOOP_INPUTS.filter((i) => !only || only.has(i.id));
  if (!inputs.length) throw new Error(`No such input. There are: ${LOOP_INPUTS.map((i) => i.id).join(", ")}`);
  if (!values.yes) return printPlan(inputs);

  setEngineState({ kind: "cli", bin: process.env.CLAUDE_CLI_PATH || findClaude() || "claude" });
  const base = path.resolve(".qalam-dev/eval-loop");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "run-"));
  const out = values.out ? path.resolve(values.out) : path.join(root, "reports");
  await mkdir(out, { recursive: true });
  const all = [];
  for (const i of inputs) {
    console.log(`\n${i.id}: scanning…`);
    // One input failing doesn't stop the rest.
    const m = await runOne(i, root, out).catch((e: unknown) => {
      console.log(`  failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    if (!m) continue;
    all.push(m);
    await writeFile(path.join(out, "summary.json"), JSON.stringify(all, null, 2));
    console.log(`  ${m.state} · ${m.seconds}s · ${m.calls} calls · ${m.tokens} tokens · ${m.read} read · ${m.problems} problems · ${m.kept} quotes, ${m.notFound} not found, ${m.unbacked} lines unbacked · on a fresh read: ${m.quotesOnFreshRead}${m.thin ? " · said it found little" : ""}`);
  }
  console.log(`\nReports for a person to read: ${out}`);
}

// A scratch home: an eval never touches ~/Qalam, and the org's search needs no model download.
process.env.QALAM_HOME ??= path.resolve(".qalam-dev/eval-loop/home");
process.env.QALAM_NO_MODELS ??= "1";

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
