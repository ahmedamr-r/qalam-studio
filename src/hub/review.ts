import { dayOf, type Decision } from "@/decisions/model";
import { metricText } from "@/discovery/dump";
import { evidenceLabel } from "@/discovery/evidence";
import { stageLabel } from "@/discovery/kinds";
import { factHash } from "@/knowledge/refs";
import { cardsOf, type CheckBoard, type Notice } from "./checks";
import { cardRef, decisionRef, topicLineRef, topicRef } from "./pieces";
import { checkWords, sameWords, SECTION_HEADING, type Topic } from "./topics";

/**
 * A review of the organization by Qalam AI (pure parts): the material it reads (its topic pages,
 * its boards' trees, its recent decisions, each under an id), and what code keeps of its answer.
 * The review looks for what counting can't: work the evidence speaks against, a decision whose
 * reason no longer holds, a strong need the targets pass over. A finding is kept only when it rests
 * on ids it was sent, and its quoted words and numbers are in what those ids are.
 */

export interface ReviewSent {
  ref: string;
  /** What it says, for checking a finding's words. */
  text: string;
  board?: string;
  card?: string;
  topic?: string;
  products: string[];
}

export interface ReviewMaterial {
  /** The material as the model reads it. */
  text: string;
  /** Ids a finding may rest on (l…, c…, d…, t…). */
  ids: string[];
  /** Ids a finding may be about (c…, t…). */
  about: string[];
  sent: Map<string, ReviewSent>;
}

export const REVIEW_LIMITS = { lines: 250, cards: 300, decisions: 40, findings: 6, title: 140 } as const;

const one = (s: string) => s.replace(/\s+/g, " ").trim();

export function reviewMaterial(o: { org: string; topics: Topic[]; boards: CheckBoard[]; decisions: Decision[]; flagged: string[]; productName: (id: string) => string | undefined }): ReviewMaterial {
  const sent = new Map<string, ReviewSent>();
  const about: string[] = [];
  const out: string[] = [`The organization: ${one(o.org) || "(not described yet)"}`];
  const forProducts = (ps: string[]) => (ps.length ? ps.map((p) => o.productName(p) ?? p).join(", ") : "the whole organization");

  // Topic pages, most recently changed first, as many lines as fit.
  let lines = 0;
  let ln = 0;
  const pages: string[] = [];
  for (const [i, t] of [...o.topics].sort((a, b) => b.updatedAt - a.updatedAt).entries()) {
    if (lines >= REVIEW_LIMITS.lines) break;
    const tid = `t${i + 1}`;
    const kept = t.lines.slice(0, REVIEW_LIMITS.lines - lines);
    lines += kept.length;
    sent.set(tid, { ref: topicRef(t.id), text: [t.title, ...kept.map((l) => l.text)].join("\n"), topic: t.id, products: t.products });
    about.push(tid);
    pages.push(`## ${tid} · ${t.kind} · ${one(t.title)} (${forProducts(t.products)})`);
    for (const l of kept) {
      const lid = `l${++ln}`;
      sent.set(lid, { ref: topicLineRef(t.id, l.id), text: [l.text, ...(l.disputes ?? []).map((d) => d.text)].join("\n"), topic: t.id, products: t.products });
      pages.push(`- ${lid} · ${SECTION_HEADING[l.section]}${l.by === "person" ? " (the team's words)" : ""}: ${one(l.text)}${(l.disputes ?? []).map((d) => `\n  disputed: ${one(d.text)}`).join("")}`);
    }
  }
  if (pages.length) out.push("", "Topic pages (what the organization knows, believes, has against it and hasn't answered; id · part: words):", ...pages);

  // Boards: each tree as an outline, every card with its stage and what backs it.
  const cards = cardsOf(o.boards).slice(0, REVIEW_LIMITS.cards);
  const cid = new Map<string, string>();
  for (const [i, c] of cards.entries()) cid.set(cardRef(c.board.id, c.id), `c${i + 1}`);
  const boardLines: string[] = [];
  for (const b of o.boards) {
    const mine = cards.filter((c) => c.board === b);
    if (!mine.length) continue;
    boardLines.push(`## ${one(b.name)} (${forProducts(b.product ? [b.product] : [])})`);
    const kids = new Map<string | null, typeof mine>();
    for (const c of mine) kids.set(c.parent, [...(kids.get(c.parent) ?? []), c]);
    const walk = (c: (typeof mine)[number], depth: number) => {
      const id = cid.get(cardRef(b.id, c.id))!;
      const ev = evidenceLabel(c.card);
      const metric = c.card.kind === "outcome" ? metricText(c.card.metric) : "";
      const risky = (c.card.assumptions ?? []).filter((a) => a.importance === 3).map((a) => `fails without: ${one(a.text)}`);
      const result = c.card.test?.result ? `result: ${one(c.card.test.result)}` : "";
      const facts = [ev, metric, ...risky, result].filter(Boolean);
      boardLines.push(`${"  ".repeat(depth)}- ${id} · ${c.card.kind} · ${stageLabel(c.card.kind, c.card.stage).toLowerCase()} · ${one(c.card.title) || "(untitled)"}${facts.length ? ` · ${facts.join(" · ")}` : ""}`);
      sent.set(id, { ref: cardRef(b.id, c.id), text: [c.card.title, c.card.description ?? "", metric, ...risky, result, ...c.card.evidence.map((e) => e.text)].filter(Boolean).join("\n"), board: b.id, card: c.id, products: b.product ? [b.product] : [] });
      about.push(id);
      for (const k of kids.get(c.id) ?? []) walk(k, depth + 1);
    };
    for (const c of mine) if (!c.parent || !mine.some((x) => x.id === c.parent)) walk(c, 0);
  }
  if (boardLines.length) out.push("", "Boards (Opportunity Solution Trees; id · kind · stage · title · what backs it):", ...boardLines);

  // The newest decisions, with their reasons.
  const decisions = o.decisions.filter((d) => !d.undone).slice(0, REVIEW_LIMITS.decisions);
  if (decisions.length) {
    out.push("", "Decisions the team made (id · day · what · why):");
    decisions.forEach((d, i) => {
      const id = `d${i + 1}`;
      const board = o.boards.find((b) => b.id === d.board);
      sent.set(id, { ref: decisionRef(d.id), text: [d.what, d.why ?? ""].filter(Boolean).join("\n"), board: d.board, ...(d.card ? { card: d.card } : {}), products: board?.product ? [board.product] : [] });
      out.push(`- ${id} · ${dayOf(d.at)} · ${one(d.what)}${d.why ? ` · Why: ${one(d.why)}` : ""}`);
    });
  }
  if (o.flagged.length) out.push("", "Already flagged by code's checks (don't repeat these):", ...o.flagged.slice(0, 40).map((f) => `- ${one(f)}`));
  out.push("", "Review the organization: what needs a look?");
  return { text: out.join("\n"), ids: [...sent.keys()].filter((k) => !k.startsWith("t")), about, sent };
}

