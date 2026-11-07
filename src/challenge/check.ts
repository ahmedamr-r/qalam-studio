import { withoutIds } from "@/goals/said";
import { holdWords, sameTopic } from "@/hub/topics";
import type { Challenge, ChallengeCite, ChallengeKind, CheckItem, CheckRequest, Evidence, Finding } from "./types";

/*
 * The call that words the challenges, and what code keeps of its answer (pure). The call is sent what
 * they asked, the proposals (p…), the cards they hang under, their evidence (e…) and code's findings
 * (k…). Code keeps a line only when every proposal and cite it names was sent, it rests on at least one
 * piece of evidence, its quoted words are in what it cites and its numbers there or in code's
 * arithmetic. A finding of code's the call didn't word stands in code's own words: the call can't drop
 * one, since a model siding with the person is what this is for.
 */

export const CHALLENGE_LIMITS = { items: 24, evidence: 40, text: 300, findings: 10, per: 2, all: 8, line: 360, settle: 220 } as const;

const KIND_WORD = { outcome: "Goal", opportunity: "Problem", solution: "Solution" } as const;
const one = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, max: number) => {
  const t = one(s);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === "string").map((x) => x.trim());

export interface ChallengeSent {
  text: string;
  /** What they asked: their words, which a line may quote. */
  asked: string;
  items: Map<string, CheckItem>;
  evidence: Map<string, Evidence>;
  findings: Map<string, Finding>;
  /** The evidence each finding rests on, by its id. */
  rests: Map<string, string[]>;
}

/** What the call reads: what they asked, the proposals and what they hang under, the evidence and code's findings, each with its id. */
export function challengeMaterial(o: { req: CheckRequest; evidence: readonly Evidence[]; findings: readonly Finding[] }): ChallengeSent {
  const items = new Map(o.req.items.slice(0, CHALLENGE_LIMITS.items).map((k, i) => [`p${i + 1}`, k]));
  const refOf = new Map([...items].map(([ref, k]) => [k.id, ref]));
  // The evidence code's findings rest on goes first, so a cut never takes it.
  const order = [...new Set([...o.findings.slice(0, CHALLENGE_LIMITS.findings).flatMap((f) => f.rests), ...o.evidence.map((_, i) => i)])].slice(0, CHALLENGE_LIMITS.evidence);
  const evidence = new Map(order.map((at, i) => [`e${i + 1}`, o.evidence[at]] as const));
  const eRef = new Map(order.map((at, i) => [at, `e${i + 1}`]));
  const findings = new Map<string, Finding>();
  const rests = new Map<string, string[]>();
  o.findings.slice(0, CHALLENGE_LIMITS.findings).forEach((f, i) => {
    const ref = `k${i + 1}`;
    findings.set(ref, f);
    rests.set(ref, f.rests.flatMap((at) => eRef.get(at) ?? []));
  });
  const cards = new Map(o.req.outline.map((c) => [c.id, c]));
  const under = (k: CheckItem) => {
    const ref = k.parent ? refOf.get(k.parent) : undefined;
    const card = k.parent ? cards.get(k.parent) : undefined;
    if (ref) return ` · under ${ref}`;
    if (card) return ` · under ${KIND_WORD[card.kind].toLowerCase()} “${one(card.title)}”${card.assumed && card.kind !== "outcome" ? " (nothing measured or said backs it yet)" : ""}`;
    return "";
  };
  const proposalLine = ([ref, k]: [string, CheckItem]) =>
    `- ${ref} · ${KIND_WORD[k.kind]} · “${clip(k.title, 160)}”${k.description ? ` · ${clip(k.description, 280)}` : ""}${k.how ? ` · how: ${clip(k.how, 160)}` : ""}${k.assumptions?.length ? ` · assumes: ${k.assumptions.slice(0, 3).map((a) => `“${clip(a, 160)}”`).join("; ")}` : ""}${under(k)}${k.assumed ? " · nothing measured or said backs it yet" : ""}`;
  // The goals above the proposals, so what they're for is known.
  const goals = [...new Set(o.req.items.flatMap((k) => {
    const out: string[] = [];
    for (let id = k.parent, i = 0; id && i < 20; i++) {
      const c = cards.get(id);
      if (!c) break;
      if (c.kind === "outcome") out.push(`- “${one(c.title)}”`);
      id = c.parent;
    }
    return out;
  }))].slice(0, 6);
  const forLine = (e: Evidence) => {
    const refs = e.for.flatMap((id) => refOf.get(id) ?? []);
    return refs.length ? ` · for ${refs.join(", ")}` : "";
  };
  const text = [
    `What they asked: “${clip(o.req.asked, 600)}”`,
    "",
    ...(goals.length ? ["The goals they're for:", ...goals, ""] : []),
    "The proposals (id · what · words · where):",
    ...[...items].map(proposalLine),
    "",
    "Their evidence (id · whose · where · words):",
    ...(evidence.size ? [...evidence].map(([ref, e]) => `- ${ref} · ${e.whose} · ${clip(e.from, 80)} · “${clip(e.text, CHALLENGE_LIMITS.text)}”${forLine(e)}`) : ["(none)"]),
    "",
    "What code found in their numbers and records (id · on · what it found · rests on). It's arithmetic on their own data: word each one, keep its numbers:",
    ...(findings.size ? [...findings].map(([ref, f]) => `- ${ref} · ${f.on.length ? f.on.flatMap((id) => refOf.get(id) ?? []).join(", ") : "the whole set"} · ${f.line} · ${rests.get(ref)!.join(", ")}`) : ["(nothing)"]),
  ].join("\n");
  return { text, asked: o.req.asked, items, evidence, findings, rests };
}

