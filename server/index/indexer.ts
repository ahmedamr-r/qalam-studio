import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { boardPieces, contextPieces, decisionPieces, meaningText, sourcePieces, topicPieces, type Built, type HubPiece, type Names } from "@/hub/pieces";
import { fold } from "@/hub/words";
import type { Models } from "../models/client";
import { contentHash, stableStringify } from "../org/fsx";
import type { OrgEvent, OrgStore } from "../org/store";
import { openIndexDb, tx } from "./db";

/**
 * One organization's search index, kept current with its folder. Each thing the folder holds (a
 * board, a source, the decision log, a product, about.md, a topic page) is built into pieces and links
 * (src/hub/pieces.ts) under its key; only what changed is written again, so an edit to one board
 * costs that board. Links that go away are kept, marked when they stopped (expired_at). The cards
 * a piece backs become its "topics", searched with it. Vectors for meaning search are made in the
 * background by the models process; until then, words and links answer.
 */

export interface PieceRow {
  id: number;
  ref: string;
  key: string;
  type: HubPiece["type"];
  sub: string | null;
  text: string;
  line: string;
  topics: string;
  title: string | null;
  product: string | null;
  board: string | null;
  card: string | null;
  source: string | null;
  speaker: string | null;
  stage: string | null;
  at: number;
  hash: string;
}

export interface IndexStatus {
  pieces: number;
  links: number;
  /** Pieces with an up-to-date vector for the current embedder. */
  vectors: number;
  /** Still catching up with the folder. */
  building: boolean;
}

const TOPIC_SEP = " · ";
export const topicsOf = (row: Pick<PieceRow, "topics">) => (row.topics ? row.topics.split(TOPIC_SEP) : []);
const FIELDS = ["type", "sub", "text", "line", "title", "product", "board", "card", "source", "speaker", "stage", "at"] as const;
const same = (row: PieceRow, p: HubPiece) => FIELDS.every((f) => (row[f] ?? null) === ((p as unknown as Record<string, unknown>)[f] ?? null));
const vecBytes = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

export class OrgIndex {
  private queue = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;
  private embedding: Promise<void> | null = null;
  /** Bumps whenever vectors or pieces change: the in-memory matrix reloads. */
  private version = 0;
  private matrix: { version: number; model: string; ids: number[]; dims: number; data: Float32Array } | null = null;
  private stop: () => void;
  closed = false;

  constructor(
    readonly store: OrgStore,
    readonly db: DatabaseSync,
    readonly models: Models | null,
  ) {
    const on = (e: OrgEvent) => this.heard(e);
    const close = () => this.close();
    store.events.on("event", on);
    store.events.once("dispose", close);
    this.stop = () => {
      store.events.off("event", on);
      store.events.off("dispose", close);
    };
  }

  static open(store: OrgStore, models: Models | null, file = path.join(store.dir, ".qalam", "index.sqlite")): OrgIndex {
    return new OrgIndex(store, openIndexDb(file), models);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stop();
    if (this.timer) clearTimeout(this.timer);
    // Let a write in progress finish first.
    void this.chain.finally(() => this.db.close());
  }

  status(): IndexStatus {
    const one = (sql: string, ...args: (string | number)[]) => (this.db.prepare(sql).get(...args) as { n: number }).n;
    return {
      pieces: one("select count(*) n from pieces"),
      links: one("select count(*) n from edges where expired_at is null"),
      vectors: this.models ? one("select count(*) n from vectors v join pieces p on p.id = v.id and p.hash = v.hash where v.model = ?", this.models.embedder) : 0,
      building: this.pending > 0 || this.queue.size > 0 || !!this.embedding,
    };
  }

  // -------------------------------------------------------------------------
  // Keeping up with the folder

  /** Build everything that changed since the index last saw the folder. */
  sync(): Promise<void> {
    return this.run(async () => {
      const names = await this.names();
      const keys = await this.keys();
      const had = (this.db.prepare("select key from built").all() as { key: string }[]).map((r) => r.key);
      for (const k of had) if (!keys.has(k)) this.apply(k, null);
      for (const k of keys) await this.update(k, names);
    });
  }