const items = (raw: unknown, key: string): Record<string, unknown>[] => {
  const v = (raw as Record<string, unknown> | null)?.[key];
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
};

/** What code keeps of a review: findings resting on ids it was sent, their words found in them. */
export function sanitizeReview(raw: unknown, m: ReviewMaterial, now: number): Notice[] {
  const out: Notice[] = [];
  for (const f of items(raw, "findings")) {
    if (out.length >= REVIEW_LIMITS.findings) break;
    const seen = new Set<string>();
    const cited: ReviewSent[] = [];
    for (const id of Array.isArray(f.cites) ? f.cites : []) {
      const c = typeof id === "string" ? m.sent.get(id.trim().replace(/^\[|\]$/g, "")) : undefined;
      if (!c || seen.has(c.ref)) continue;
      seen.add(c.ref);
      cited.push(c);
    }
    if (!cited.length) continue;
    const title = checkWords(f.title, cited);
    const why = checkWords(f.why, cited);
    if (!title || title.length > REVIEW_LIMITS.title || !why) continue;
    const about = typeof f.about === "string" ? m.sent.get(f.about.trim()) : undefined;
    const key = `review:${factHash(sameWords(title))}`;
    if (out.some((n) => n.key === key)) continue;
    out.push({
      key,
      kind: "review",
      title: title.replace(/[.。]+$/, ""),
      why,
      at: now,
      ...(about?.board && about.card ? { board: about.board, card: about.card } : {}),
      ...(about?.topic && !about.card ? { topic: about.topic } : {}),
      refs: cited.map((c) => c.ref),
      products: [...new Set(cited.flatMap((c) => c.products))],
    });
  }
  return out;
}