/** What a challenge rests on, for its key: the same evidence keeps the same key, so a dropped one stays dropped until there's more. */
const evidenceKey = (e: Evidence) => e.piece ?? (e.sourceId && e.span ? `${e.sourceId}:${e.span[0]}` : e.line ? `${e.topic}:${e.line}` : (e.decision ?? e.step ?? `${e.from}:${one(e.text).slice(0, 60)}`));
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const challengeKey = (kind: ChallengeKind, on: readonly CheckItem[], cites: readonly Evidence[]) =>
  `${kind}:${on.map((k) => norm(k.title)).sort().join("+") || "all"}:${[...new Set(cites.map(evidenceKey))].sort().join("+")}`;

const citeOf = (e: Evidence): ChallengeCite => {
  const { for: _for, ...rest } = e;
  return rest;
};

/**
 * The call's answer as code keeps it, then code's own words for any finding it didn't word, firm ones
 * first, at most 2 on a proposal and 8 in all. Challenges dropped before (`dropped`, by key) aren't
 * raised again.
 */
export function sanitizeChallenges(raw: unknown, m: ChallengeSent, o: { id: () => string; dropped?: ReadonlySet<string> }, dropped?: (why: string, item: unknown) => void): Challenge[] {
  const drop = (why: string, x: unknown) => void dropped?.(why, x);
  const refOf = new Map([...m.items].map(([ref, k]) => [k.id, ref]));
  const name = (ref: string) => (m.items.has(ref) ? `“${one(m.items.get(ref)!.title)}”` : "");
  const itemHay = (k: CheckItem) => [k.title, k.description ?? "", k.how ?? "", ...(k.assumptions ?? [])];
  type Kept = Challenge & { weight: number; finding?: string };
  const kept: Kept[] = [];
  const covered = new Set<string>();

  const keep = (c: { on: string[]; cites: string[]; line: unknown; settle: unknown; by: "qalam" | "code" }, x: unknown) => {
    const findingRefs = c.cites.filter((r) => m.findings.has(r));
    const eRefs = [...new Set([...c.cites.filter((r) => m.evidence.has(r)), ...findingRefs.flatMap((r) => m.rests.get(r) ?? [])])];
    if (!eRefs.length) return drop("it rests on nothing it was sent", x);
    const findings = findingRefs.map((r) => m.findings.get(r)!);
    // A finding's proposals are its own, whatever the line said; all in the proposals' order.
    const named = new Set([...c.on, ...findings.flatMap((f) => f.on.flatMap((id) => refOf.get(id) ?? []))]);
    const on = [...m.items.keys()].filter((r) => named.has(r));
    const items = on.map((r) => m.items.get(r)!);
    const cites = eRefs.map((r) => m.evidence.get(r)!);
    const hay = [m.asked, ...cites.map((e) => `${e.from}\n${e.text}`), ...findings.flatMap((f) => [f.line, ...f.facts]), ...items.flatMap(itemHay)];
    const held = holdWords(withoutIds(c.line, name, "pek"), hay, { max: CHALLENGE_LIMITS.line, shape: "prose" });
    if (held.cut.length) drop(`words or numbers that aren't in what it cites came out: ${held.cut.join(" | ")}`, x);
    if (!held.text) return drop("nothing of it holds once what isn't in what it cites is out", x);
    const settle = holdWords(withoutIds(c.settle, name, "pek"), hay, { max: CHALLENGE_LIMITS.settle, shape: "prose" }).text;
    const kind: ChallengeKind = findings[0]?.kind ?? "evidence";
    const key = challengeKey(kind, items, cites);
    if (o.dropped?.has(key)) return drop("they dropped it before", x);
    if (kept.some((k) => k.key === key || sameTopic(k.line, held.text))) return drop("said already", x);
    for (const r of findingRefs) covered.add(r);
    kept.push({ id: o.id(), key, kind, on: items.map((k) => k.id), line: held.text, settle, cites: cites.map(citeOf), by: c.by, weight: Math.max(0, ...findings.map((f) => f.weight)), ...(findingRefs[0] ? { finding: findingRefs[0] } : {}) });
  };

  for (const item of list(rec(raw).challenges).slice(0, CHALLENGE_LIMITS.all * 3)) {
    const x = rec(item);
    const on = [...new Set(strs(x.on).filter((r) => m.items.has(r)))];
    const cites = [...new Set(strs(x.cites).filter((r) => m.evidence.has(r) || m.findings.has(r)))];
    keep({ on, cites, line: x.line, settle: x.settle, by: "qalam" }, item);
  }
  // Code's findings the call didn't word stand in code's own words.
  for (const [ref, f] of m.findings) if (!covered.has(ref)) keep({ on: [], cites: [ref], line: f.line, settle: "", by: "code" }, { finding: ref });

  // Code's findings first, then as the call put them; of the call's own, at most 2 on a proposal; 8 in all.
  const ordered = kept.map((k, i) => ({ k, i })).sort((a, b) => b.k.weight - a.k.weight || a.i - b.i).map((x) => x.k);
  const per = new Map<string, number>();
  const out: Challenge[] = [];
  for (const c of ordered) {
    if (out.length >= CHALLENGE_LIMITS.all) break;
    if (!c.finding && c.on.some((id) => (per.get(id) ?? 0) >= CHALLENGE_LIMITS.per)) continue;
    if (!c.finding) for (const id of c.on) per.set(id, (per.get(id) ?? 0) + 1);
    const { weight: _w, finding: _f, ...challenge } = c;
    out.push(challenge);
  }
  return out;
}
