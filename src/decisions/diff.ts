import type { Doc } from "@/doc/schema";
import { againstCount, backing, evidenceLabel } from "@/discovery/evidence";
import { stageLabel } from "@/discovery/kinds";
import type { OstCard, OstEvidence, OstKind, OstMetric } from "@/discovery/types";
import type { Decision, KnewThen } from "./model";

/**
 * The decisions in a change to a board: the board before and after, compared. Comparing the
 * documents, rather than instrumenting each command, catches every way a change is made (a key,
 * a menu, cut, undo, Qalam AI's accepted proposals, an edit to the file on disk). Adding cards and
 * rewording them aren't decisions; deleting, merging, moving, changing a stage, the target or an
 * outcome's number are.
 */

export interface DiffContext {
  board: string;
  boardName: string;
  product?: string | null;
  now: number;
  /** Who made the change: you, or Qalam AI's proposals you accepted. */
  by?: Decision["by"];
  newId: () => string;
  /**
   * Outcome cards that work on a goal (goals.md). Their number and stage are the goal's: a change
   * to either is recorded where the goal is changed (src/goals/decisions.ts), not here.
   */
  linked?: ReadonlySet<string>;
}

interface CardAt {
  card: OstCard;
  /** The card above it (null: a tree's root). */
  parent: string | null;
}

type Node = { parentId?: string | null; meta?: { ost?: OstCard } };

function cardsOf(doc: Doc): Map<string, CardAt> {
  const nodes = doc.nodes as unknown as Record<string, Node>;
  const out = new Map<string, CardAt>();
  for (const [id, n] of Object.entries(nodes)) {
    const c = n.meta?.ost;
    if (!c) continue;
    let p = n.parentId ?? null;
    while (p && !nodes[p]?.meta?.ost) p = nodes[p]?.parentId ?? null;
    out.set(id, { card: c, parent: p });
  }
  return out;
}

export const q = (t: string) => `“${t.trim() || "Untitled"}”`;

function from(e: OstEvidence): string | undefined {
  if (e.kind === "quote") return e.sourceTitle ?? "a source";
  if (e.kind === "dump") return "your brain dump";
  if (e.kind === "answer") return "your answers";
  return "a note";
}

/** What a card rested on at the moment: its evidence, tests and number. */
export function knewThen(cards: Map<string, CardAt>, id: string): KnewThen | undefined {
  const at = cards.get(id);
  if (!at) return undefined;
  const c = at.card;
  const under = [...cards].filter(([, x]) => x.parent === id);
  const tests: { title: string; stage: string }[] = [];
  const walk = (pid: string) => {
    for (const [cid, x] of cards)
      if (x.parent === pid) {
        if (x.card.kind === "test") tests.push({ title: x.card.title, stage: stageLabel("test", x.card.stage) });
        walk(cid);
      }
  };
  walk(id);
  return {
    evidence: evidenceLabel(c) || (backing(c).length ? `${backing(c).length} pieces` : "No evidence"),
    pieces: backing(c)
      .slice(0, 5)
      .map((e) => ({ text: e.text.slice(0, 240), from: from(e), ...(e.piece ? { ref: e.piece } : e.answerId ? { ref: `answer:${e.answerId}` } : {}) })),
    against: againstCount(c),
    ...(tests.length ? { tests } : {}),
    ...(c.metric ? { metric: c.metric } : {}),
    ...(under.length ? { children: under.length } : {}),
  };
}

const hasBacking = (c: OstCard) => backing(c).length > 0;

