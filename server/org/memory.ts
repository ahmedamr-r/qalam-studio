import { z } from "zod";
import type { AskingInT } from "@/asking/wire";
import { foldAsked, linesFor } from "@/memory/fold";
import { pickAnswers, recallBlock, type RecallDecision, type Recalled, type RecallLine, type RecallSubject } from "@/memory/recall";
import { ASKED_FLOWS, sharedHow, type AskedAbout, type AskedFlow, type AskedHow, type AskedForget, type Who } from "@/memory/types";
import { indexFor } from "../index/registry";
import { packedPieces, packFor } from "../index/search";
import { whoAmI } from "../settings";
import { needsNow } from "./needs";
import type { OrgStore } from "./store";

/**
 * Qalam AI's memory of what it asked, in the core (src/memory/ is the pure part): a round's answers
 * remembered as they're given, a line forgotten, and the list people read in the Company panel. Their own
 * answers and the picks they agreed to are the team's (hub/asked.jsonl, with who said them); what they
 * didn't know or left stays on this computer (.qalam/local/asked.jsonl).
 */

const id = z.string().max(120).optional();

export const RememberBody = z.object({
  flow: z.enum(ASKED_FLOWS as [AskedFlow, ...AskedFlow[]]),
  key: z.string().min(1).max(160),
  about: z.object({ product: z.string().max(120).nullable(), board: id, card: id, goal: id, topic: id, source: id }),
  answers: z
    .array(z.object({ qid: z.string().min(1).max(80), q: z.string().max(400), a: z.string().max(1600), how: z.enum(["own", "pick", "unknown", "left"]), code: z.literal(true).optional() }))
    .max(80),
});
export type RememberBodyT = z.infer<typeof RememberBody>;

/** A recall asked for by the window, for a turn it checks itself: which conversation, what it's about, and its words. */
export const RecallBody = RememberBody.pick({ flow: true, key: true, about: true }).extend({ words: z.string().max(4000), broad: z.boolean().optional(), sent: z.string().max(20_000).optional() });

/** A round's answers remembered; what's remembered already as it is isn't written again. How many lines were written. */
export async function rememberRound(store: OrgStore, b: RememberBodyT, opts: { tab?: string; who?: Who; now?: number } = {}): Promise<number> {
  const by = opts.who ?? (await whoAmI());
  const about = Object.fromEntries(Object.entries(b.about).filter(([, v]) => v !== undefined)) as unknown as AskedAbout;
  const lines = linesFor({ flow: b.flow, key: b.key, about, answers: b.answers, by, at: opts.now ?? Date.now(), have: foldAsked(await store.listAsked()) });
  await store.addAsked(lines, opts);
  return lines.shared.length + lines.local.length;
}

/** A line taken off: Qalam AI won't bring it up when it asks. The tombstone goes where the line lives. */
export async function forgetAsked(store: OrgStore, entry: string, opts: { tab?: string; who?: Who; now?: number } = {}): Promise<boolean> {
  const e = foldAsked(await store.listAsked()).entries.find((x) => x.id === entry);
  if (!e) return false;
  const line: AskedForget = { v: 1, forget: entry, at: opts.now ?? Date.now(), by: opts.who ?? (await whoAmI()) };
  await store.addAsked(sharedHow(e.how) ? { shared: [line], local: [] } : { shared: [], local: [line] }, opts);
  return true;
}

const WHOSE: Record<string, string> = { said: "people said", measured: "measured", studied: "studied", read: "read elsewhere", own: "the team's" };
/** Whose words a found piece holds, from its sub: people online, the team's (a dump), measured, read elsewhere, or people said. */
const whoseOf = (type: string, sub: string | null | undefined) => {
  if (type === "page") return "a problem page";
  const s = sub ?? "";
  return s.startsWith("online:") ? "people online" : s.startsWith("dump:") ? "the team's" : (WHOSE[s.split(":")[0]] ?? "people said");
};

/** Their material near the subject: quotes and page lines, by words, meaning and links, around its card. None without an index. */
async function materialFor(store: OrgStore, s: RecallSubject): Promise<RecallLine[]> {
  if (!s.words.trim()) return [];
  let ix: ReturnType<typeof indexFor>;
  try {
    ix = indexFor(store);
  } catch {
    return [];
  }
  await ix.settled();
  const anchor = s.about.board && s.about.card ? `hub:card:${s.about.board}:${s.about.card}` : undefined;
  const p = await packFor(ix, { query: s.words.slice(0, 2000), ...(anchor ? { anchor } : {}), product: s.about.product, budget: 1200, wholeTop: 0, types: ["quote", "page"] });
  return packedPieces(p).map((x) => ({ text: x.text, from: x.title ?? "a source", whose: whoseOf(x.type, x.sub) }));
}