  /** Wait until what was heard so far is in the index (vectors aside). */
  async settled(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.flush();
    }
    await this.chain;
  }

  /** Wait for vectors too. */
  async embedded(): Promise<void> {
    await this.settled();
    while (this.embedding) await this.embedding;
  }

  private run(fn: () => Promise<void>): Promise<void> {
    this.pending++;
    const next = this.chain.then(fn).finally(() => {
      this.pending--;
      this.embedSoon();
    });
    this.chain = next.catch(() => {});
    return next;
  }

  private heard(e: OrgEvent) {
    if (e.kind === "project") this.queue.add(`board:${e.id}`);
    else if (e.kind === "source") this.queue.add(`source:${e.id}`);
    else if (e.kind === "decision") this.queue.add("decisions");
    else if (e.kind === "topic") this.queue.add(`topic:${e.id}`);
    else if (e.kind === "about" || e.kind === "org") this.queue.add("context:org");
    // A product's name is in the lines of everything for it: look at everything again.
    else if (e.kind === "product") this.queue.add("*");
    else return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }

  private flush() {
    this.timer = null;
    const keys = [...this.queue];
    this.queue.clear();
    if (keys.includes("*")) return void this.sync().catch(() => {});
    void this.run(async () => {
      const names = await this.names();
      for (const k of keys) await this.update(k, names);
    }).catch(() => {});
  }

  private async names(): Promise<Names> {
    const products = new Map((await this.store.listProducts()).map((p) => [p.id, p.name]));
    return { product: (id) => products.get(id) };
  }

  private async keys(): Promise<Set<string>> {
    const keys = new Set<string>(["decisions", "context:org"]);
    for (const p of this.store.listProjects()) if (p.type === "discovery") keys.add(`board:${p.id}`);
    for (const s of await this.store.listSources()) keys.add(`source:${s.id}`);
    for (const p of await this.store.listProducts()) keys.add(`context:${p.id}`);
    for (const t of await this.store.listTopics()) keys.add(`topic:${t.id}`);
    return keys;
  }

  /** What a key holds now (null: nothing, it's gone). */
  private async build(key: string, names: Names): Promise<Built | null> {
    const [kind, id] = [key.slice(0, key.indexOf(":") < 0 ? key.length : key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    const store = this.store;
    switch (kind) {
      case "board": {
        const p = store.getProject(id)?.record;
        if (!p || p.type !== "discovery") return null;
        return boardPieces(p, (await store.getDoc(id))?.doc ?? null, names);
      }
      case "source": {
        const s = await store.getSource(id);
        return s ? sourcePieces(s, names) : null;
      }
      case "decisions":
        return decisionPieces(store.listDecisions(), (board) => store.getProject(board)?.record.product, names);
      case "topic": {
        const t = await store.getTopic(id);
        return t ? topicPieces(t, names) : null;
      }
      case "context": {
        if (id === "org") return contextPieces({ product: null, name: store.info.name, at: store.info.createdAt }, await store.getAbout());
        const p = (await store.listProducts()).find((x) => x.id === id);
        return p ? contextPieces({ product: p.id, name: p.name, at: 0 }, p) : null;
      }
    }
    return null;
  }

  private async update(key: string, names: Names) {
    if (this.closed) return;
    const built = await this.build(key, names);
    const hash = built ? contentHash(stableStringify(built)) : null;
    const was = this.db.prepare("select hash from built where key = ?").get(key) as { hash: string } | undefined;
    if (was?.hash === hash || (!was && !built)) return;
    this.apply(key, built, hash ?? undefined);
  }

  /** Write a key's pieces, links and entities: only what changed. */
  private apply(key: string, b: Built | null, hash?: string) {
    if (this.closed) return;
    const db = this.db;
    const now = Date.now();
    tx(db, () => {
      const old = new Map((db.prepare("select * from pieces where key = ?").all(key) as unknown as PieceRow[]).map((r) => [r.ref, r]));
      const next = new Map((b?.pieces ?? []).map((p) => [p.ref, p]));
      /** Pieces whose topics may have changed. */
      const touched = new Set<string>();
      for (const [ref, r] of old)
        if (!next.has(ref)) {
          db.prepare("delete from words where rowid = ?").run(r.id);
          db.prepare("delete from pieces where id = ?").run(r.id);
        }
      const upsert = db.prepare(
        `insert into pieces (ref, key, type, sub, text, line, topics, title, product, board, card, source, speaker, stage, at, hash)
         values (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(ref) do nothing returning id`,
      );
      for (const p of next.values()) {
        const r = old.get(p.ref);
        if (r && same(r, p)) continue;
        const vals = [p.type, p.sub ?? null, p.text, p.line, p.title ?? null, p.product, p.board ?? null, p.card ?? null, p.source ?? null, p.speaker ?? null, p.stage ?? null, p.at] as const;
        if (r) {
          db.prepare("update pieces set type = ?, sub = ?, text = ?, line = ?, title = ?, product = ?, board = ?, card = ?, source = ?, speaker = ?, stage = ?, at = ? where id = ?").run(...vals, r.id);
          db.prepare("update words set text = ?, line = ? where rowid = ?").run(fold(p.text), fold(p.line), r.id);
        } else {
          // Another key may hold the same ref (a copied file): the first one keeps it.
          const row = upsert.get(p.ref, key, ...vals, "") as { id: number } | undefined;
          if (!row) continue;
          db.prepare("insert into words (rowid, text, line, topics) values (?, ?, ?, '')").run(row.id, fold(p.text), fold(p.line));
        }
        touched.add(p.ref);
        // A card's title is its evidence's topic.
        if (p.type === "card") for (const e of db.prepare("select dst from edges where src = ? and kind in ('backs', 'against') and expired_at is null").all(p.ref) as { dst: string }[]) touched.add(e.dst);
      }
      // Links: the ones gone are marked when they stopped; new ones start now.
      const edgeKey = (src: string, dst: string, kind: string) => `${src}\u0000${dst}\u0000${kind}`;
      const want = new Map((b?.edges ?? []).map((e) => [edgeKey(e.from, e.to, e.kind), e]));
      for (const e of db.prepare("select id, src, dst, kind from edges where key = ? and expired_at is null").all(key) as { id: number; src: string; dst: string; kind: string }[]) {
        const k = edgeKey(e.src, e.dst, e.kind);
        if (want.has(k)) want.delete(k);
        else {
          db.prepare("update edges set expired_at = ? where id = ?").run(now, e.id);
          touched.add(e.dst);
        }
      }
      for (const e of want.values()) {
        db.prepare("insert into edges (key, src, dst, kind, valid_at, created_at) values (?, ?, ?, ?, ?, ?)").run(key, e.from, e.to, e.kind, e.at ?? null, now);
        touched.add(e.to);
      }
      db.prepare("delete from entities where key = ?").run(key);
      for (const en of b?.entities ?? []) db.prepare("insert into entities (ref, key, kind, name) values (?, ?, ?, ?) on conflict(ref) do update set key = excluded.key, kind = excluded.kind, name = excluded.name").run(en.ref, key, en.kind, en.name);
      this.retopic(touched);
      if (b && hash) db.prepare("insert into built (key, hash, at) values (?, ?, ?) on conflict(key) do update set hash = excluded.hash, at = excluded.at").run(key, hash, now);
      else db.prepare("delete from built where key = ?").run(key);
    });
    this.version++;
  }

  /** The cards each piece backs or speaks against, as its topics; and what meaning search reads changed with them. */
  private retopic(refs: Set<string>) {
    const db = this.db;
    const titles = db.prepare(
      `select distinct p.title t from edges e join pieces p on p.ref = e.src
       where e.dst = ? and e.kind in ('backs', 'against') and e.expired_at is null and p.title is not null order by p.title`,
    );
    for (const ref of refs) {
      const row = db.prepare("select id, type, sub, line, text, title, topics, hash from pieces where ref = ?").get(ref) as Pick<PieceRow, "id" | "type" | "sub" | "line" | "text" | "title" | "topics" | "hash"> | undefined;
      if (!row) continue;
      const list = (titles.all(ref) as { t: string }[]).map((x) => x.t);
      const topics = list.join(TOPIC_SEP);
      const hash = contentHash(meaningText({ ...row, sub: row.sub ?? undefined }, list));
      if (topics === row.topics && hash === row.hash) continue;
      db.prepare("update pieces set topics = ?, hash = ? where id = ?").run(topics, hash, row.id);
      db.prepare("update words set topics = ? where rowid = ?").run(fold(topics), row.id);
    }
  }

  // -------------------------------------------------------------------------
  // Vectors, in the background

  private embedSoon() {
    if (!this.models || this.embedding || this.closed) return;
    this.embedding = this.embedAll().finally(() => {
      this.embedding = null;
    });
  }

  private async embedAll() {
    const models = this.models!;
    const db = this.db;
    for (;;) {
      if (this.closed) return;
      const rows = db
        .prepare("select p.id, p.type, p.sub, p.line, p.text, p.title, p.topics, p.hash from pieces p left join vectors v on v.id = p.id where v.id is null or v.hash != p.hash or v.model != ? limit 32")
        .all(models.embedder) as Pick<PieceRow, "id" | "type" | "sub" | "line" | "text" | "title" | "topics" | "hash">[];
      if (!rows.length) return;
      let vecs: Float32Array[];
      try {
        vecs = await models.embed(
          rows.map((r) => meaningText({ ...r, sub: r.sub ?? undefined }, topicsOf(r))),
          "doc",
        );
      } catch {
        // The models can't run now: words and links still answer, and the next change tries again.
        return;
      }
      if (this.closed) return;
      tx(db, () => {
        rows.forEach((r, i) => {
          // Changed meanwhile: its new words get their own vector on the next round.
          if (!db.prepare("select 1 from pieces where id = ? and hash = ?").get(r.id, r.hash)) return;
          db.prepare("insert into vectors (id, model, hash, vec) values (?, ?, ?, ?) on conflict(id) do update set model = excluded.model, hash = excluded.hash, vec = excluded.vec").run(r.id, models.embedder, r.hash, vecBytes(vecs[i]));
        });
      });
      this.version++;
      await new Promise((r) => setImmediate(r));
    }
  }

  // -------------------------------------------------------------------------
  // Reading

  piecesByRef(refs: string[]): Map<string, PieceRow> {
    const out = new Map<string, PieceRow>();
    const get = this.db.prepare("select * from pieces where ref = ?");
    for (const ref of refs) {
      const row = get.get(ref) as unknown as PieceRow | undefined;
      if (row) out.set(ref, row);
    }
    return out;
  }

  /** Pieces whose words match, best first (BM25: the words weigh most, then the cards they're about; the line, mostly names and dates, least). */
  words(query: string, limit = 50): string[] {
    return (
      this.db.prepare("select p.ref from words w join pieces p on p.id = w.rowid where words match ? order by bm25(words, 1.0, 0.15, 0.6) limit ?").all(query, limit) as { ref: string }[]
    ).map((r) => r.ref);
  }

  /** Pieces nearest in meaning to a unit vector, best first, with their similarity. */
  nearest(v: Float32Array, limit = 50, min = 0): { ref: string; sim: number }[] {
    const m = this.vectors();
    if (!m || m.dims !== v.length) return [];
    const scores: { id: number; sim: number }[] = [];
    for (let i = 0; i < m.ids.length; i++) {
      let s = 0;
      const o = i * m.dims;
      for (let j = 0; j < m.dims; j++) s += m.data[o + j] * v[j];
      if (s >= min) scores.push({ id: m.ids[i], sim: s });
    }
    scores.sort((a, b) => b.sim - a.sim);
    const top = scores.slice(0, limit);
    const refOf = this.db.prepare("select ref from pieces where id = ?");
    return top.map((s) => ({ ref: (refOf.get(s.id) as { ref: string }).ref, sim: s.sim }));
  }

  /** The vectors of some pieces (for keeping results varied). */
  vectorsOf(refs: string[]): Map<string, Float32Array> {
    const out = new Map<string, Float32Array>();
    if (!this.models) return out;
    const get = this.db.prepare("select v.vec from vectors v join pieces p on p.id = v.id and p.hash = v.hash where p.ref = ? and v.model = ?");
    for (const ref of refs) {
      const row = get.get(ref, this.models.embedder) as { vec: Uint8Array } | undefined;
      if (row) out.set(ref, new Float32Array(new Uint8Array(row.vec).buffer));
    }
    return out;
  }

  private vectors() {
    if (!this.models) return null;
    const model = this.models.embedder;
    if (this.matrix?.version === this.version && this.matrix.model === model) return this.matrix;
    const rows = this.db.prepare("select v.id, v.vec from vectors v join pieces p on p.id = v.id and p.hash = v.hash where v.model = ?").all(model) as { id: number; vec: Uint8Array }[];
    const dims = rows.length ? rows[0].vec.byteLength / 4 : 0;
    const data = new Float32Array(rows.length * dims);
    rows.forEach((r, i) => data.set(new Float32Array(new Uint8Array(r.vec).buffer), i * dims));
    this.matrix = { version: this.version, model, ids: rows.map((r) => r.id), dims, data };
    return this.matrix;
  }

  /** Every piece, and the links between pieces that hold now (the Knowledge hub's graph). */
  everything(): { pieces: PieceRow[]; links: { from: string; to: string; kind: string }[] } {
    return {
      pieces: this.db.prepare("select * from pieces order by at").all() as unknown as PieceRow[],
      links: this.db.prepare("select src as \"from\", dst as \"to\", kind from edges where expired_at is null").all() as { from: string; to: string; kind: string }[],
    };
  }

  /** The links of a piece that hold now, both ways. */
  links(ref: string): { ref: string; kind: string; out: boolean }[] {
    const rows = this.db.prepare("select src, dst, kind from edges where (src = ? or dst = ?) and expired_at is null").all(ref, ref) as { src: string; dst: string; kind: string }[];
    return rows.map((r) => (r.src === ref ? { ref: r.dst, kind: r.kind, out: true } : { ref: r.src, kind: r.kind, out: false }));
  }
}