/** The line for a stage change, by kind. */
export function stageLine(kind: OstKind, title: string, from: string, to: string): string {
  const t = q(title);
  switch (`${kind}:${to}`) {
    case "opportunity:parked":
      return `Parked ${t}`;
    case "opportunity:solved":
      return `Marked ${t} solved`;
    case "opportunity:exploring":
      return from === "target" ? `${t} is no longer the target` : `Reopened ${t}`;
    case "solution:dropped":
      return `Dropped the solution ${t}`;
    case "solution:testing":
      return `Started testing ${t}`;
    case "solution:building":
      return `Started building ${t}`;
    case "solution:shipped":
      return `Shipped ${t}`;
    case "solution:idea":
      return `Moved ${t} back to an idea`;
    case "test:running":
      return `Started the test ${t}`;
    case "test:passed":
      return `The test ${t} passed`;
    case "test:failed":
      return `The test ${t} failed`;
    case "test:inconclusive":
      return `The test ${t} was inconclusive`;
    case "test:planned":
      return `Moved the test ${t} back to planned`;
    case "outcome:achieved":
      return `Achieved ${t}`;
    case "outcome:paused":
      return `Paused ${t}`;
    case "outcome:active":
      return `Resumed ${t}`;
    default:
      return `${t}: ${stageLabel(kind, from as never)} → ${stageLabel(kind, to as never)}`;
  }
}

/** Big enough to ask why: giving up on something there was reason to believe in, or changing what the team aims at. */
function bigStage(card: OstCard, to: string): boolean {
  return (card.kind === "opportunity" && to === "parked" && hasBacking(card)) || (card.kind === "solution" && to === "dropped");
}

export const num = (v: number | null | undefined, unit?: string) => (v === null || v === undefined ? "none" : `${v}${unit ? ` ${unit}` : ""}`);

