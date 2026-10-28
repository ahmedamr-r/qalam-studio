import type { Decision } from "@/decisions/model";
import type { Doc } from "@/doc/schema";
import { backing } from "@/discovery/evidence";
import type { OstCard } from "@/discovery/types";
import { factHash } from "@/knowledge/refs";
import { cardRef } from "./pieces";
import { needEvidence, type PieceFacts, type ShownOn } from "./needs";
import { WORK_LABEL, workKey, type WorkStatus } from "@/connectors/work";
import { sameTopic, type Topic } from "./topics";
import type { GoalTree } from "@/goals/types";

/**
 * What needs a look (pure): checks code runs over the organization's boards, decisions and topic
 * pages at no token cost. Each finds something a product team should hear about: what customers
 * said against what the team believes (Qalam AI's disputes on the topic pages), needs customers
 * keep raising that no board has, the same need on two boards, a parked or dropped card that new
 * evidence now backs, a test that's run too long, a solution being built on a risky assumption
 * nothing tests, an outcome whose number nobody has updated. Every notice has a stable key, made
 * of what it's about and how strong it is: dismissed, it stays dismissed until it grows.
 */

export type NoticeKind = "disputed" | "pattern" | "same-need" | "revisit" | "stale-test" | "untested" | "metric" | "orphan" | "review" | "placed" | "work-drift";

export interface Notice {
  /** Stable: the same finding keeps its key, so a dismissed one never comes back. */
  key: string;
  kind: NoticeKind;
  /** One line: what needs a look. */
  title: string;
  /** Why: what it rests on. */
  why: string;
  /** When it became true, or its newest evidence (newer than your last visit: new). */
  at: number;
  board?: string;
  card?: string;
  topic?: string;
  /** The goal it's about (goals.md). */
  goal?: string;
  /** The goals it bears on: its own, its card's, or its page's links (filled in by the server). */
  goals?: string[];
  /** The other card (the same need on two boards). */
  other?: { board: string; card: string };
  /** The pieces it rests on. */
  refs?: string[];
  /** The products it's about (none: the whole organization). */
  products: string[];
}

export const NOTICE_LABEL: Record<NoticeKind, string> = {
  disputed: "Said against",
  pattern: "On no board",
  "same-need": "On two boards",
  revisit: "Revisit",
  "stale-test": "Test",
  untested: "Untested",
  metric: "Goal",
  orphan: "Page",
  review: "Qalam AI review",
  placed: "To review",
  "work-drift": "Work",
};

/** How long before a running test, or an outcome's number, needs a look. */
export const STALE_TEST_DAYS = 14;
export const STALE_METRIC_DAYS = 21;
const DAY = 86_400_000;

export interface CheckBoard {
  id: string;
  name: string;
  product: string | null;
  createdAt: number;
  doc: Doc | null;
}

export type { ShownOn } from "./needs";

export interface CheckInput {
  now: number;
  boards: CheckBoard[];
  decisions: Decision[];
  topics: Topic[];
  /** The search index is here: what pages cite, and the cards it backs, are known. */
  indexed: boolean;
  /** The cards on boards that rest on each page's pieces, by page. */
  shows: Map<string, ShownOn[]>;
  /** What the index has of the pieces pages cite (a piece not in it is gone). */
  pieces: Map<string, PieceFacts>;
  /** Cards linked as the same need ("<ref>|<ref>", sorted). */
  linked: Set<string>;
  /** Proposals waiting on a board from material added to the organization (a capture, the inbox). */
  placed?: { board: string; sourceId: string; title: string; count: number; at: number }[];
  /** Where the work linked to solutions stands, as the tools last said (by connector:ref). */
  work?: Record<string, WorkStatus>;
  /** The goals (goals.md): a goal's number is checked there, not on the board's copy of it. */
  goals?: GoalTree;
}

type Node = { parentId?: string | null; meta?: { ost?: OstCard } };

interface CardAt {
  board: CheckBoard;
  id: string;
  card: OstCard;
  /** The nearest card above it. */
  parent: string | null;
}