/** For a flow that starts broad (a plan, a scan, finding a goal or a problem): what the best-backed problem pages hold as known, whatever their words. */
async function pagesFor(store: OrgStore, s: RecallSubject): Promise<RecallLine[]> {
  const { needs } = await needsNow(store);
  const product = s.about.product ?? null;
  const top = needs.filter((n) => !product || !n.products.length || n.products.includes(product)).slice(0, 3);
  const pages = await Promise.all(top.map((n) => store.getTopic(n.topic).catch(() => null)));
  return pages.flatMap((t, i) => (t ? t.lines.filter((l) => l.section === "know").slice(0, 2).map((l) => ({ text: l.text, from: top[i].title })) : []));
}

/** What's decided about the card or goal: newest first, taken back ones left out. */
function decisionsFor(store: OrgStore, s: RecallSubject): RecallDecision[] {
  if (!s.about.card && !s.about.goal) return [];
  return store
    .listDecisions({ ...(s.about.card ? { card: s.about.card } : {}), ...(s.about.goal && !s.about.card ? { goal: s.about.goal } : {}) })
    .filter((d) => !d.undone)
    .sort((a, b) => b.at - a.at)
    .slice(0, 3)
    .map((d) => ({ at: d.at, what: d.what, ...(d.why ? { why: d.why } : {}) }));
}

/**
 * What's already known for a turn, with no tokens: the memory's answers that bear on its subject, their
 * material found by search, the problem pages' known lines (`broad` flows), and decisions. With no index
 * (Node 22) it works from the memory alone; any trouble with one kind leaves the others.
 */
export async function recall(store: OrgStore, s: RecallSubject, o: { broad?: boolean; sent?: string; who?: Who; now?: number } = {}): Promise<Recalled> {
  const now = o.now ?? Date.now();
  const me = o.who ?? (await whoAmI());
  const { entries } = foldAsked(await store.listAsked());
  const [material, pages] = await Promise.all([materialFor(store, s).catch(() => [] as RecallLine[]), o.broad ? pagesFor(store, s).catch(() => [] as RecallLine[]) : Promise.resolve([] as RecallLine[])]);
  return recallBlock({ answers: pickAnswers(entries, s, { me: me.id, now }), material, pages, decisions: decisionsFor(store, s), me: me.id, solo: store.info.shape === "solo", now, ...(o.sent ? { sent: o.sent } : {}) });
}

const NOTHING: Recalled = { block: "", hay: "", ids: [], items: [] };

/**
 * Recall for a turn, from what the window sent about its conversation (`asking.memory`): what to leave
 * out as read already, and what it's about. A conversation the memory doesn't know is recalled for as
 * new. Any trouble recalls nothing, and the turn goes on as before.
 */
export async function recallFor(store: OrgStore, a: Pick<AskingInT, "memory">, o: { flow: AskedFlow; words: string; broad?: boolean; sent?: string; about?: AskedAbout }): Promise<Recalled> {
  const m = a.memory;
  const about = (m ? Object.fromEntries(Object.entries(m.about).filter(([, v]) => v !== undefined)) : (o.about ?? { product: null })) as AskedAbout;
  const subject: RecallSubject = { flow: m?.flow ?? o.flow, key: m?.key ?? "", about, words: o.words };
  return recall(store, subject, { ...(o.broad ? { broad: true } : {}), ...(o.sent ? { sent: o.sent } : {}) }).catch(() => NOTHING);
}

/** A remembered answer as people read it: whose (theirs, or a teammate's by name where they gave one), where and when, and whether the team sees it. */
export interface MemoryLine {
  id: string;
  at: number;
  flow: AskedFlow;
  q: string;
  a: string;
  how: AskedHow;
  mine: boolean;
  name?: string;
  shared: boolean;
  about: AskedAbout;
}

export async function listMemory(store: OrgStore, o: { who?: Who } = {}): Promise<{ entries: MemoryLine[] }> {
  const me = o.who ?? (await whoAmI());
  const { entries } = foldAsked(await store.listAsked());
  return {
    entries: entries.map((e) => {
      const mine = e.by.id === me.id;
      return { id: e.id, at: e.at, flow: e.flow, q: e.q, a: e.a, how: e.how, mine, ...(!mine && e.by.name ? { name: e.by.name } : {}), shared: sharedHow(e.how), about: e.about };
    }),
  };
}
