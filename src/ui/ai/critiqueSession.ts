/**
 * Critique session: capture the selected screens once, then run one turn per answer against
 * /api/critique. Answers and verdicts are written into doc.brief (the Knowledge hub) as they
 * happen, outside undo history, so nothing is lost if a later turn fails.
 */
import { create } from "zustand";
import { studio } from "@/doc/store";
import { release, reserve } from "@/doc/reservations";
import type { BriefTopic, Doc } from "@/doc/schema";
import { descendants, topFrameOf, worldBounds } from "@/doc/geometry";
import { appendAnswer, applyTurn, screenBriefFor } from "@/doc/brief";
import { critiqueBrief } from "@/knowledge/brief";
import { ref } from "@/knowledge/refs";
import { entry, mergeManifest, researchEntries, stripFactIds, type Manifest } from "@/knowledge/trace";
import { critiqueResearchRef, fixContext, recordCritique, recordFix, systemEntries, withKnowledge } from "../knowledge/record";
import { auditSubtree, lintNodes } from "@/lint/rules";
import { callAI, aiStatus, AIError, type AIEvent } from "@/ai/client";
import type { ResearchInfo } from "@/ai/research-shared";
import { MAX_QUESTIONS, type CritiqueIssue, type CritiqueQuestion, type CritiqueResult, type GoalFit } from "@/ai/critique";
import { IMAGE_BUDGET, type CritiqueRequest } from "@/ai/critique-request";
import type { FixRequest } from "@/ai/critique-fix";
import type { RestyleResult } from "@/ai/ds-schemas";
import { systemPayload } from "@/ai/ds-payload";
import { SAMPLE_CRITIQUE_TURNS, sampleFix } from "@/ai/fixtures-critique";
import { dsIdForNode, systemFor } from "@/design-system/registry";
import { replaceScreen } from "@/design-system/apply";
import { ensureSystemFonts } from "@/design-system/place";
import type { ScreenSpec } from "@/design-system/builders";
import { ensureYoga } from "@/engine/layout";
import { nodeToDataURL } from "../exporter";
import { getController } from "../CanvasView";
import { outline } from "./outline";
import { activeConnectors } from "./connectors";

export const MAX_SCREENS = 4;

export interface Turn {
  topic: BriefTopic;
  question: string;
  /** null when skipped */
  answer: string | null;
  /** The answer's id in the brief (the critic cites it as [qN]; the hub shows it as that answer). */
  answerId?: string;
}

/**
 * A critique issue in the session: a stable id (per-issue fixes are keyed by it) and where it was
 * found, recorded when it arrived because any fix rebuilds the screen's layers with new ids.
 */
export type SessionIssue = CritiqueIssue & { id: string; at: string };

/** One issue fixed on its own, from the Fix button on its row. Fixes run one at a time. */
export interface IssueFix {
  status: "queued" | "running" | "done" | "error";
  /** When it was asked for (queue order), then when it started running. */
  started: number;
  tokens: number;
  error: string | null;
  changes: string[];
  /** The screen was drawn by hand, so it was rebuilt from catalog components. */
  rebuilt: boolean;
  /** Undo history length right after the fix, so Undo only reverts the fix itself. */
  pastLen: number;
  sample: boolean;
}

/** "Fix all": the screens are revised by Claude and rebuilt in place as one undo step. */
export interface FixState {
  status: "running" | "done" | "error" | "undone";
  started: number;
  tokens: number;
  error: string | null;
  changes: { screen: string; summary: string }[];
  /** Hand-drawn screens that were rebuilt from catalog components. */
  rebuilt: string[];
  failed: string[];
  /** Undo history length right after the fix, so Undo only reverts the fix itself. */
  pastLen: number;
  sample: boolean;
}

