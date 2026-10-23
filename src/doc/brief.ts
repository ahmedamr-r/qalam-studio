/**
 * Knowledge hub helpers (pure). The brief is what the designer told the AI critic about the
 * project: their answers verbatim, a synthesised summary, and per-screen goals and verdicts.
 */
import type { BriefAnswer, BriefTopic, Doc, GoalVerdict, ProjectBrief, ScreenBrief } from "./schema";

export const BRIEF_TOPICS = ["goal", "audience", "problem", "first-notice", "primary-action", "success-metric", "constraints", "other"] as const satisfies readonly BriefTopic[];
export const TOPIC_LABEL: Record<BriefTopic, string> = {
  goal: "Goal",
  audience: "Audience",
  problem: "Problem",
  "first-notice": "Noticed first",
  "primary-action": "Primary action",
  "success-metric": "Success signal",
  constraints: "Constraints",
  other: "Other",
};
const VERDICTS: readonly unknown[] = ["unknown", "meets", "partially", "misses"] satisfies GoalVerdict[];

export const MAX_ANSWERS = 40;
const MAX_SCREENS = 24;

export const emptyBrief = (): ProjectBrief => ({ summary: "", answers: [], screens: {}, updatedAt: 0 });

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function normalizeScreen(v: unknown): ScreenBrief | null {
  const o = obj(v);
  if (!o) return null;
  const s: ScreenBrief = { name: str(o.name, 120), goal: str(o.goal, 400), firstNotice: str(o.firstNotice, 400), primaryAction: str(o.primaryAction, 400) };
  const lc = obj(o.lastCritique);
  if (lc && typeof lc.at === "number") {
    s.lastCritique = {
      at: lc.at,
      verdict: VERDICTS.includes(lc.verdict) ? (lc.verdict as GoalVerdict) : "unknown",
      headline: str(lc.headline, 400),
      keyIssues: Array.isArray(lc.keyIssues) ? lc.keyIssues.map((k) => str(k, 200)).filter(Boolean).slice(0, 5) : [],
    };
  }
  return s;
}

/** Validate a brief read from storage or an opened file; garbage becomes undefined. */
export function normalizeBrief(x: unknown): ProjectBrief | undefined {
  const o = obj(x);
  if (!o) return undefined;
  const answers: BriefAnswer[] = [];
  for (const a of Array.isArray(o.answers) ? o.answers : []) {
    const r = obj(a);
    if (!r || typeof r.answer !== "string" || !r.answer.trim()) continue;
    answers.push({
      id: str(r.id, 40) || `a${answers.length}`,
      topic: (BRIEF_TOPICS as readonly unknown[]).includes(r.topic) ? (r.topic as BriefTopic) : "other",
      question: str(r.question, 400),
      answer: str(r.answer, 600),
      screenIds: Array.isArray(r.screenIds) ? r.screenIds.filter((s): s is string => typeof s === "string").slice(0, 8) : [],
      at: typeof r.at === "number" ? r.at : 0,
    });
  }
  const screens: Record<string, ScreenBrief> = {};
  for (const [id, v] of Object.entries(obj(o.screens) ?? {})) {
    const s = normalizeScreen(v);
    if (s) screens[id] = s;
  }
  return { summary: str(o.summary, 2000), answers: answers.slice(-MAX_ANSWERS), screens, updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : 0 };
}

/** Add an answer; past the limit the oldest go first, except ones the designer pinned in the Knowledge hub. */
export function appendAnswer(b: ProjectBrief | undefined, a: BriefAnswer, pinned: (id: string) => boolean = () => false): ProjectBrief {
  const base = b ?? emptyBrief();
  const all = [...base.answers, a];
  let drop = Math.max(0, all.length - MAX_ANSWERS);
  const answers = all.filter((x) => {
    if (!drop || x === a || pinned(x.id)) return true;
    drop--;
    return false;
  });
  return { ...base, answers, updatedAt: a.at };
}

export function removeAnswer(b: ProjectBrief, id: string, now: number): ProjectBrief {
  return { ...b, answers: b.answers.filter((a) => a.id !== id), updatedAt: now };
}

export function updateScreen(b: ProjectBrief | undefined, id: string, name: string, patch: Partial<ScreenBrief>, now: number): ProjectBrief {
  const base = b ?? emptyBrief();
  const cur = base.screens[id] ?? { name, goal: "", firstNotice: "", primaryAction: "" };
  return { ...base, screens: { ...base.screens, [id]: { ...cur, ...patch, name } }, updatedAt: now };
}

/** A screen's entry: by id, else inherited from a screen with the same name (duplicates, pastes). */
export function screenBriefFor(b: ProjectBrief | undefined, doc: Doc, id: string): (ScreenBrief & { inheritedFrom?: string }) | null {
  if (!b) return null;
  if (b.screens[id]) return b.screens[id];
  const name = doc.nodes[id]?.name;
  if (!name) return null;
  const hit = Object.entries(b.screens).find(([sid, s]) => sid !== id && s.name === name && (s.goal || s.firstNotice || s.primaryAction));
  return hit ? { ...hit[1], inheritedFrom: name } : null;
}

