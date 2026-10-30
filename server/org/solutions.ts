import { nanoid } from "nanoid";
import { solutionsCall } from "@/ai/solutions";
import { structured } from "@/ai/server";
import { isOstCard } from "@/doc/board";
import { quotePiece } from "@/discovery/sources";
import { sanitizeSolutions, solutionsMaterial, type Drafted, type SolutionsFile, type SolutionsInput } from "@/discovery/solutions";
import { foldBearings } from "@/goals/bearings";
import { metricLine } from "@/goals/goals-md";
import { goalById } from "@/goals/tree";
import { isEvidence, sameWords, type Topic } from "@/hub/topics";
import { indexFor } from "../index/registry";
import { showsUp } from "../index/search";
import { NotFoundError, type OrgStore } from "./store";

/**
 * Drafting solutions for a problem, in the core (src/discovery/solutions.ts): the material is
 * gathered here (the problem's page and the words it rests on, the goals it bears on and what
 * others report for them, the product's steps, what's on its boards and the person's ideas), one
 * call proposes, code keeps what it can stand behind. A page's drafts are kept with it
 * (hub/solutions/<topic>.json) until they're decided; a board takes them as proposals to review.
 */

/** A card on a board asking, with or without a page of its own: its words, and what's under it already. */
export interface SolutionsCard {
  title: string;
  evidence: { text: string; piece?: string; sourceId?: string; sourceTitle?: string; kind: string }[];
  children: { title: string; kind: "solution" | "test" }[];
}

/** Words that say nothing about what a problem is. */
const FILLER = new Set("about after also because before being could does doing each from have into just like more most much only other over same should some such than that their them then there these they this those very what when where which while will with would your".split(" "));
const words = (s: string) => new Set(sameWords(s).split(" ").filter((w) => w.length > 3 && !FILLER.has(w)));
/** How many of the problem's words a text shares. */
const overlap = (near: Set<string>, text: string) => [...words(text)].filter((w) => near.has(w)).length;

/** The material for a problem: its page when it has one, else the card's own words. */
async function solutionsInput(store: OrgStore, topic: Topic | null, card: SolutionsCard | null): Promise<SolutionsInput> {
  const title = topic?.title ?? card?.title ?? "";
  const near = words([title, ...(topic?.lines.map((l) => l.text) ?? [])].join(" "));
  const lines = (topic?.lines ?? []).map((l) => ({ id: l.id, section: l.section, text: l.text, cites: l.cites }));
  const pieces: SolutionsInput["pieces"] = [];
  const cards: SolutionsInput["cards"] = [...(card?.children ?? [])];
  if (topic) {
    try {
      const ix = indexFor(store);
      await ix.settled();
      const refs = [...new Set(topic.lines.filter((l) => l.section !== "open").flatMap((l) => l.cites))];
      for (const [ref, row] of ix.piecesByRef(refs)) {
        if (row.type !== "quote" && row.type !== "evidence") continue;
        const s = row.source ? await store.getSource(row.source) : null;
        pieces.push({ ref, text: row.text, label: s?.title ?? row.title ?? "", source: row.source, evidence: isEvidence(row) });
      }
      // What its boards have under it already.
      for (const shown of showsUp(ix, topic.title, refs).filter((x) => x.kind === "opportunity")) {
        const doc = (await store.getDoc(shown.board))?.doc;
        const node = doc?.nodes[shown.card];
        if (!doc || !isOstCard(node)) continue;
        for (const id of node.children) {
          const child = doc.nodes[id];
          const k = isOstCard(child) ? child.meta.ost.kind : null;
          if (isOstCard(child) && (k === "solution" || k === "test") && !cards.some((c) => c.title === child.meta.ost.title)) cards.push({ title: child.meta.ost.title, kind: k });
        }
      }
    } catch {
      // No index here: the page's lines alone.
    }
  } else
    for (const [i, e] of (card?.evidence ?? []).entries())
      pieces.push({ ref: e.piece ?? `card:${i}`, text: e.text, label: e.sourceTitle ?? (e.kind === "quote" ? "A source" : "The team's words"), source: e.sourceId ?? null, evidence: e.kind === "quote" });

  // The goals it bears on, and what others report for them.
  const tree = await store.getGoals();
  const goals: SolutionsInput["goals"] = [];
  const claims: SolutionsInput["claims"] = [];
  if (topic)
    for (const b of foldBearings(await store.listBearingLog()).links.filter((l) => l.need === topic.id)) {
      const g = goalById(tree, b.goal);
      if (!g || g.status !== "active") continue;
      goals.push({ id: g.id, title: g.title, metric: g.metric ? `${g.metric.name ? `${g.metric.name}: ` : ""}${metricLine(g.metric)}` : null, how: b.how || null });
      for (const c of ((await store.getGoalWork(g.id)).outside?.claims ?? []).slice(0, 3)) claims.push({ id: c.id, who: c.who, what: c.what, quote: c.quote });
    }

  // The product's steps nearest the problem's words.
  const products = topic?.products ?? [];
  const steps = (await store.listMaps())
    .filter((m) => !products.length || !m.product || products.includes(m.product))
    .flatMap((m) => m.flows.flatMap((f) => f.steps.map((s) => ({ ref: `${m.key}/${s.key}`, flow: f.name, title: s.title, events: s.events, score: overlap(near, `${s.title} ${f.name} ${s.events.join(" ")}`) }))))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ score: _s, ...s }) => s);

  // Their own ideas: a brain dump's ideas that share at least two of the problem's words, the nearest first.
  const ideas: (SolutionsInput["ideas"][number] & { score: number })[] = [];
  for (const s of await store.listSources())
    for (const q of s.kind === "dump" ? s.quotes : []) {
      const score = q.role === "idea" ? overlap(near, q.text) : 0;
      if (score >= 2) ideas.push({ ref: quotePiece(q.id), text: q.text, source: s.id, label: s.title, score });
    }
  ideas.sort((a, b) => b.score - a.score);

  return { problem: { title, topic: topic?.id ?? null }, lines, pieces, goals, claims, steps, cards, ideas: ideas.map(({ score: _s, ...i }) => i) };
}