export interface CritiqueSession {
  screenIds: string[];
  names: Record<string, string>;
  captures: CritiqueRequest["screens"];
  lint: CritiqueRequest["lint"];
  /** Selected screens beyond the cap, and screens sent without an image (size budget). */
  dropped: number;
  outlineOnly: number;
  startedAt: number;
  /**
   * Where it was started. From the AI chat it continues the open chat; from the canvas (or the
   * Knowledge hub) it opens a chat of its own. See mirrorCritique in chats.ts.
   */
  origin: "chat" | "canvas";
  /** The critique it repeats ("Critique again" in the card): it continues in that one's chat. */
  after?: number;
  transcript: Turn[];
  summary: string;
  /** Most severe first. */
  issues: SessionIssue[];
  issueFixes: Record<string, IssueFix>;
  goalFit: GoalFit | null;
  question: CritiqueQuestion | null;
  status: "busy" | "asking" | "done" | "error";
  busySince: number;
  tokens: number;
  error: string | null;
  /** The pending turn was a forced verdict (so Retry repeats it). */
  concluding: boolean;
  sample: boolean;
  model?: string;
  minimised: boolean;
  fix: FixState | null;
  /** The research step's latest lookup, while it runs (first turn only). */
  activity?: string;
  /** What the first turn looked up; later turns resend its notes. */
  research?: ResearchInfo;
}

export const useCritique = create<{ session: CritiqueSession | null }>(() => ({ session: null }));

/** Owner of the canvas space a critique's fixes hold: the Critic's cursor stands for it. */
export const CRITIQUE_OWNER = "critique";

const get = () => useCritique.getState().session;
const patch = (p: Partial<CritiqueSession>) => {
  const s = get();
  if (s) useCritique.setState({ session: { ...s, ...p } });
};

let abort: AbortController | null = null;
/** The running single-issue fix, apart from critique turns so a fix doesn't cancel a question. */
let fixAbort: AbortController | null = null;

const SEVERITY_RANK = { critical: 0, major: 1, minor: 2 } as const;

/** Root frames for a selection (any layer maps to its screen), left to right. */
export function screensOf(doc: Doc, ids: string[]): string[] {
  const set = new Set<string>();
  for (const id of ids) {
    if (!doc.nodes[id]) continue;
    const top = topFrameOf(doc, id);
    if (doc.nodes[top]?.type === "frame") set.add(top);
  }
  return [...set].sort((a, b) => worldBounds(doc, a).x - worldBounds(doc, b).x);
}

function capture(doc: Doc, ids: string[]) {
  let budget = IMAGE_BUDGET;
  let outlineOnly = 0;
  const captures = ids.map((id) => {
    const b = worldBounds(doc, id);
    // Claude downsizes anything over ~1568px on the long edge, so don't send more than that.
    const url = nodeToDataURL(id, Math.min(1, 1568 / Math.max(b.w, b.h, 1)));
    const data = url?.split(",")[1];
    const fits = !!data && data.length <= budget;
    if (fits) budget -= data.length;
    else outlineOnly++;
    return { id, name: doc.nodes[id].name.slice(0, 120), outline: outline(doc, id).slice(0, 7900), ...(fits ? { image: data } : {}) };
  });
  const lint = auditSubtree(doc, ids)
    .filter((f) => f.severity !== "info")
    .slice(0, 60)
    .map((f) => ({ nodeId: f.nodeId, rule: f.rule.slice(0, 40), severity: f.severity, message: f.message.slice(0, 200) }));
  return { captures, lint, outlineOnly };
}

