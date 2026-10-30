import type { Decision } from "@/decisions/model";
import type { Doc } from "@/doc/schema";
import { backing } from "@/discovery/evidence";
import type { OstCard } from "@/discovery/types";
import { factHash } from "@/knowledge/refs";
import { cardRef } from "./pieces";
import { isEvidence, sameTopic, type Topic } from "./topics";
import { tally, tallyText, type Voice } from "./people";
import { STRENGTH_LABEL, strengthOf } from "./strength";
import type { OrgGoal } from "@/org/context-md";

/**
 * What needs a look (pure): checks code runs over the organization's boards, decisions and topic
 * pages at no token cost. Each finds something a product team should hear about: what customers
 * said against what the team believes (Qalam AI's disputes on the topic pages), needs customers
 * keep raising that no board has, the same need on two boards, a parked or dropped card that new
 * evidence now backs, a target need resting on thin evidence, a test that's run too long, a
 * solution being built on a risky assumption nothing tests, an outcome whose number nobody has
 * updated. Every notice has a stable key, made
 * of what it's about and how strong it is: dismissed, it stays dismissed until it grows.
 */

export type NoticeKind = "disputed" | "pattern" | "same-need" | "revisit" | "stale-test" | "untested" | "metric" | "orphan" | "review" | "placed" | "thin-target" | "unworked-goal" | "unanchored";

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
  metric: "Outcome",
  orphan: "Page",
  review: "Qalam AI review",
  placed: "To review",
  "thin-target": "Target",
  "unworked-goal": "Goal",
  unanchored: "Outcome",
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

