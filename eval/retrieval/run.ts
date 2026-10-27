import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pack } from "@/hub/pack";
import { models } from "../../server/models/client";
import { OrgIndex, topicsOf } from "../../server/index/indexer";
import { search, withNeighbours, type SearchOpts } from "../../server/index/search";
import { buildBasket } from "./basket";
import { QUERIES, type EvalQuery } from "./queries";

/**
 * pnpm eval:retrieval: how well search finds what answers each question about the Basket sample
 * (eval/retrieval/basket.ts), for each combination of steps. Recall@10 is the share of what
 * answers found in the top 10; nDCG@10 also counts the order (2 for an answer, 1 for a help);
 * MRR is how high the first answer sits. "In budget" is the share of answers that make it into a
 * 1,000-token pack as a call gets it (with the neighbours of the best hits), and "Tokens" its size.
 * Needs Node 24 (SQLite with full-text search) and downloads the models on first use (about 75 MB).
 */

type Config = { name: string; use: SearchOpts["use"] };

const CONFIGS: Config[] = [
  { name: "words", use: { words: true, meaning: false, links: false } },
  { name: "meaning", use: { words: false, meaning: true, links: false } },
  { name: "words + meaning", use: { words: true, meaning: true, links: false } },
  { name: "words + links", use: { words: true, meaning: false, links: true } },
  { name: "words + meaning + links", use: { words: true, meaning: true, links: true } },
  { name: "… + varied (MMR)", use: { words: true, meaning: true, links: true, varied: true } },
  { name: "… + rerank", use: { words: true, meaning: true, links: true, rerank: true } },
];

const K = 10;
const BUDGET = 1000;

function dcg(gains: number[]): number {
  return gains.reduce((s, g, i) => s + (2 ** g - 1) / Math.log2(i + 2), 0);
}

function score(q: EvalQuery, got: string[]) {
  const rel = q.relevant;
  const top = got.slice(0, K);
  const answers = Object.keys(rel);
  const recall = answers.filter((r) => top.includes(r)).length / answers.length;
  const ideal = dcg(
    Object.values(rel)
      .sort((a, b) => b - a)
      .slice(0, K),
  );
  const ndcg = dcg(top.map((r) => rel[r] ?? 0)) / ideal;
  const first = top.findIndex((r) => rel[r] === 2);
  return { recall, ndcg, mrr: first < 0 ? 0 : 1 / (first + 1) };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}`.padStart(5);

async function main() {
  const dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-eval-")), "Basket");
  const store = await buildBasket(dir);
  const ix = OrgIndex.open(store, process.env.QALAM_NO_MODELS ? null : models());
  try {
    await ix.sync();
    await ix.embedded();
    const s = ix.status();
    console.log(`Basket sample: ${s.pieces} pieces, ${s.links} links, ${s.vectors} vectors · ${QUERIES.length} questions · top ${K}, ${BUDGET}-token packs\n`);
    console.log(`${"".padEnd(26)}Recall@10  nDCG@10    MRR  In budget  Tokens  ms/query`);
    const kinds = [...new Set(QUERIES.map((q) => q.kind))];
    const byKind: Record<string, Record<string, number>> = {};
    for (const c of CONFIGS) {
      const sums = { recall: 0, ndcg: 0, mrr: 0, packed: 0, tokens: 0, ms: 0 };
      for (const q of QUERIES) {
        const t0 = performance.now();
        // Twenty, as a list of results shows; the pack below takes what fits.
        const { hits } = await search(ix, { query: q.q, anchor: q.anchor, product: q.product, limit: 20, use: c.use });
        sums.ms += performance.now() - t0;
        const m = score(
          q,
          hits.map((h) => h.ref),
        );
        sums.recall += m.recall;
        sums.ndcg += m.ndcg;
        sums.mrr += m.mrr;
        // As a call gets it (server/index/search.ts packFor): the hits, with what's next to the best of them.
        const p = pack(
          withNeighbours(ix, hits).map((h) => ({ ref: h.ref, text: h.text, line: h.line, topics: topicsOf(h) })),
          { budget: BUDGET, wholeTop: 6 },
        );
        const sent = new Set(p.items.map((i) => i.ref));
        sums.packed += Object.keys(q.relevant).filter((r) => sent.has(r)).length / Object.keys(q.relevant).length;
        sums.tokens += p.tokens;
        (byKind[c.name] ??= {})[q.kind] = (byKind[c.name][q.kind] ?? 0) + m.ndcg / QUERIES.filter((x) => x.kind === q.kind).length;
      }
      const n = QUERIES.length;
      console.log(`${c.name.padEnd(26)}${pct(sums.recall / n)}     ${pct(sums.ndcg / n)}  ${pct(sums.mrr / n)}  ${pct(sums.packed / n)}    ${String(Math.round(sums.tokens / n)).padStart(5)}  ${(sums.ms / n).toFixed(1).padStart(8)}`);
    }
    console.log(`\nnDCG@10 by kind of question\n${"".padEnd(26)}${kinds.map((k) => k.padStart(11)).join("")}`);
    for (const c of CONFIGS) console.log(`${c.name.padEnd(26)}${kinds.map((k) => pct(byKind[c.name][k] ?? 0).padStart(11)).join("")}`);
    if (process.env.EVAL_MISSES) {
      const best = CONFIGS.find((c) => c.name === process.env.EVAL_MISSES) ?? CONFIGS[4];
      console.log(`\nMissed in the top ${K} (${best.name}):`);
      for (const q of QUERIES) {
        const { hits } = await search(ix, { query: q.q, anchor: q.anchor, product: q.product, limit: K, use: best.use });
        const got = new Set(hits.map((h) => h.ref));
        const missed = Object.keys(q.relevant).filter((r) => !got.has(r));
        if (missed.length) console.log(`  ${q.id}: ${missed.join(", ")}\n    got: ${hits.slice(0, 5).map((h) => h.ref).join(", ")}`);
      }
    }
  } finally {
    ix.close();
    store.dispose();
    await rm(path.dirname(dir), { recursive: true, force: true });
    process.exit(0);
  }
}

void main();