export function decisionsFromDiff(prev: Doc, next: Doc, ctx: DiffContext): Decision[] {
  if (prev === next || prev.nodes === next.nodes) return [];
  const before = cardsOf(prev);
  const after = cardsOf(next);
  const base = { at: ctx.now, board: ctx.board, boardName: ctx.boardName, ...(ctx.product !== undefined ? { product: ctx.product } : {}), by: ctx.by ?? "you" } as const;
  const make = (d: Omit<Decision, "id" | keyof typeof base>): Decision => ({ id: ctx.newId(), ...base, ...d });
  const out: Decision[] = [];

  // --- Deleted cards: folded into another (merge), or dropped with whatever was under them.
  const removed = [...before.keys()].filter((id) => !after.has(id));
  const merged = new Map<string, string>();
  for (const id of removed) {
    const r = before.get(id)!;
    const evidence = new Set(r.card.evidence.map((e) => e.id));
    const children = [...before].filter(([, x]) => x.parent === id).map(([cid]) => cid);
    for (const [kid, k] of after) {
      if (kid === id || k.card.kind !== r.card.kind) continue;
      const hadBefore = new Set(before.get(kid)?.card.evidence.map((e) => e.id) ?? []);
      const tookEvidence = k.card.evidence.some((e) => evidence.has(e.id) && !hadBefore.has(e.id));
      const tookChildren = children.length > 0 && children.every((c) => after.get(c)?.parent === kid);
      if (tookEvidence || tookChildren) {
        merged.set(id, kid);
        break;
      }
    }
  }
  const removedSet = new Set(removed);
  for (const id of removed) {
    const r = before.get(id)!;
    const into = merged.get(id);
    const knew = knewThen(before, id);
    if (into) {
      const k = after.get(into)!;
      out.push(make({ kind: "merge", card: id, cardTitle: r.card.title, cardKind: r.card.kind, what: `Merged ${q(r.card.title)} into ${q(k.card.title)}`, detail: { into, intoTitle: k.card.title }, big: false, ...(knew ? { knew } : {}) }));
      continue;
    }
    // A card deleted with its parent is part of that decision, not one of its own.
    if (r.parent && removedSet.has(r.parent) && !merged.has(r.parent)) continue;
    let under = 0;
    const count = (pid: string) => {
      for (const [cid, x] of before)
        if (x.parent === pid && removedSet.has(cid)) {
          under++;
          count(cid);
        }
    };
    count(id);
    const parentTitle = r.parent ? before.get(r.parent)?.card.title : undefined;
    const big = r.card.kind === "outcome" || r.card.kind === "solution" || (r.card.kind === "opportunity" && hasBacking(r.card)) || r.card.stage === "target";
    out.push(
      make({
        kind: "drop",
        card: id,
        cardTitle: r.card.title,
        cardKind: r.card.kind,
        what: `Deleted ${q(r.card.title)}${under ? ` and ${under} ${under === 1 ? "card" : "cards"} under it` : ""}`,
        detail: { stage: r.card.stage, ...(r.parent ? { parent: r.parent, parentTitle } : {}), ...(under ? { under } : {}) },
        big,
        ...(knew ? { knew } : {}),
      }),
    );
  }

  // --- Cards still there: the target, stages, moves, numbers.
  const kept = [...after.keys()].filter((id) => before.has(id));
  const lostTarget = kept.filter((id) => before.get(id)!.card.stage === "target" && after.get(id)!.card.stage !== "target");
  const gainedTarget = kept.filter((id) => before.get(id)!.card.stage !== "target" && after.get(id)!.card.stage === "target");
  const consumed = new Set<string>();
  for (const id of gainedTarget) {
    const a = after.get(id)!;
    // The target it replaced: in the same tree's scope, the one that stopped being the target now.
    const was = lostTarget.find((x) => !consumed.has(x) && after.get(x)!.card.stage === "exploring") ?? null;
    if (was) consumed.add(was);
    const knew = knewThen(after, id);
    out.push(
      make({
        kind: "target",
        card: id,
        cardTitle: a.card.title,
        cardKind: a.card.kind,
        what: was ? `Made ${q(a.card.title)} the target, instead of ${q(after.get(was)!.card.title)}` : `Made ${q(a.card.title)} the target`,
        detail: { from: before.get(id)!.card.stage, to: "target", ...(was ? { replaced: was, replacedTitle: after.get(was)!.card.title } : {}) },
        big: true,
        ...(knew ? { knew } : {}),
      }),
    );
  }
  for (const id of kept) {
    if (gainedTarget.includes(id) || consumed.has(id)) continue;
    const b = before.get(id)!;
    const a = after.get(id)!;
    if (b.card.stage !== a.card.stage && !(a.card.kind === "outcome" && ctx.linked?.has(id))) {
      const knew = knewThen(after, id);
      out.push(
        make({
          kind: "stage",
          card: id,
          cardTitle: a.card.title,
          cardKind: a.card.kind,
          what: stageLine(a.card.kind, a.card.title, b.card.stage, a.card.stage),
          detail: { from: b.card.stage, to: a.card.stage },
          big: bigStage(a.card, a.card.stage) || b.card.stage === "target",
          ...(knew ? { knew } : {}),
        }),
      );
    }
  }
  for (const id of kept) {
    const b = before.get(id)!;
    const a = after.get(id)!;
    // Children of a merged card follow it: that's the merge, not a move.
    if (b.parent === a.parent || (b.parent && merged.has(b.parent))) continue;
    const to = a.parent ? after.get(a.parent)?.card.title : undefined;
    out.push(
      make({
        kind: "move",
        card: id,
        cardTitle: a.card.title,
        cardKind: a.card.kind,
        what: a.parent ? `Moved ${q(a.card.title)} under ${q(to ?? "")}` : `Made ${q(a.card.title)} a tree of its own`,
        detail: { from: b.parent, fromTitle: b.parent ? (before.get(b.parent)?.card.title ?? null) : null, to: a.parent, toTitle: to ?? null },
        big: false,
      }),
    );
  }
  for (const id of kept) {
    const b = before.get(id)!.card.metric;
    const a = after.get(id)!.card.metric;
    if (!b || !a || ctx.linked?.has(id)) continue;
    const t = after.get(id)!.card.title;
    if (b.target !== a.target)
      out.push(make({ kind: "metric", card: id, cardTitle: t, cardKind: "outcome", what: `Changed the target of ${q(t)} from ${num(b.target, a.unit)} to ${num(a.target, a.unit)}`, detail: { field: "target", from: b.target, to: a.target, metric: metricOf(a) }, big: true }));
    // A number read from an analytics tool (readAt moved with it) is a reading, not a decision.
    if (b.current !== a.current && a.readAt === b.readAt)
      out.push(make({ kind: "metric", card: id, cardTitle: t, cardKind: "outcome", what: `${q(t)} is at ${num(a.current, a.unit)} now (was ${num(b.current, a.unit)})`, detail: { field: "current", from: b.current, to: a.current, metric: metricOf(a) }, big: false }));
  }
  return out;
}