/** Enough is known about the screen to give a verdict without asking. */
export function isCovered(s: ScreenBrief | null): boolean {
  return !!s && !!s.goal && !!(s.firstNotice || s.primaryAction);
}

// ---------------------------------------------------------------------------
// Merging a critique turn into the brief.

export interface TurnUpdate {
  summary: string;
  screens: { screenId: string; goal: string; firstNotice: string; primaryAction: string }[];
  /** Set when the session reached a verdict. */
  verdict?: { verdict: GoalVerdict; headline: string; issuesByScreen: Record<string, string[]> };
}

/**
 * Merge the critic's update. Only session screens are touched, and a known field is never
 * blanked by an empty value (the model returns "" for "nothing new").
 */
export function applyTurn(b: ProjectBrief | undefined, turn: TurnUpdate, session: { id: string; name: string }[], doc: Doc, now: number): ProjectBrief {
  const base = b ?? emptyBrief();
  const screens = { ...base.screens };
  for (const { id, name } of session) {
    const cur = screens[id] ?? (() => {
      const inherited = screenBriefFor(base, doc, id);
      return inherited ? { name, goal: inherited.goal, firstNotice: inherited.firstNotice, primaryAction: inherited.primaryAction } : { name, goal: "", firstNotice: "", primaryAction: "" };
    })();
    const next: ScreenBrief = { ...cur, name };
    const u = turn.screens.find((s) => s.screenId === id);
    if (u) {
      if (u.goal.trim()) next.goal = u.goal.trim().slice(0, 400);
      if (u.firstNotice.trim()) next.firstNotice = u.firstNotice.trim().slice(0, 400);
      if (u.primaryAction.trim()) next.primaryAction = u.primaryAction.trim().slice(0, 400);
    }
    if (turn.verdict && turn.verdict.verdict !== "unknown") {
      next.lastCritique = { at: now, verdict: turn.verdict.verdict, headline: turn.verdict.headline.slice(0, 400), keyIssues: (turn.verdict.issuesByScreen[id] ?? []).map((k) => k.slice(0, 200)).slice(0, 5) };
    }
    const changed = next.goal || next.firstNotice || next.primaryAction || next.lastCritique;
    if (changed || screens[id]) screens[id] = next;
  }
  return pruneOrphans({ ...base, summary: turn.summary.trim() ? turn.summary.trim().slice(0, 2000) : base.summary, screens, updatedAt: now }, doc);
}

/** Drop entries for deleted screens, but only once there are many (undo can bring frames back). */
export function pruneOrphans(b: ProjectBrief, doc: Doc): ProjectBrief {
  if (Object.keys(b.screens).length <= MAX_SCREENS) return b;
  return { ...b, screens: Object.fromEntries(Object.entries(b.screens).filter(([id]) => doc.nodes[id])) };
}

// ---------------------------------------------------------------------------
// What the critic sees of the brief (bounded).

export interface BriefPayload {
  summary: string;
  answers: { topic: BriefTopic; question: string; answer: string; screens: string[] }[];
  screens: { id: string; name: string; goal: string; firstNotice: string; primaryAction: string; inheritedFrom: string; lastCritique: string }[];
  otherScreens: { name: string; goal: string }[];
}

/**
 * The brief as sent with a critique. Answers given during the current session (at >= since)
 * are left out because the transcript already carries them.
 */
export function briefForRequest(b: ProjectBrief | undefined, doc: Doc, sessionIds: string[], since: number): BriefPayload {
  const nameOf = (id: string) => doc.nodes[id]?.name ?? b?.screens[id]?.name ?? "deleted screen";
  if (!b) return { summary: "", answers: [], screens: [], otherScreens: [] };
  const screens = sessionIds.flatMap((id) => {
    const s = screenBriefFor(b, doc, id);
    if (!s) return [];
    const lc = s.lastCritique;
    return [{
      id,
      name: nameOf(id).slice(0, 120),
      goal: s.goal,
      firstNotice: s.firstNotice,
      primaryAction: s.primaryAction,
      inheritedFrom: s.inheritedFrom ?? "",
      lastCritique: lc ? `${new Date(lc.at).toISOString().slice(0, 10)}: ${lc.verdict} — ${lc.headline}${lc.keyIssues.length ? ` (flagged: ${lc.keyIssues.join("; ")})` : ""}`.slice(0, 1000) : "",
    }];
  });
  const otherScreens = Object.entries(b.screens)
    .filter(([id, s]) => !sessionIds.includes(id) && doc.nodes[id] && s.goal)
    .slice(0, 12)
    .map(([id, s]) => ({ name: nameOf(id).slice(0, 120), goal: s.goal.slice(0, 300) }));
  return {
    summary: b.summary.slice(0, 2000),
    answers: b.answers
      .filter((a) => a.at < since)
      .slice(-30)
      .map((a) => ({ topic: a.topic, question: a.question.slice(0, 300), answer: a.answer.slice(0, 600), screens: a.screenIds.map((id) => nameOf(id).slice(0, 120)).slice(0, 4) })),
    screens,
    otherScreens,
  };
}