/** Every card on the boards, with the card above it. */
export function cardsOf(boards: CheckBoard[]): CardAt[] {
  const out: CardAt[] = [];
  for (const b of boards) {
    const nodes = (b.doc?.nodes ?? {}) as unknown as Record<string, Node>;
    for (const [id, n] of Object.entries(nodes)) {
      const card = n.meta?.ost;
      if (!card) continue;
      let parent = n.parentId ?? null;
      while (parent && !nodes[parent]?.meta?.ost) parent = nodes[parent]?.parentId ?? null;
      out.push({ board: b, id, card, parent });
    }
  }
  return out;
}

const q = (t: string) => `“${t.replace(/\s+/g, " ").trim() || "Untitled"}”`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const date = (at: number) => new Date(at).toLocaleDateString("en", { month: "short", day: "numeric" });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** Strength in steps (1, 2, 4, 8…): a finding dismissed at one step comes back at the next. */
const tier = (n: number) => 2 ** Math.floor(Math.log2(Math.max(1, n)));
export const pairKey = (a: string, b: string) => [a, b].sort().join("|");
const productsOf = (b: CheckBoard) => (b.product ? [b.product] : []);

export function runChecks(x: CheckInput): Notice[] {
  const out: Notice[] = [];
  const cards = cardsOf(x.boards);
  const byRef = new Map(cards.map((c) => [cardRef(c.board.id, c.id), c]));
  /** Outcome cards that work on a goal (their number is the goal's). */
  const goalCards = new Set((x.goals?.goals ?? []).flatMap((g) => (g.on ? [cardRef(g.on.board, g.on.card)] : [])));

  // What customers said against a line on a topic page (Qalam AI's disputes, from filing).
  for (const t of x.topics)
    for (const l of t.lines)
      for (const d of l.disputes ?? []) {
        if (d.by !== "qalam") continue;
        out.push({
          key: `disputed:${t.id}:${l.id}:${d.id}`,
          kind: "disputed",
          title: `Something speaks against ${q(clip(l.text.replace(/[.。]+$/, ""), 120))}`,
          why: `${d.text}${d.from.length ? ` (${d.from.join(", ")})` : ""}`,
          at: d.at,
          topic: t.id,
          refs: d.cites,
          products: t.products,
        });
      }

  if (x.indexed) {
    for (const t of x.topics) {
      const shown = x.shows.get(t.id) ?? [];
      // A need customers keep raising, on no board: its known lines rest on two sources or more.
      if (t.kind === "need" && !shown.length) {
        const { quotes, sources, newest } = needEvidence(t, x.pieces);
        if (sources.size >= 2)
          out.push({
            key: `pattern:${t.id}:${tier(sources.size)}`,
            kind: "pattern",
            title: `Customers keep raising ${q(t.title)}, and no board has it`,
            why: `${plural(quotes.size, "quote")} from ${plural(sources.size, "source")} on its topic page; no card on a board rests on them.`,
            at: newest || t.updatedAt,
            topic: t.id,
            refs: [...quotes],
            products: t.products,
          });
      }
      // The same need on two boards: opportunities on different boards that rest mostly on this need's
      // page (two of its pieces at least, and half of what backs the card). A segment's page spans
      // many needs, and one quote can show several: neither makes two cards one need.
      const mostly = (s: ShownOn) => {
        const c = byRef.get(s.ref);
        return !!c && s.kind === "opportunity" && s.shared >= 2 && s.shared * 2 >= backing(c.card).length;
      };
      const opps = t.kind === "need" ? shown.filter(mostly) : [];
      const boards = [...new Set(opps.map((s) => s.board))];
      if (boards.length >= 2) {
        const [a, b] = boards.slice(0, 2).map((id) => opps.filter((s) => s.board === id).sort((m, n) => n.shared - m.shared)[0]);
        const ca = byRef.get(a.ref);
        const cb = byRef.get(b.ref);
        if (ca && cb && !x.linked.has(pairKey(a.ref, b.ref)))
          out.push({
            key: `same-need:${pairKey(a.ref, b.ref)}`,
            kind: "same-need",
            title: `${q(t.title)} shows up on two boards`,
            why: `${q(ca.card.title)} on ${ca.board.name} and ${q(cb.card.title)} on ${cb.board.name} rest on the same customers' words. If they're one need, link them.`,
            at: Math.max(t.updatedAt, ca.card.stageAt ?? 0, cb.card.stageAt ?? 0),
            board: ca.board.id,
            card: ca.id,
            other: { board: cb.board.id, card: cb.id },
            topic: t.id,
            products: [...new Set([...productsOf(ca.board), ...productsOf(cb.board)])],
          });
      }
      // A page whose lines rest on pieces that are all gone (their sources were deleted).
      const cited = t.lines.filter((l) => l.cites.length);
      const gone = cited.filter((l) => l.cites.every((r) => !x.pieces.has(r)));
      if (gone.length && gone.length === cited.length)
        out.push({
          key: `orphan:${t.id}:${gone.length}`,
          kind: "orphan",
          title: `${q(t.title)} rests on sources that are gone`,
          why: `${plural(gone.length, "line")} on its page cite${gone.length === 1 ? "s" : ""} only pieces that were deleted.`,
          at: t.updatedAt,
          topic: t.id,
          products: t.products,
        });
    }
  }

  // Opportunities named alike on two boards (no page needed).
  const opps = cards.filter((c) => c.card.kind === "opportunity" && c.card.title.trim());
  for (let i = 0; i < opps.length; i++)
    for (let j = i + 1; j < opps.length; j++) {
      const [a, b] = [opps[i], opps[j]];
      if (a.board.id === b.board.id || !sameTopic(a.card.title, b.card.title)) continue;
      const [ra, rb] = [cardRef(a.board.id, a.id), cardRef(b.board.id, b.id)];
      if (x.linked.has(pairKey(ra, rb)) || out.some((n) => n.key === `same-need:${pairKey(ra, rb)}`)) continue;
      out.push({
        key: `same-need:${pairKey(ra, rb)}`,
        kind: "same-need",
        title: `${q(a.card.title)} is on two boards`,
        why: `It's on ${a.board.name} and on ${b.board.name}.`,
        at: Math.max(a.card.stageAt ?? a.board.createdAt, b.card.stageAt ?? b.board.createdAt),
        board: a.board.id,
        card: a.id,
        other: { board: b.board.id, card: b.id },
        products: [...new Set([...productsOf(a.board), ...productsOf(b.board)])],
      });
    }

  // A card the team parked or dropped that new evidence backs since.
  const latest = new Map<string, Decision>();
  for (const d of x.decisions) {
    if (d.undone || d.kind !== "stage" || !d.card) continue;
    const k = `${d.board}:${d.card}`;
    if ((latest.get(k)?.at ?? 0) < d.at) latest.set(k, d);
  }
  for (const d of latest.values()) {
    const to = (d.detail as { to?: unknown } | undefined)?.to;
    const c = byRef.get(cardRef(d.board, d.card!));
    if (!c || (to !== "parked" && to !== "dropped") || c.card.stage !== to) continue;
    const since = backing(c.card).filter((e) => e.at > d.at);
    if (!since.length) continue;
    out.push({
      key: `revisit:${d.id}:${tier(since.length)}`,
      kind: "revisit",
      title: `${to === "parked" ? "Parked" : "Dropped"} ${q(c.card.title)} on ${date(d.at)}; new evidence backs it since`,
      why: `${plural(since.length, "new piece")} of evidence, like ${q(clip(since[since.length - 1].text, 120))}.${d.why ? ` The reason then: ${d.why.replace(/[.。]+$/, "")}.` : ""}`,
      at: Math.max(...since.map((e) => e.at)),
      board: c.board.id,
      card: c.id,
      refs: since.flatMap((e) => (e.piece ? [e.piece] : [])),
      products: productsOf(c.board),
    });
  }

  // What Qalam AI found for a board in material added to the organization, waiting for review there.
  for (const p of x.placed ?? []) {
    const b = x.boards.find((y) => y.id === p.board);
    if (!b) continue;
    out.push({
      key: `placed:${p.sourceId}:${p.board}:${p.count}`,
      kind: "placed",
      title: `Qalam AI found where ${q(p.title)} fits on ${b.name}`,
      why: `${plural(p.count, "proposal")} wait${p.count === 1 ? "s" : ""} on the board for you to accept or discard.`,
      at: p.at,
      board: b.id,
      products: productsOf(b),
    });
  }

  for (const c of cards) {
    const ref = cardRef(c.board.id, c.id);
    // A test that's been running a long while with no result.
    if (c.card.kind === "test" && c.card.stage === "running" && c.card.stageAt && x.now - c.card.stageAt > STALE_TEST_DAYS * DAY) {
      const days = Math.floor((x.now - c.card.stageAt) / DAY);
      out.push({
        key: `stale-test:${ref}:${c.card.stageAt}`,
        kind: "stale-test",
        title: `${q(c.card.title)} has been running for ${days} days`,
        why: `No result yet on ${c.board.name}. Write down what happened, or stop it.`,
        at: c.card.stageAt + STALE_TEST_DAYS * DAY,
        board: c.board.id,
        card: c.id,
        products: productsOf(c.board),
      });
    }
    // A solution being built, or tested, on a risky assumption no test checks.
    if (c.card.kind === "solution" && (c.card.stage === "building" || c.card.stage === "shipped" || c.card.stage === "testing")) {
      const tested = new Set(cards.filter((t) => t.board === c.board && t.parent === c.id && t.card.kind === "test").flatMap((t) => t.card.test?.assumptionIds ?? []));
      for (const a of c.card.assumptions ?? []) {
        if (a.importance !== 3 || tested.has(a.id)) continue;
        out.push({
          key: `untested:${ref}:${a.id}`,
          kind: "untested",
          title: `${q(c.card.title)} is ${c.card.stage === "testing" ? "being tested" : c.card.stage === "shipped" ? "shipped" : "being built"} without testing its riskiest assumption`,
          why: `${q(a.text.replace(/[.。]+$/, ""))}: it fails without it, and no test under it checks it.`,
          at: Math.max(c.card.stageAt ?? 0, a.at ?? 0) || c.board.createdAt,
          board: c.board.id,
          card: c.id,
          products: productsOf(c.board),
        });
      }
    }
    // The tool a solution is built in says it's done (or dropped), and the card says otherwise: whose is right?
    if (c.card.kind === "solution")
      for (const w of c.card.work ?? []) {
        const st = x.work?.[workKey(w)];
        if (!st) continue;
        const done = st.state === "done" && c.card.stage !== "shipped" && c.card.stage !== "dropped";
        const gone = st.state === "canceled" && (c.card.stage === "building" || c.card.stage === "testing");
        if (!done && !gone) continue;
        const tool = WORK_LABEL[w.connector] ?? w.connector;
        out.push({
          key: `work-drift:${ref}:${workKey(w)}:${st.state}`,
          kind: "work-drift",
          title: `${tool} says ${q(clip(w.ref, 40))} is ${st.label || st.state}, and ${q(c.card.title)} is still ${c.card.stage}`,
          why: done ? "Its work is done. Has it shipped, or is something left?" : "Its work was stopped. Is the solution still being built?",
          at: st.at,
          board: c.board.id,
          card: c.id,
          products: productsOf(c.board),
        });
      }
    // An outcome whose number nobody has updated in weeks (read from an analytics tool counts as
    // updated). A card that works on a goal is checked as its goal, below.
    const m = c.card.metric;
    if (c.card.kind === "outcome" && !goalCards.has(ref) && c.card.stage === "active" && m && m.current !== null && m.target !== null) {
      const updates = x.decisions.filter((d) => !d.undone && d.kind === "metric" && d.board === c.board.id && d.card === c.id && (d.detail as { field?: unknown } | undefined)?.field === "current");
      const notice = staleNumber(c.card.title, m, Math.max(c.card.stageAt ?? c.board.createdAt, m.readAt ?? 0, ...updates.map((d) => d.at)), x.now, ref);
      if (notice) out.push({ ...notice, board: c.board.id, card: c.id, products: productsOf(c.board) });
    }
  }
  // A goal whose number nobody has updated in weeks: on its board or on its page, read or typed.
  for (const g of x.goals?.goals ?? []) {
    const m = g.metric;
    if (g.status !== "active" || !m || m.current === null || m.target === null) continue;
    const updates = x.decisions.filter((d) => !d.undone && d.kind === "metric" && (d.goal === g.id || (!!g.on && d.board === g.on.board && d.card === g.on.card)) && (d.detail as { field?: unknown } | undefined)?.field === "current");
    const ref = g.on ? cardRef(g.on.board, g.on.card) : `hub:goal:${g.id}`;
    const notice = staleNumber(g.title, m, Math.max(g.at, m.readAt ?? 0, ...updates.map((d) => d.at)), x.now, ref);
    if (notice) out.push({ ...notice, ...(g.on && byRef.has(ref) ? { board: g.on.board, card: g.on.card } : {}), goal: g.id, products: g.product ? [g.product] : [] });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** A number not updated in weeks, or still where it started: the notice, or none while it's fresh. */
function staleNumber(title: string, m: NonNullable<OstCard["metric"]>, last: number, now: number, ref: string): Omit<Notice, "products"> | null {
  if (now - last <= STALE_METRIC_DAYS * DAY) return null;
  const weeks = Math.floor((now - last) / (7 * DAY));
  const flat = m.baseline !== null && m.current === m.baseline;
  return {
    key: `metric:${ref}:${factHash(String(last))}`,
    kind: "metric",
    title: flat ? `${q(title)} hasn't moved from where it started` : `${q(title)} hasn't been updated in ${plural(weeks, "week")}`,
    why: `${m.name || "Its number"} is at ${m.current}${m.unit ? ` ${m.unit}` : ""}${flat ? ", its baseline," : ""} with a target of ${m.target}. Is it moving?`,
    at: last + STALE_METRIC_DAYS * DAY,
  };
}

/** Notices about a card (as the card, or as the other card of a pair). */
export const aboutCard = (n: Pick<Notice, "board" | "card" | "other">, board: string, card: string) => (n.board === board && n.card === card) || (n.other?.board === board && n.other.card === card);

const KINDS: readonly NoticeKind[] = ["disputed", "pattern", "same-need", "revisit", "stale-test", "untested", "metric", "orphan", "review", "placed", "work-drift"];
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const ID = /^[A-Za-z0-9_~-]{1,64}$/;

/** A notice as the organization's server takes one (a review's finding, checked by the client first), or null. */
export function noticeShape(raw: unknown): Notice | null {
  const n = raw as Record<string, unknown> | null;
  if (!n || !isStr(n.key, 400) || !n.key || !(KINDS as readonly unknown[]).includes(n.kind) || !isStr(n.title, 400) || !n.title.trim() || !isStr(n.why, 1200) || typeof n.at !== "number" || !Number.isFinite(n.at)) return null;
  const refs = Array.isArray(n.refs) ? n.refs.filter((r): r is string => isStr(r, 200)).slice(0, 20) : [];
  const products = Array.isArray(n.products) ? n.products.filter((p): p is string => isStr(p, 64) && ID.test(p)).slice(0, 20) : [];
  const where = (v: unknown) => (isStr(v, 64) && ID.test(v) ? v : undefined);
  const other = n.other as { board?: unknown; card?: unknown } | undefined;
  return {
    key: n.key,
    kind: n.kind as NoticeKind,
    title: n.title.replace(/\s+/g, " ").trim(),
    why: n.why.replace(/\s+/g, " ").trim(),
    at: n.at,
    ...(where(n.board) ? { board: where(n.board) } : {}),
    ...(where(n.card) ? { card: where(n.card) } : {}),
    ...(where(n.topic) ? { topic: where(n.topic) } : {}),
    ...(other && where(other.board) && where(other.card) ? { other: { board: where(other.board)!, card: where(other.card)! } } : {}),
    ...(refs.length ? { refs } : {}),
    products,
  };
}