export const metricOf = (m: OstMetric) => ({ name: m.name, ...(m.unit ? { unit: m.unit } : {}), baseline: m.baseline, current: m.current, target: m.target });

/**
 * Whether `later` takes `earlier` back (an undo, or doing the reverse): the same card back where it
 * was. Then the earlier decision is marked undone instead of a second one being recorded.
 */
export function reverses(later: Decision, earlier: Decision): boolean {
  if (earlier.undone) return false;
  const a = (later.detail ?? {}) as Record<string, unknown>;
  const b = (earlier.detail ?? {}) as Record<string, unknown>;
  // The target back on the card it was taken from: recorded on that card, naming this one.
  if (later.kind === "target" && earlier.kind === "target" && b.replaced && later.card === b.replaced && a.replaced === earlier.card) return true;
  if (later.card !== earlier.card) return false;
  if ((later.kind === "stage" || later.kind === "target") && (earlier.kind === "stage" || earlier.kind === "target")) return a.from === b.to && a.to === b.from;
  if (later.kind === "move" && earlier.kind === "move") return a.from === b.to && a.to === b.from;
  if (later.kind === "metric" && earlier.kind === "metric") return a.field === b.field && a.from === b.to && a.to === b.from;
  return false;
}

/** The same decision made again (a redo): same kind, card and change. */
export const sameDecision = (a: Decision, b: Decision) => a.kind === b.kind && a.card === b.card && JSON.stringify(a.detail ?? {}) === JSON.stringify(b.detail ?? {});

/** Cards that weren't on the board and are now (added, or back after an undo). */
export function cardsBack(prev: Doc, next: Doc): string[] {
  if (prev.nodes === next.nodes) return [];
  const before = prev.nodes as unknown as Record<string, Node>;
  return Object.entries(next.nodes as unknown as Record<string, Node>)
    .filter(([id, n]) => n.meta?.ost && !before[id]?.meta?.ost)
    .map(([id]) => id);
}

/**
 * What to stamp with the time after a change: cards whose stage changed (or that are new and
 * have no time yet), and assumptions just added. Checks that look at time (a test running for
 * weeks, a risky assumption never tested) read these.
 */
export function stampsOf(prev: Doc, next: Doc): { stage: string[]; assumptions: Record<string, string[]> } {
  const out = { stage: [] as string[], assumptions: {} as Record<string, string[]> };
  if (prev.nodes === next.nodes) return out;
  const before = prev.nodes as unknown as Record<string, Node>;
  for (const [id, n] of Object.entries(next.nodes as unknown as Record<string, Node>)) {
    const c = n.meta?.ost;
    if (!c) continue;
    const was = before[id]?.meta?.ost;
    if (was ? was.stage !== c.stage : !c.stageAt) out.stage.push(id);
    const had = new Set((was?.assumptions ?? []).map((a) => a.id));
    const fresh = (c.assumptions ?? []).filter((a) => !had.has(a.id) && !a.at).map((a) => a.id);
    if (fresh.length) out.assumptions[id] = fresh;
  }
  return out;
}
