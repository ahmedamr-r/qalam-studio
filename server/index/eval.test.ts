import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { buildBasket } from "../../eval/retrieval/basket";
import { QUERIES } from "../../eval/retrieval/queries";
import { OrgIndex } from "./indexer";
import { search } from "./search";

const fts5 = (() => {
  try {
    new DatabaseSync(":memory:").exec("create virtual table t using fts5(x)");
    return true;
  } catch {
    return false;
  }
})();

/**
 * A guard on search quality: the retrieval eval's sample and questions with words and links only
 * (no models, so it runs everywhere tests do). pnpm eval:retrieval measures the whole pipeline.
 */
it.skipIf(!fts5)("finds what answers the eval's questions, by words and links, as well as it did", async () => {
  const dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-eval-")), "Basket");
  const store = await buildBasket(dir);
  const ix = OrgIndex.open(store, null);
  try {
    await ix.sync();
    let ndcg = 0;
    for (const q of QUERIES) {
      const { hits } = await search(ix, { query: q.q, anchor: q.anchor, product: q.product, limit: 10 });
      const gain = (g: number) => 2 ** g - 1;
      const dcg = hits.reduce((s, h, i) => s + gain(q.relevant[h.ref] ?? 0) / Math.log2(i + 2), 0);
      const ideal = Object.values(q.relevant)
        .sort((a, b) => b - a)
        .slice(0, 10)
        .reduce((s, g, i) => s + gain(g) / Math.log2(i + 2), 0);
      ndcg += dcg / ideal / QUERIES.length;
    }
    // 0.670 when this was written.
    expect(ndcg).toBeGreaterThan(0.65);
  } finally {
    ix.close();
    store.dispose();
    await rm(path.dirname(dir), { recursive: true, force: true });
  }
});