export function startCritique(ids: string[], from: { origin?: CritiqueSession["origin"]; after?: number } = {}) {
  const { doc } = studio();
  const all = screensOf(doc, ids);
  const screenIds = all.slice(0, MAX_SCREENS);
  if (!screenIds.length) return;
  abort?.abort();
  fixAbort?.abort();
  const { captures, lint, outlineOnly } = capture(doc, screenIds);
  const now = Date.now();
  useCritique.setState({
    session: {
      screenIds,
      names: Object.fromEntries(screenIds.map((id) => [id, doc.nodes[id].name])),
      captures,
      lint,
      dropped: all.length - screenIds.length,
      outlineOnly,
      startedAt: now,
      origin: from.origin ?? "canvas",
      ...(from.after !== undefined ? { after: from.after } : {}),
      transcript: [],
      summary: "",
      issues: [],
      issueFixes: {},
      goalFit: null,
      question: null,
      status: "busy",
      busySince: now,
      tokens: 0,
      error: null,
      concluding: false,
      sample: false,
      minimised: false,
      fix: null,
    },
  });
  void runTurn(false);
}

async function runTurn(mustConclude: boolean) {
  const s = get();
  if (!s) return;
  let given: Manifest | null = null;
  patch({ status: "busy", busySince: Date.now(), tokens: 0, error: null, concluding: mustConclude });
  const status = await aiStatus();
  let result: CritiqueResult;
  let model: string | undefined;
  let sample = false;
  if (!status.ai) {
    sample = true;
    const i = mustConclude ? SAMPLE_CRITIQUE_TURNS.length - 1 : Math.min(s.transcript.length, SAMPLE_CRITIQUE_TURNS.length - 1);
    result = structuredClone(SAMPLE_CRITIQUE_TURNS[i]);
  } else {
    const { doc } = studio();
    abort = new AbortController();
    const mine = abort;
    try {
      // The brief and this session's answers, each with the id the critic cites it by.
      const brief = critiqueBrief(doc.brief, doc, s.screenIds, s.startedAt, doc.knowledge);
      const qs = s.transcript.flatMap((t, i) => (t.answer && t.answerId ? [entry(`q${i + 1}`, ref.answer(t.answerId), t.answer)] : []));
      given = mergeManifest(brief.entries, qs, researchEntries(critiqueResearchRef(s.startedAt), s.transcript.length ? s.research?.notes : undefined));
      const body: CritiqueRequest = {
        screens: s.captures,
        lint: s.lint,
        brief: brief.payload,
        transcript: s.transcript.map(({ topic, question, answer, answerId }, i) => ({ topic, question, answer: answer && answerId ? `[q${i + 1}] ${answer}` : answer })),
        reported: s.issues.slice(0, 20).map((i) => `[${i.heuristic}] ${i.issue}`.slice(0, 320)),
        mustConclude,
        ...(s.transcript.length ? { research: (!doc.knowledge?.forgotten[ref.research(critiqueResearchRef(s.startedAt))] && s.research?.notes) || undefined } : { connectors: await activeConnectors() }),
      };
      const onProgress = (tokens: number) => {
        if (get()?.startedAt === s.startedAt) patch({ tokens });
      };
      const onEvent = (e: AIEvent) => {
        if (get()?.startedAt === s.startedAt) patch(e.type === "activity" ? { activity: e.label } : { research: e.research, activity: undefined });
      };
      ({ data: result, model } = await callAI<CritiqueResult>("/api/critique", body, onProgress, mine.signal, onEvent));
    } catch (e) {
      if (get()?.startedAt !== s.startedAt) return; // superseded by a newer session
      const stopped = (e as Error).name === "AbortError";
      patch({ status: "error", activity: undefined, error: stopped ? "Stopped." : e instanceof AIError ? e.message : String(e) });
      return;
    }
  }
  const cur = get();
  if (!cur || cur.startedAt !== s.startedAt) return;
  apply(sanitize(result, cur), { sample, model, forceDone: mustConclude || cur.transcript.length >= MAX_QUESTIONS });
  // First turn: the research it ran was given too.
  const notes = !s.transcript.length ? get()?.research?.notes : undefined;
  const manifest = mergeManifest(given?.entries, researchEntries(critiqueResearchRef(s.startedAt), notes));
  const after = get();
  const produced = [ref.summary, ...cur.screenIds.flatMap((id) => [ref.screenGoal(id), ...(after?.status === "done" ? [ref.verdict(id)] : [])])];
  recordCritique({ startedAt: s.startedAt, screenIds: cur.screenIds, title: cur.screenIds.map((id) => cur.names[id]).join(", "), manifest, reliedOn: result.reliedOn, summary: after?.summary ?? "", model, sample, produced });
}