/** One call drafting solutions for a problem (a page, or a card on a board); code keeps what it can stand behind. */
export async function draftSolutions(store: OrgStore, req: { topic?: string; card?: SolutionsCard }, emit?: (label: string) => void, opts: { tab?: string } = {}): Promise<Drafted> {
  const topic = req.topic ? await store.getTopic(req.topic) : null;
  if (req.topic && !topic) throw new NotFoundError("No such problem");
  if (!topic && !req.card?.title.trim()) throw new NotFoundError("No problem to draft for");
  emit?.("Reading what the problem rests on");
  const input = await solutionsInput(store, topic, req.card ?? null);
  const m = solutionsMaterial(input);
  emit?.("Qalam AI is drafting ways to solve it");
  const { data, model } = await structured<unknown>(solutionsCall(m));
  const now = Date.now();
  const dropped: { why: string; item: unknown }[] = [];
  const { drafts, note } = sanitizeSolutions(data, m, { now, id: () => nanoid(10) }, (why, item) => dropped.push({ why, item }));
  // The call's trace: what it was sent (by id), what it answered, what code kept and left out, and why.
  await store
    .putTrace({ id: nanoid(10), projectId: "solutions", kind: "solutions", at: now, ...(model ? { model } : {}), topic: topic?.id ?? null, sent: { lines: [...m.lines.keys()].length, pieces: [...m.pieces].map(([ref, p]) => ({ ref, piece: p.ref })), goals: [...m.goals].map(([ref, g]) => ({ ref, goal: g.id })), ideas: [...m.ideas].map(([ref, i]) => ({ ref, piece: i.ref })) }, answer: data, kept: drafts.length, dropped } as { id: string; projectId: string })
    .catch(() => {});
  if (topic) await store.changeSolutions(topic.id, (): SolutionsFile => ({ qalam: "solutions/1", topic: topic.id, at: now, ...(model ? { model } : {}), note, drafts, decided: {} }), opts);
  // Where each piece lives, so a board can attach the words.
  const quotes: Drafted["quotes"] = {};
  for (const p of [...input.pieces, ...input.ideas]) if (p.source && p.ref.startsWith("hub:quote:")) quotes[p.ref] = { sourceId: p.source, quoteId: p.ref.slice("hub:quote:".length) };
  return { topic: topic?.id ?? null, drafts, note, quotes };
}

/** A page's drafts as they're kept, with where their words live. */
export async function solutionsView(store: OrgStore, topicId: string): Promise<(SolutionsFile & { quotes: Drafted["quotes"] }) | null> {
  const f = await store.getSolutions(topicId);
  if (!f) return null;
  const refs = new Set(f.drafts.flatMap((d) => [...d.cites.pieces, ...(d.idea ? [d.idea.ref] : [])]));
  const quotes: Drafted["quotes"] = {};
  try {
    for (const [ref, row] of indexFor(store).piecesByRef([...refs])) if (row.source && ref.startsWith("hub:quote:")) quotes[ref] = { sourceId: row.source, quoteId: ref.slice("hub:quote:".length) };
  } catch {
    // No index here: the drafts show without their words' sources.
  }
  for (const d of f.drafts) if (d.idea?.source && d.idea.ref.startsWith("hub:quote:")) quotes[d.idea.ref] = { sourceId: d.idea.source, quoteId: d.idea.ref.slice("hub:quote:".length) };
  return { ...f, quotes };
}

/** A person accepted a draft (it's on a board now) or discarded it. */
export async function decideSolution(store: OrgStore, topicId: string, draft: string, decision: "accepted" | "discarded", opts: { tab?: string } = {}) {
  const f = await store.getSolutions(topicId);
  if (!f?.drafts.some((d) => d.id === draft)) throw new NotFoundError("No such draft");
  await store.changeSolutions(topicId, (cur) => (cur ? { ...cur, decided: { ...cur.decided, [draft]: decision } } : cur), opts);
}
