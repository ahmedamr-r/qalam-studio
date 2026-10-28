import { create } from "zustand";
import { nanoid } from "nanoid";
import { studio, useStudio } from "@/doc/store";
import type { Doc } from "@/doc/schema";
import { cardOf } from "@/discovery/ops";
import type { Proposal } from "@/discovery/proposals";
import type { OstCard } from "@/discovery/types";
import { cardsBack, decisionsFromDiff, reverses, sameDecision, stampsOf } from "@/decisions/diff";
import type { Decision, DecisionKind } from "@/decisions/model";
import { orgFetch } from "@/org/client";
import { currentProject, onDocFromElsewhere } from "@/projects/session";
import { editsByQalam, linkedCards } from "../discovery/goals";
import { decisionsChanged } from "./list";

/**
 * Decision memory on a board (src/decisions): once changes settle, the board is compared with how
 * it was, and what was decided goes to the organization's log, by code, with no tokens. The first
 * big decision asks why (WhyPrompt). Taking a change back soon after (⌘Z, or doing the reverse)
 * marks its decision undone instead of recording a second one; doing it again un-marks it.
 */

const SETTLE = 1500;
/** How long taking a change back counts as undoing it, rather than a decision of its own. */
const UNDO_WINDOW = 10 * 60_000;

/** The big decision waiting for its why (one at a time). */
export const useWhy = create<{ ask: Decision | null }>(() => ({ ask: null }));

let base: Doc | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let stopActive: (() => void) | null = null;
/** This window's recent decisions, oldest first: what an undo can take back. */
let recent: Decision[] = [];
/** Writes to the log go out in order, so a why or an undo never arrives before its decision. */
let queue: Promise<unknown> = Promise.resolve();
const send = (fn: () => Promise<unknown>) => (queue = queue.then(fn).then(decisionsChanged).catch(() => {}));

export function startRecorder(): () => void {
  stopActive?.();
  base = studio().doc;
  recent = [];
  const unsub = useStudio.subscribe((s, prev) => {
    if (s.doc === prev.doc || s.txBase) return;
    clearTimeout(timer);
    timer = setTimeout(() => record(), SETTLE);
  });
  // Another window's change, or the folder's: its decisions were recorded where they were made.
  const unElsewhere = onDocFromElsewhere((doc, before) => {
    record({ upTo: before });
    base = doc;
    clearTimeout(timer);
  });
  const onHide = () => document.visibilityState === "hidden" && record({ leaving: true });
  const onPageHide = () => record({ leaving: true });
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onPageHide);
  const stop = () => {
    record();
    unsub();
    unElsewhere();
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onPageHide);
    if (stopActive === stop) stopActive = null;
  };
  stopActive = stop;
  return stop;
}

interface RecordOpts {
  /** Compare up to this document (one from elsewhere is about to replace it). */
  upTo?: Doc;
  /** Qalam AI's proposals, accepted: their decisions are Qalam AI's, with its reasons. */
  by?: Decision["by"];
  why?: (card: string) => string | undefined;
  /** The page is going: send with keepalive. */
  leaving?: boolean;
}

/** Record what changed since last time, now. Returns the decisions it found. */
function record(opts: RecordOpts = {}): Decision[] {
  clearTimeout(timer);
  const p = currentProject();
  if (!p || p.type !== "discovery" || !base) return [];
  // Mid-gesture (a drag): wait for it to end.
  if (studio().txBase && !opts.upTo) {
    timer = setTimeout(() => record(), SETTLE);
    return [];
  }
  const prev = base;
  const next = opts.upTo ?? studio().doc;
  if (prev === next) return [];
  base = next;
  const now = Date.now();
  const found = decisionsFromDiff(prev, next, { board: p.id, boardName: p.name, product: p.product ?? null, now, by: opts.by, newId: () => nanoid(10), linked: linkedCards() });
  recent = recent.filter((d) => now - d.at < UNDO_WINDOW);

  const fresh: Decision[] = [];
  const marks: { d: Decision; undone: boolean }[] = [];
  const latest = (test: (r: Decision) => boolean) => [...recent].reverse().find(test);
  for (const d of found) {
    const back = latest((r) => !r.undone && reverses(d, r));
    if (back) marks.push({ d: back, undone: true });
    else {
      const again = latest((r) => !!r.undone && sameDecision(d, r));
      if (again) marks.push({ d: again, undone: false });
      else {
        const why = d.card ? opts.why?.(d.card) : undefined;
        fresh.push(why ? { ...d, why: why.slice(0, 500) } : d);
      }
    }
  }
  // A deleted or merged card back on the board: that deletion was undone.
  for (const id of cardsBack(prev, next)) {
    const gone = latest((r) => !r.undone && (r.kind === "drop" || r.kind === "merge") && r.card === id);
    if (gone) marks.push({ d: gone, undone: true });
  }

  if (fresh.length) {
    recent.push(...fresh);
    send(() => orgFetch("/decisions", { method: "POST", json: { decisions: fresh }, keepalive: opts.leaving }));
  }
  for (const { d, undone } of marks) {
    d.undone = undone || undefined;
    send(() => orgFetch(`/decisions/${d.id}`, { method: "PATCH", json: { undone }, keepalive: opts.leaving }));
    if (undone && useWhy.getState().ask?.id === d.id) useWhy.setState({ ask: null });
  }
  const big = fresh.find((d) => d.big && d.by === "you" && !d.why);
  if (big && !opts.leaving && !opts.upTo) useWhy.setState({ ask: big });

  if (!opts.upTo) stamp(prev, next, now);
  return fresh;
}