function apply(r: CritiqueResult, o: { sample: boolean; model?: string; forceDone: boolean }) {
  const s = get()!;
  const { doc } = studio();
  const question = o.forceDone ? null : r.question;
  const done = !question;
  // Follow-up turns add only what the answers revealed; the first turn carries the critique.
  const fresh = (s.issues.length ? r.issues.slice(0, 3) : r.issues).map((i, k) => ({ ...i, id: `${s.startedAt.toString(36)}-${s.issues.length + k}`, at: locate(doc, i.nodeId).slice(0, 160) }));
  // Stable sort: the model's order is kept within a severity.
  const issues = [...s.issues, ...fresh].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  patch({
    summary: r.summary || s.summary,
    issues,
    goalFit: r.goalFit,
    question,
    status: done ? "done" : "asking",
    sample: s.sample || o.sample,
    model: o.model ?? s.model,
  });

  const issuesByScreen = Object.fromEntries(s.screenIds.map((id) => [id, issues.filter((i) => i.screenId === id).map((i) => i.issue)]));
  const next = applyTurn(
    doc.brief,
    { summary: r.brief.summary, screens: r.brief.screens, verdict: done ? { verdict: r.goalFit.verdict, headline: r.goalFit.rationale, issuesByScreen } : undefined },
    s.screenIds.filter((id) => doc.nodes[id]).map((id) => ({ id, name: doc.nodes[id].name })),
    doc,
    Date.now(),
  );
  studio().mutate((d) => {
    d.brief = next;
  }, { history: false });
}

/**
 * Keep the model's output inside the session: unknown screen ids are dropped, node ids must be
 * inside a critiqued screen (a layer name is accepted and resolved), chips are capped at 4.
 */