export interface ShownOn {
  ref: string;
  board: string;
  card: string;
  kind: string;
  shared: number;
}

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
  pieces: Map<string, { type: string; sub: string | null; source: string | null; stage: string | null; at: number }>;
  /** Cards linked as the same need ("<ref>|<ref>", sorted). */
  linked: Set<string>;
  /** Proposals waiting on a board from material added to the organization (a capture, the inbox). */
  placed?: { board: string; sourceId: string; title: string; count: number; at: number }[];
  /** Who said each quote (by its piece ref): people and segments, so voices are counted, not quotes. */
  voices?: ReadonlyMap<string, Voice>;
  /** The goals the organization and its products state, each with whose it is and when it was last written. */
  goals?: { goal: OrgGoal; product: string | null; lead: boolean; owner: string; at: number }[];
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
      // A need customers keep raising, on no board: its known lines rest on two voices or more
      // (people, or unnamed voices of different sources).
      if (t.kind === "need" && !shown.length) {
        const known = t.lines.filter((l) => l.section === "know");
        const quotes = new Set<string>();
        const sources = new Set<string>();
        const voices: Voice[] = [];
        let newest = 0;
        for (const l of known)
          for (const ref of l.cites) {
            const p = x.pieces.get(ref);
            if (!p || !isEvidence(p)) continue;
            quotes.add(ref);
            sources.add(p.source ?? ref);
            newest = Math.max(newest, l.at, p.at);
            const v = x.voices?.get(ref);
            voices.push(v ?? { key: `source:${p.source ?? ref}`, segments: [], source: p.source ?? ref, at: p.at });
          }
        const who = tally(voices);
        const strength = Math.max(sources.size, who.voices);
        if (strength >= 2)
          out.push({
            key: `pattern:${t.id}:${tier(strength)}`,
            kind: "pattern",
            title: `Customers keep raising ${q(t.title)}, and no board has it`,
            why: `${plural(quotes.size, "quote")} from ${x.voices ? tallyText(who) : plural(sources.size, "source")} on its topic page; no card on a board rests on them.`,
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

  // Goals and the outcomes that serve them: a stated goal no board works on, and an outcome (a
  // tree's top) that serves no stated goal, or one that's no longer stated.
  if (x.goals) {
    const goals = x.goals;
    const outcomes = cards.filter((c) => c.card.kind === "outcome");
    const serves = (c: CardAt, g: (typeof goals)[number]) => c.card.serves?.goal === g.goal.id && (c.card.serves.product ?? null) === g.product;
    for (const g of goals) {
      const serving = outcomes.filter((c) => serves(c, g));
      if (serving.some((c) => c.card.stage === "active" || c.card.stage === "achieved")) continue;
      const paused = serving[0];
      out.push({
        key: `unworked-goal:${g.product ?? "org"}:${g.goal.id}:${paused ? "paused" : "none"}`,
        kind: "unworked-goal",
        title: g.lead ? `Nothing moves ${q(g.goal.text)}, the goal that leads for ${g.owner}` : `No board works on ${q(g.goal.text)}, a goal of ${g.owner}`,
        why: paused
          ? `The only outcome serving it, ${q(paused.card.title)} on ${paused.board.name}, is paused.`
          : "No outcome on a board says it serves it. Start a board for it, or say on an outcome's card which goal it serves.",
        at: g.at,
        products: g.product ? [g.product] : [],
      });
    }
    for (const c of outcomes) {
      if (c.parent || c.card.stage !== "active") continue;
      const product = c.board.product;
      const inScope = goals.filter((g) => g.product === null || g.product === product);
      const ref = cardRef(c.board.id, c.id);
      if (!c.card.serves) {
        if (!inScope.length) continue;
        out.push({
          key: `unanchored:${ref}`,
          kind: "unanchored",
          title: `${q(c.card.title)} serves none of the goals you've stated`,
          why: `On ${c.board.name}. The goals it could serve: ${inScope.slice(0, 4).map((g) => q(g.goal.text)).join(", ")}. Say which on its card, or write down the goal it does serve.`,
          at: c.card.stageAt ?? c.board.createdAt,
          board: c.board.id,
          card: c.id,
          products: productsOf(c.board),
        });
      } else if (!goals.some((g) => serves(c, g)))
        out.push({
          key: `unanchored:${ref}:gone:${c.card.serves.goal}`,
          kind: "unanchored",
          title: `${q(c.card.title)} serves a goal that's no longer stated`,
          why: `On ${c.board.name}. The goal it served was renamed outside Qalam or taken off its list. Say which goal it serves now.`,
          at: Math.max(c.card.stageAt ?? 0, ...goals.map((g) => g.at)) || c.board.createdAt,
          board: c.board.id,
          card: c.id,
          products: productsOf(c.board),
        });
    }
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
    // The need the team targets, resting on thin evidence: one voice, stale words, more against than for, or only the team's belief.
    if (c.card.kind === "opportunity" && c.card.stage === "target") {
      const s = strengthOf(c.card, { now: x.now, voices: x.voices });
      if (s.level === "none" || s.level === "team" || s.level === "thin")
        out.push({
          key: `thin-target:${ref}:${s.level}:${s.tally.voices}`,
          kind: "thin-target",
          title: `The target ${q(c.card.title)} rests on ${s.level === "thin" ? "thin evidence" : s.level === "team" ? "the team's belief alone" : "nothing yet"}`,
          why: `${STRENGTH_LABEL[s.level]}${s.why ? `: ${s.why}` : ""}. ${s.next ?? ""}`.trim(),
          at: Math.max(c.card.stageAt ?? 0, s.tally.newest) || c.board.createdAt,
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
    // An outcome whose number nobody has updated in weeks.
    const m = c.card.metric;
    if (c.card.kind === "outcome" && c.card.stage === "active" && m && m.current !== null && m.target !== null) {
      const updates = x.decisions.filter((d) => !d.undone && d.kind === "metric" && d.board === c.board.id && d.card === c.id && (d.detail as { field?: unknown } | undefined)?.field === "current");
      // A reading (typed in, or read from an export) is an update too.
      const last = Math.max(c.card.stageAt ?? c.board.createdAt, ...updates.map((d) => d.at), ...(m.readings ?? []).map((r) => r.at));
      if (x.now - last > STALE_METRIC_DAYS * DAY) {
        const weeks = Math.floor((x.now - last) / (7 * DAY));
        const flat = m.baseline !== null && m.current === m.baseline;
        out.push({
          key: `metric:${ref}:${factHash(String(last))}`,
          kind: "metric",
          title: flat ? `${q(c.card.title)} hasn't moved from where it started` : `${q(c.card.title)} hasn't been updated in ${plural(weeks, "week")}`,
          why: `${m.name || "Its number"} is at ${m.current}${m.unit ? ` ${m.unit}` : ""}${flat ? ", its baseline," : ""} with a target of ${m.target}. Is it moving?`,
          at: last + STALE_METRIC_DAYS * DAY,
          board: c.board.id,
          card: c.id,
          products: productsOf(c.board),
        });
      }
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Notices about a card (as the card, or as the other card of a pair). */
export const aboutCard = (n: Pick<Notice, "board" | "card" | "other">, board: string, card: string) => (n.board === board && n.card === card) || (n.other?.board === board && n.other.card === card);

const KINDS: readonly NoticeKind[] = ["disputed", "pattern", "same-need", "revisit", "stale-test", "untested", "metric", "orphan", "review", "placed", "thin-target", "unworked-goal", "unanchored"];
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