/** When each card got its stage, and each assumption was added (outside undo history). */
function stamp(prev: Doc, next: Doc, now: number) {
  const s = stampsOf(prev, next);
  if (!s.stage.length && !Object.keys(s.assumptions).length) return;
  studio().mutate(
    (d) => {
      for (const id of s.stage) {
        const c = (d.nodes[id]?.meta as { ost?: OstCard } | undefined)?.ost;
        if (c) c.stageAt = now;
      }
      for (const [id, ids] of Object.entries(s.assumptions)) {
        const c = (d.nodes[id]?.meta as { ost?: OstCard } | undefined)?.ost;
        for (const a of c?.assumptions ?? []) if (ids.includes(a.id)) a.at = now;
      }
    },
    { history: false },
  );
  base = studio().doc;
}

/** A decision about the open board that isn't a change to it (accepting or discarding Qalam AI's proposals). */
function decision(kind: DecisionKind, what: string, detail: Record<string, unknown>, extra: Partial<Decision> = {}): Decision | null {
  const p = currentProject();
  if (!p || p.type !== "discovery") return null;
  return { id: nanoid(10), at: Date.now(), kind, board: p.id, boardName: p.name, product: p.product ?? null, card: null, cardTitle: "", what, detail, by: "you", big: false, ...extra };
}

/** Write a decision (or a correction to one): its why, or that it was undone. */
export function patchDecision(id: string, patch: { why?: string | null; undone?: boolean }) {
  const mine = recent.find((d) => d.id === id);
  if (mine && patch.why !== undefined) mine.why = patch.why ?? undefined;
  return new Promise<void>((resolve, reject) =>
    send(() =>
      orgFetch(`/decisions/${id}`, { method: "PATCH", json: patch }).then(
        () => resolve(),
        (e) => reject(e),
      ),
    ),
  );
}

/** What one of Qalam AI's proposals was, in a few words, for the log. */
export function proposalLine(p: Proposal, doc: Doc): string {
  const t = (id: string | null) => `“${(id && cardOf(doc, id)?.title) || "a card"}”`;
  switch (p.kind) {
    case "card":
      return `Add “${p.card.title}”`;
    case "attach":
      return `Attach a quote to ${t(p.cardId)}`;
    case "against":
      return `Note a quote against ${t(p.cardId)}`;
    case "assumption":
      return `${p.assumptions.length} ${p.assumptions.length === 1 ? "assumption" : "assumptions"} for ${t(p.cardId)}`;
    case "metric":
      return `A number for ${t(p.cardId)}`;
    case "edit":
      return `Reword “${p.from}”${p.title ? ` as “${p.title}”` : ""}`;
    case "move":
      return `Move ${t(p.cardId)}${p.parentId ? ` under ${t(p.parentId)}` : " onto the board"}`;
    case "merge":
      return `Merge ${t(p.dropId)} into ${t(p.cardId)}`;
    case "note":
      return "A note beside the tree";
  }
}

const touched = (ps: Proposal[]) => [...new Set(ps.flatMap((p) => (p.kind === "merge" ? [p.cardId, p.dropId] : [p.cardId])))];

/**
 * Accept Qalam AI's proposals as a decision: `apply` changes the board; what that decided (a merge,
 * a move) is recorded as Qalam AI's, with its reason, and the accept itself is recorded too.
 */
export function recordAccepted(chosen: Proposal[], from: string, apply: () => string) {
  record();
  const doc = studio().doc;
  const lines = chosen.map((p) => ({ kind: p.kind, card: p.cardId, line: proposalLine(p, doc), why: p.why.slice(0, 200) }));
  // What it changes on a goal's card (its number, say) reaches the goal as Qalam AI's.
  editsByQalam();
  const said = apply();
  const reasons = new Map<string, string>();
  for (const p of chosen) {
    if (p.why) reasons.set(p.cardId, p.why);
    if (p.kind === "merge" && p.why) reasons.set(p.dropId, p.why);
  }
  record({ by: "qalam", why: (card) => reasons.get(card) });
  const d = decision("accept", `Accepted Qalam AI's proposals from ${from}${said ? `: ${said.replace(/ · /g, ", ")}` : ""}`, { from, cards: touched(chosen), proposals: lines.slice(0, 20) });
  if (d) {
    recent.push(d);
    send(() => orgFetch("/decisions", { method: "POST", json: { decisions: [d] } }));
  }
}

/** Discarding Qalam AI's proposals is a decision too: what it proposed, and that you left it. */
export function recordDiscarded(gone: Proposal[], from: string) {
  if (!gone.length) return;
  const doc = studio().doc;
  const n = gone.length;
  const d = decision("discard", `Discarded ${n === 1 ? "one of Qalam AI's proposals" : `${n} of Qalam AI's proposals`} from ${from}`, {
    from,
    cards: touched(gone).filter((id) => !!doc.nodes[id]),
    proposals: gone.slice(0, 20).map((p) => ({ kind: p.kind, card: p.cardId, line: proposalLine(p, doc), why: p.why.slice(0, 200) })),
  });
  if (d) send(() => orgFetch("/decisions", { method: "POST", json: { decisions: [d] } }));
}