function sanitize(raw: CritiqueResult, s: CritiqueSession): CritiqueResult {
  const { doc } = studio();
  const screens = new Set(s.screenIds.filter((id) => doc.nodes[id]));
  const fallbackScreen = s.screenIds.length === 1 || !raw.issues?.some((i) => screens.has(i.screenId)) ? s.screenIds[0] : "";
  const byName = new Map<string, string>();
  for (const sid of screens) for (const id of [sid, ...descendants(doc, sid)]) if (!byName.has(doc.nodes[id].name.toLowerCase())) byName.set(doc.nodes[id].name.toLowerCase(), id);
  const node = (id: string) => {
    if (!id) return "";
    if (doc.nodes[id] && screens.has(topFrameOf(doc, id))) return id;
    return byName.get(id.toLowerCase()) ?? "";
  };
  const screenOf = (sid: string, nodeId: string) => (nodeId ? topFrameOf(doc, nodeId) : screens.has(sid) ? sid : fallbackScreen);
  // Fact ids the critic might have copied into its words ("[b2]") never reach the card or the brief.
  const clip = (v: unknown, n: number) => (typeof v === "string" ? stripFactIds(v).slice(0, n) : "");

  const issues = (raw.issues ?? []).slice(0, 8).map((i) => {
    const nodeId = node(i.nodeId);
    return { ...i, nodeId, screenId: screenOf(i.screenId, nodeId), issue: clip(i.issue, 300), fix: clip(i.fix, 240) };
  });
  const g = raw.goalFit ?? { verdict: "unknown", confidence: "low", rationale: "", mustChange: [] };
  const q = raw.question;
  return {
    summary: clip(raw.summary, 600),
    issues,
    goalFit: { ...g, rationale: clip(g.rationale, 600), mustChange: (g.mustChange ?? []).slice(0, 5).map((m) => ({ nodeId: node(m.nodeId), change: clip(m.change, 240) })) },
    question:
      q && clip(q.text, 400)
        ? { ...q, text: clip(q.text, 400), why: clip(q.why, 300), options: (q.options ?? []).map((o) => clip(o, 60)).filter(Boolean).slice(0, 4), screenId: screens.has(q.screenId) ? q.screenId : "" }
        : null,
    brief: {
      summary: clip(raw.brief?.summary, 2000),
      screens: (raw.brief?.screens ?? []).flatMap((b) => {
        const screenId = screens.has(b.screenId) ? b.screenId : s.screenIds.length === 1 ? s.screenIds[0] : "";
        return screenId ? [{ ...b, screenId, goal: clip(b.goal, 400), firstNotice: clip(b.firstNotice, 400), primaryAction: clip(b.primaryAction, 400) }] : [];
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Actions used by the canvas card and the Knowledge hub.

export function answer(text: string) {
  const s = get();
  const q = s?.question;
  const value = text.trim().slice(0, 600);
  if (!s || !q || !value || s.status !== "asking") return;
  const now = Date.now();
  const { doc } = studio();
  const answerId = `a${now.toString(36)}`;
  const next = appendAnswer(doc.brief, {
    id: answerId,
    topic: q.topic,
    question: q.text,
    answer: value,
    screenIds: q.screenId ? [q.screenId] : s.screenIds,
    at: now,
  }, (aid) => !!doc.knowledge?.pinned[ref.answer(aid)]);
  studio().mutate((d) => {
    d.brief = next;
  }, { history: false });
  patch({ transcript: [...s.transcript, { topic: q.topic, question: q.text, answer: value, answerId }], question: null });
  void runTurn(s.transcript.length + 1 >= MAX_QUESTIONS);
}

export function skip() {
  const s = get();
  const q = s?.question;
  if (!s || !q || s.status !== "asking") return;
  patch({ transcript: [...s.transcript, { topic: q.topic, question: q.text, answer: null }], question: null });
  void runTurn(s.transcript.length + 1 >= MAX_QUESTIONS);
}

/** "Give me the verdict": skip the pending question and conclude. */
export function conclude() {
  const s = get();
  if (!s || s.status === "busy") return;
  patch({ question: null });
  void runTurn(true);
}

export function retry() {
  const s = get();
  if (s?.status === "error") void runTurn(s.concluding);
}

// ---------------------------------------------------------------------------
// Fix all

/** Where a layer sits in the screen's spec, for the fix prompt ("body.2 · \"Message\""). */
function locate(doc: Doc, nodeId: string): string {
  let n = doc.nodes[nodeId];
  if (!n) return "";
  const name = (n.meta.component ?? n.name).slice(0, 60);
  while (n && n.meta.specPath === undefined && n.parentId) n = doc.nodes[n.parentId];
  const path = n?.meta.specPath;
  return path ? `${path} · "${name}"` : `"${name}"`;
}

const patchFix = (p: Partial<FixState>) => {
  const s = get();
  if (s?.fix) patch({ fix: { ...s.fix, ...p } });
};

type Finding = FixRequest["findings"][number];
type MustChange = FixRequest["mustChange"][number];
interface Revision {
  id: string;
  dsId: string;
  spec: ScreenSpec | undefined;
  result: RestyleResult;
  sample: boolean;
}

const findingOf = (i: SessionIssue): Finding => ({ severity: i.severity, heuristic: i.heuristic, issue: i.issue.slice(0, 300), fix: i.fix.slice(0, 240), at: i.at });

/**
 * One screen revised to resolve the findings: /api/critique-fix returns a revised catalog spec
 * (a hand-drawn screen is rebuilt from catalog components). Without AI, the recorded sample.
 */
async function reviseScreen(id: string, ai: boolean, findings: Finding[], must: MustChange[], signal: AbortSignal, onProgress: (tokens: number) => void): Promise<Revision> {
  const { doc } = studio();
  const spec = doc.nodes[id].meta.spec;
  const dsId = dsIdForNode(doc, id);
  if (!ai) {
    // Goal changes aren't tied to a heuristic, so they take the whole recorded fix.
    const result = sampleFix(spec, must.length ? undefined : findings.map((f) => f.heuristic));
    if (!result) throw new AIError("no_key", "AI isn't configured, and the recorded fix only covers “Order tracking · Map first”.");
    if (!result.changes.length) throw new AIError("no_key", "AI isn't configured, and the recorded sample has no fix for this.");
    return { id, dsId, spec, result, sample: true };
  }
  const b = worldBounds(doc, id);
  const img = spec ? null : nodeToDataURL(id, Math.min(1, 1568 / Math.max(b.w, b.h, 1)));
  const session = get();
  const designSystem = withKnowledge(systemPayload(systemFor(dsId)));
  const ctx = fixContext(doc, id, session?.startedAt);
  const body: FixRequest = {
    spec,
    outline: spec ? undefined : outline(doc, id).slice(0, 19000),
    image: img?.split(",")[1],
    designSystem,
    context: ctx.context,
    findings,
    mustChange: must,
  };
  const { data, model } = await callAI<RestyleResult>("/api/critique-fix", body, onProgress, signal);
  if (session) recordFix({ startedAt: session.startedAt, frameId: id, name: doc.nodes[id]?.name ?? "", manifest: mergeManifest(systemEntries(designSystem), ctx.entries), reliedOn: data.reliedOn, summary: (data.changes ?? []).map((c) => stripFactIds(c.summary)).slice(0, 3).join(" · "), model });
  return { id, dsId, spec, result: data, sample: false };
}

/** Rebuild the revised screens in place, as one undo step. */
async function applyRevisions(revs: Revision[], nameOf: (id: string) => string) {
  await Promise.all([ensureYoga(), ...[...new Set(revs.map((o) => o.dsId))].map((d) => ensureSystemFonts(d))]);
  studio().beginTx();
  for (const o of revs) {
    const screen: ScreenSpec = { ...o.result.screen, name: o.result.screen.name || o.spec?.name || nameOf(o.id) };
    replaceScreen(o.id, screen, o.dsId);
  }
  studio().commitTx();
  lintNodes(revs.map((o) => o.id));
}

/** Issues not yet fixed on their own. */
export const openIssues = (s: CritiqueSession) => s.issues.filter((i) => s.issueFixes[i.id]?.status !== "done");

/** A single-issue fix is waiting or running. */
export const issueFixBusy = (s: CritiqueSession) => Object.values(s.issueFixes).some((f) => f.status === "queued" || f.status === "running");

/**
 * Apply every finding: each critiqued screen goes to /api/critique-fix with its issues, the
 * goal-fit changes and the designer's goal, and comes back as a revised catalog spec. All
 * screens are then rebuilt in place in one undo step. Issues already fixed on their own are left out.
 */
export async function fixAll() {
  const s = get();
  if (!s || s.status === "busy" || s.fix?.status === "running" || issueFixBusy(s)) return;
  const { doc } = studio();
  const ids = s.screenIds.filter((id) => doc.nodes[id]);
  const mustChange = s.goalFit?.verdict === "meets" ? [] : (s.goalFit?.mustChange ?? []);
  const open = openIssues(s);
  if (!ids.length || !(open.length || mustChange.length)) return;
  abort?.abort();
  abort = new AbortController();
  const mine = abort;
  patch({ question: null, status: "done", fix: { status: "running", started: Date.now(), tokens: 0, error: null, changes: [], rebuilt: [], failed: [], pastLen: 0, sample: false } });

  // The screens shimmer until their fixes are in.
  const held = reserve("Fixing", [], ids, CRITIQUE_OWNER);
  const results = await (async () => {
    const ai = (await aiStatus()).ai;
    const tokens: Record<string, number> = {};
    return Promise.allSettled(
      ids.map(async (id) => {
        const findings = open
          .filter((i) => i.screenId === id || (!i.screenId && ids.length === 1))
          .slice(0, 16)
          .map(findingOf);
        const must = mustChange
          .filter((m) => !m.nodeId || topFrameOf(doc, m.nodeId) === id)
          .map((m) => ({ change: m.change.slice(0, 240), at: locate(doc, m.nodeId).slice(0, 160) }));
        if (!findings.length && !must.length) return null;
        return reviseScreen(id, ai, findings, must, mine.signal, (t) => {
          tokens[id] = t;
          if (get()?.startedAt === s.startedAt) patchFix({ tokens: Object.values(tokens).reduce((a, n) => a + n, 0) });
        });
      }),
    );
  })().finally(() => release(held));
  if (get()?.startedAt !== s.startedAt) return; // closed or replaced meanwhile
  if (mine.signal.aborted) {
    patchFix({ status: "error", error: "Stopped." });
    return;
  }

  const nameOf = (id: string) => studio().doc.nodes[id]?.name ?? s.names[id];
  const ok = results.flatMap((r) => (r.status === "fulfilled" && r.value && studio().doc.nodes[r.value.id] ? [r.value] : []));
  const rejected = results.map((r, i) => [r, ids[i]] as const).filter(([r]) => r.status === "rejected");
  const reason = rejected[0] && (rejected[0][0] as PromiseRejectedResult).reason;
  const error = reason ? (reason instanceof AIError ? reason.message : String(reason)) : null;
  if (ok.length) await applyRevisions(ok, nameOf);
  patchFix({
    status: ok.length ? "done" : "error",
    error,
    changes: ok.flatMap((o) => (o.result.changes ?? []).map((c) => ({ screen: nameOf(o.id), summary: c.summary }))),
    rebuilt: ok.filter((o) => !o.spec).map((o) => nameOf(o.id)),
    failed: rejected.map(([, id]) => nameOf(id)),
    pastLen: studio().past.length,
    sample: ok.some((o) => o.sample),
  });
}

/** Revert the fix (only while it is still the latest undo step). */
export function undoFix() {
  const f = get()?.fix;
  if (f?.status !== "done" || studio().past.length !== f.pastLen) return;
  studio().undo();
  patchFix({ status: "undone" });
}

// ---------------------------------------------------------------------------
// Fixing one issue at a time

/** The screen an issue belongs to (an issue without one is fine when only one screen is critiqued). */
export function issueScreen(s: CritiqueSession, i: SessionIssue): string {
  const { doc } = studio();
  const id = i.screenId || (s.screenIds.length === 1 ? s.screenIds[0] : "");
  return doc.nodes[id] ? id : "";
}

/** The issue's Fix button can be used: not already fixed or waiting, and Fix all hasn't taken over. */
export function canFixIssue(s: CritiqueSession, i: SessionIssue): boolean {
  if (s.fix && s.fix.status !== "error" && s.fix.status !== "undone") return false;
  const f = s.issueFixes[i.id];
  return (!f || f.status === "error") && !!issueScreen(s, i);
}

const patchIssueFix = (id: string, p: Partial<IssueFix> | null) => {
  const s = get();
  if (!s) return;
  const next = { ...s.issueFixes };
  const cur: IssueFix | undefined = next[id];
  if (p === null) delete next[id];
  else next[id] = { ...(cur ?? { status: "queued", started: Date.now(), tokens: 0, error: null, changes: [], rebuilt: false, pastLen: 0, sample: false }), ...p };
  patch({ issueFixes: next });
};

/**
 * Fix one issue on its own: its screen is revised for just that finding and rebuilt in place,
 * as its own undo step. Fixes asked for while one runs wait their turn, so each starts from the
 * screen as the previous one left it.
 */
export function fixIssue(id: string) {
  const s = get();
  const issue = s?.issues.find((i) => i.id === id);
  if (!s || !issue || !canFixIssue(s, issue)) return;
  patchIssueFix(id, { status: "queued", started: Date.now(), tokens: 0, error: null });
  void runNextIssueFix();
}

async function runNextIssueFix() {
  const s = get();
  if (!s || Object.values(s.issueFixes).some((f) => f.status === "running")) return;
  const next = Object.entries(s.issueFixes)
    .filter(([, f]) => f.status === "queued")
    .sort((a, b) => a[1].started - b[1].started)[0];
  const issue = next && s.issues.find((i) => i.id === next[0]);
  if (!issue) return;
  const screenId = issueScreen(s, issue);
  if (!screenId) {
    patchIssueFix(issue.id, { status: "error", error: "Its screen is no longer on the canvas." });
    return void runNextIssueFix();
  }
  fixAbort = new AbortController();
  const mine = fixAbort;
  patchIssueFix(issue.id, { status: "running", started: Date.now(), tokens: 0 });
  const held = reserve("Fixing", [], [screenId], CRITIQUE_OWNER);
  try {
    const ai = (await aiStatus()).ai;
    const rev = await reviseScreen(screenId, ai, [findingOf(issue)], [], mine.signal, (tokens) => {
      if (get()?.startedAt === s.startedAt) patchIssueFix(issue.id, { tokens });
    });
    if (get()?.startedAt !== s.startedAt) return; // closed or replaced meanwhile
    if (!studio().doc.nodes[screenId]) throw new Error("The screen was deleted while it was being fixed.");
    await applyRevisions([rev], (id) => studio().doc.nodes[id]?.name ?? s.names[id]);
    patchIssueFix(issue.id, { status: "done", changes: (rev.result.changes ?? []).map((c) => c.summary), rebuilt: !rev.spec, pastLen: studio().past.length, sample: rev.sample });
  } catch (e) {
    if (get()?.startedAt !== s.startedAt) return;
    // Stopped: back to the Fix button.
    if ((e as Error).name === "AbortError") patchIssueFix(issue.id, null);
    else patchIssueFix(issue.id, { status: "error", error: e instanceof AIError ? e.message : String(e) });
  } finally {
    release(held);
  }
  void runNextIssueFix();
}

/** Revert one issue's fix (only while it is still the latest undo step). */
export function undoIssueFix(id: string) {
  const f = get()?.issueFixes[id];
  if (f?.status !== "done" || studio().past.length !== f.pastLen) return;
  studio().undo();
  patchIssueFix(id, null);
}

/** Critique the fixed screens again (a new session, with everything the Knowledge hub knows). */
export function critiqueAgain() {
  const s = get();
  if (s) startCritique(s.screenIds, { origin: s.origin, after: s.startedAt });
}

/** Stop the critique turn or fix in flight; single-issue fixes still waiting are dropped. */
export function stop() {
  abort?.abort();
  fixAbort?.abort();
  const s = get();
  if (s && issueFixBusy(s)) patch({ issueFixes: Object.fromEntries(Object.entries(s.issueFixes).filter(([, f]) => f.status !== "queued")) });
}

export function closeCritique() {
  abort?.abort();
  fixAbort?.abort();
  studio().setHover(null);
  useCritique.setState({ session: null });
}

export function setMinimised(minimised: boolean) {
  patch({ minimised });
}

/** Un-minimise the card and bring its screens into view. */
export function showCard() {
  const s = get();
  if (!s) return;
  patch({ minimised: false });
  getController()?.zoomToFit(s.screenIds.filter((id) => studio().doc.nodes[id]));
}

export function resetKnowledge() {
  studio().mutate((d) => {
    delete d.brief;
  }, { history: false });
}
