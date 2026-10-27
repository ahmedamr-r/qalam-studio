import { callAI, type AIEvent } from "@/ai/client";
import { BUCKET_MAX, CHANGE_KINDS, MAX_BUCKETS, type FollowupResult, type PlanPayloadT, type PlanQuestion, type PlanResult, type PlanRoundsT, type PlanStandard, type StandardChange } from "@/ai/plan";
import type { ResearchInfo } from "@/ai/research-shared";
import { MAX_SCREENS } from "@/ai/screen-count";
import { PLATFORMS, PLATFORM_IDS, isPlatform, type Platform } from "@/design-system/platform";
import { OTHER, REVIEW, initialFlow, resolvedAnswers, type Answer, type FlowState, type Question } from "./questionFlow";
import type { ChatTurn } from "./chatTypes";
import { FREEFORM_ID } from "@/design-system/freeform";

/**
 * Plan first (Generate): Qalam AI looks up the market standard for the screen, reads the brief
 * against it and says what it understood, then asks the designer questions in buckets. After each
 * bucket it reads the answers, revises the plan and asks another bucket only while answers would
 * still change the design (at most MAX_BUCKETS). Meanwhile it looks up open-source libraries for
 * parts the catalog can't express. Generate runs once Qalam AI is ready (or the designer skips),
 * with the agreed plan. The state lives on the chat turn, so it survives a reload; the pure parts are tested.
 */

export interface PlanLibraries {
  status: "searching" | "done" | "error";
  /** The latest lookup, while searching. */
  activity?: string;
  research?: ResearchInfo;
  error?: string;
}

/** One bucket of questions: what Qalam AI asked, the designer's answers, and what it made of them. */
export interface PlanBucket {
  questions: PlanQuestion[];
  form: FlowState;
  /** Qalam AI's reading of the answers, once it has read them. */
  analysis?: string;
}

export interface PlanState {
  /** analyzing: a bucket was answered and Qalam AI is reading it (or will, on Try again). */
  phase: "planning" | "asking" | "analyzing" | "ready" | "skipped" | "failed";
  /** The plan, revised after each bucket. Its questions are the first bucket's. */
  result?: PlanResult;
  /** The market-standard lookup the plan was built on. */
  market?: ResearchInfo;
  /** Every bucket so far; the last one is the one being asked (or just answered). */
  buckets?: PlanBucket[];
  /** Plans made before buckets: the one bucket's answers. */
  form?: FlowState;
  libraries?: PlanLibraries;
  /** The designer picked the platform in the composer: the plan keeps it and doesn't ask. */
  platformFixed?: boolean;
  model?: string;
  error?: string;
}

export const PLATFORM_Q = "platform";

const PLATFORM_HINT: Record<Platform, string> = {
  mobile: "390 × 844 phone screen",
  web: "1440-wide website or simple web app page",
  dashboard: "1440-wide admin or analytics tool with side navigation",
  app: "1440 × 900 tool people edit in: panels, a stage, a timeline",
};

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");
const list = (v: unknown, n: number, len = 200) => (Array.isArray(v) ? v.map((x) => clip(x, len)).filter(Boolean).slice(0, n) : []);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);

const CHANGE = new Set<string>(CHANGE_KINDS);
const HERE = /\s*\(this screen\)\s*/i;

/** The designer's changes to the standard, checked: a known kind, both halves written. */
function sanitizeChanges(raw: unknown): StandardChange[] {
  return (Array.isArray(raw) ? raw : [])
    .map((c: Record<string, unknown>) => ({ kind: c?.kind, asked: clip(c?.asked, 300), applied: clip(c?.applied, 300) }))
    .filter((c): c is StandardChange => CHANGE.has(c.kind as string) && !!c.asked && !!c.applied)
    .slice(0, 6);
}

/**
 * A bucket of the model's questions, checked: unique, safe ids; 2–4 options, or none for an open
 * question; recommendations that point at an option; at most BUCKET_MAX.
 */
export function sanitizeQuestions(raw: unknown): PlanQuestion[] {
  const ids = new Set<string>([PLATFORM_Q, REVIEW]);
  return (Array.isArray(raw) ? raw : [])
    .map((q: Record<string, unknown>, i: number) => {
      const seen = new Set<string>();
      const options = (Array.isArray(q?.options) ? q.options : [])
        .map((o: Record<string, unknown>, k: number) => {
          let value = slug(clip(o?.value, 40)) || `option-${k + 1}`;
          while (seen.has(value)) value = `${value}-${k + 1}`;
          seen.add(value);
          return { value, raw: clip(o?.value, 40), label: clip(o?.label, 60), description: clip(o?.description, 160) };
        })
        .filter((o: { label: string }) => o.label)
        .slice(0, 4);
      let id = slug(clip(q?.id, 40)) || `question-${i + 1}`;
      while (ids.has(id)) id = `${id}-${i + 1}`;
      ids.add(id);
      // Recommendations may name an option by its original value or by its label.
      const rec = list(q?.recommended, 4, 60)
        .map((v) => options.find((o: { raw: string; value: string; label: string }) => o.raw === v || o.value === slug(v) || o.label === v)?.value)
        .filter((v): v is string => !!v);
      return {
        id,
        title: clip(q?.title, 90),
        why: clip(q?.why, 160),
        multi: !!q?.multi && options.length > 0,
        options: options.map(({ value, label, description }: { value: string; label: string; description: string }) => ({ value, label, description })),
        recommended: rec,
        allowOther: !!q?.allowOther,
      };
    })
    // A single option is no choice; no options at all is an open question.
    .filter((q) => q.title && q.options.length !== 1)
    .slice(0, BUCKET_MAX);
}

/** The model's market standard, checked: this screen's step in the flow, changes of a known kind. */
export function sanitizeStandard(raw: unknown): PlanStandard | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Record<string, unknown>;
  const steps = list(s.flow, 7, 120);
  // A step may be marked in its name instead of by index.
  const marked = steps.findIndex((x) => HERE.test(x));
  const flow = steps.map((x) => x.replace(HERE, " ").trim()).filter(Boolean);
  const here = typeof s.here === "number" && Number.isInteger(s.here) && s.here >= 0 && s.here < flow.length ? s.here : marked;
  const changes = sanitizeChanges(s.changes);
  const standard = {
    domain: clip(s.domain, 200),
    leaders: list(s.leaders, 5, 80),
    patterns: list(s.patterns, 3, 300),
    architecture: list(s.architecture, 8),
    primaryAction: clip(s.primaryAction, 120),
    flow,
    here: flow.length === steps.length ? here : -1,
    changes,
  };
  return standard.domain || standard.architecture.length ? standard : undefined;
}

/** The model's plan, checked: known platform, a first bucket of usable questions, at most 3 gaps. */
export function sanitizePlan(raw: unknown, fallback: Platform): PlanResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const questions = sanitizeQuestions(r.questions);
  const gaps = (Array.isArray(r.gaps) ? r.gaps : [])
    .map((g: Record<string, unknown>) => ({ need: clip(g?.need, 160), closest: clip(g?.closest, 160), search: clip(g?.search, 160) }))
    .filter((g) => g.need && g.search)
    .slice(0, 3);
  return {
    understanding: clip(r.understanding, 600),
    product: clip(r.product, 120),
    standard: sanitizeStandard(r.standard),
    platform: isPlatform(r.platform) ? r.platform : fallback,
    platformWhy: clip(r.platformWhy, 200),
    layout: clip(r.layout, 1200),
    mustHave: list(r.mustHave, 8),
    interactions: list(r.interactions, 4),
    avoid: list(r.avoid, 6, 300),
    variants: list(r.variants, MAX_SCREENS, 300),
    gaps,
    questions,
  };
}

/** One of Qalam AI's questions as the questionnaire asks it. An open question can be skipped. */
export function toQuestion(q: PlanQuestion): Question {
  if (!q.options.length)
    return { id: q.id, kind: "text", title: q.title, why: q.why || undefined, source: "ai", optional: true, placeholder: "Answer in your own words, or skip", maxLength: 600 };
  if (q.multi)
    return {
      id: q.id,
      kind: "multi",
      title: q.title,
      why: q.why || undefined,
      source: "ai",
      min: 1,
      groups: [{ id: "picks", label: "Pick any", options: q.options, ...(q.allowOther ? { custom: { placeholder: "Add your own" } } : {}) }],
      default: { values: q.recommended.length ? q.recommended : [q.options[0].value], custom: [] },
    };
  return {
    id: q.id,
    kind: "single",
    title: q.title,
    why: q.why || undefined,
    source: "ai",
    options: q.options,
    recommended: q.recommended[0] ?? q.options[0].value,
    ...(q.allowOther ? { other: { label: "Something else…", placeholder: "Describe what you want" } } : {}),
  };
}

/** The first bucket for the designer: the plan's questions, then where the screens will run (unless they already chose). */
export function planQuestions(plan: PlanResult, platformFixed: boolean): Question[] {
  const qs = plan.questions.map(toQuestion);
  if (!platformFixed)
    qs.push({
      id: PLATFORM_Q,
      kind: "single",
      title: "Where will it run?",
      why: plan.platformWhy || undefined,
      source: "studio",
      recommended: plan.platform,
      options: PLATFORM_IDS.map((p) => ({ value: p, label: PLATFORMS[p].label, description: PLATFORM_HINT[p] })),
    });
  return qs;
}

/** The platform the designer settled on: their answer, else the plan's pick. */
export function planPlatform(state: PlanState, fallback: Platform): Platform {
  if (!state.result) return fallback;
  if (state.platformFixed) return fallback;
  const a = bucketsOf(state)[0]?.form.answers[PLATFORM_Q];
  return a?.kind === "single" && isPlatform(a.value) ? a.value : state.result.platform;
}

// ---------------------------------------------------------------------------
// Buckets

/** Every bucket so far (a plan made before buckets has one: its questions and form). */
export function bucketsOf(state: PlanState): PlanBucket[] {
  if (state.buckets) return state.buckets;
  const r = state.result;
  return r ? [{ questions: r.questions, form: state.form ?? initialFlow(planQuestions(r, !!state.platformFixed)) }] : [];
}

/** A bucket's questions as the questionnaire asks them; the first one also asks where the screens run. */
export function bucketQuestions(state: PlanState, i: number): Question[] {
  const b = bucketsOf(state)[i];
  if (!b) return [];
  return i === 0 && state.result ? planQuestions({ ...state.result, questions: b.questions }, !!state.platformFixed) : b.questions.map(toQuestion);
}

/** The first bucket, ready to ask. */
export function firstBucket(result: PlanResult, platformFixed: boolean): PlanBucket[] {
  return [{ questions: result.questions, form: initialFlow(planQuestions(result, platformFixed)) }];
}

/**
 * The designer is done with the current bucket: answered it (Qalam AI reads the answers next) or
 * left the rest to Qalam AI's picks (Generate runs).
 */
export function closeBucket(state: PlanState, form: FlowState, phase: "analyzing" | "skipped"): PlanState {
  const buckets = bucketsOf(state);
  if (!buckets.length) return { ...state, phase, form };
  const last = buckets.length - 1;
  return { ...state, phase, form: undefined, error: undefined, buckets: buckets.map((b, i) => (i === last ? { ...b, form } : b)) };
}

/** Change the last bucket's answers: back to its review, its old reading dropped. */
export function reopenBucket(state: PlanState): PlanState {
  const buckets = bucketsOf(state);
  if (!buckets.length) return state;
  const last = buckets.length - 1;
  return {
    ...state,
    phase: "asking",
    form: undefined,
    buckets: buckets.map((b, i) => (i === last ? { ...b, analysis: undefined, form: { ...b.form, current: REVIEW, editing: false, submitted: false } } : b)),
  };
}

/** The follow-up step's answer, checked. Lists it left empty keep what the plan had. */
export function sanitizeFollowup(raw: unknown): FollowupResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const questions = sanitizeQuestions(r.questions);
  return {
    analysis: clip(r.analysis, 1200),
    understanding: clip(r.understanding, 600),
    layout: clip(r.layout, 1200),
    mustHave: list(r.mustHave, 8),
    interactions: list(r.interactions, 4),
    avoid: list(r.avoid, 6, 300),
    variants: list(r.variants, MAX_SCREENS, 300),
    changes: sanitizeChanges(r.changes),
    // Ready means no more questions; questions without a bucket to put them in mean ready too.
    ready: r.ready === true || !questions.length,
    questions,
  };
}

/**
 * What Qalam AI made of the last bucket: the reading kept with it, the plan revised, and either the
 * next bucket to ask or, when it's ready (or the last bucket was asked), on to Generate.
 */
export function applyFollowup(state: PlanState, f: FollowupResult): PlanState {
  const buckets = bucketsOf(state);
  const more = !f.ready && f.questions.length > 0 && buckets.length < MAX_BUCKETS;
  const read = buckets.map((b, i) => (i === buckets.length - 1 ? { ...b, analysis: f.analysis || undefined } : b));
  const r = state.result;
  const result = r && {
    ...r,
    understanding: f.understanding || r.understanding,
    layout: f.layout || r.layout,
    mustHave: f.mustHave.length ? f.mustHave : r.mustHave,
    interactions: f.interactions.length ? f.interactions : r.interactions,
    avoid: f.avoid.length ? f.avoid : r.avoid,
    variants: f.variants.length ? f.variants : r.variants,
    standard: r.standard && f.changes.length ? { ...r.standard, changes: f.changes } : r.standard,
  };
  return {
    ...state,
    result,
    form: undefined,
    error: undefined,
    phase: more ? "asking" : "ready",
    buckets: more ? [...read, { questions: f.questions, form: initialFlow(f.questions.map(toQuestion)) }] : read,
  };
}

/** Each bucket's questions with the answers in words (where it runs left out). */
function bucketAnswers(state: PlanState, i: number): { question: string; answer: string }[] {
  const qs = bucketQuestions(state, i).filter((q) => q.id !== PLATFORM_Q);
  const answers = resolvedAnswers(qs, bucketsOf(state)[i]?.form.answers ?? {});
  return qs.map((q) => ({ question: q.title, answer: answerText(q, answers[q.id]).slice(0, 600) }));
}

/** The buckets answered so far, for the follow-up step. */
export function planRounds(state: PlanState): PlanRoundsT {
  return bucketsOf(state).map((b, i) => ({ answers: bucketAnswers(state, i), ...(b.analysis ? { analysis: b.analysis.slice(0, 1500) } : {}) }));
}

/** An answer in words the model can use: labels with their descriptions, and anything typed. */
export function answerText(q: Question, a: Answer): string {
  if (a.kind === "skipped") return "No preference";
  if (a.kind === "single" && q.kind === "single") {
    if (a.value === OTHER) return a.other?.trim() || "No preference";
    const o = q.options.find((x) => x.value === a.value);
    return o ? (o.description ? `${o.label} (${o.description})` : o.label) : "No preference";
  }
  if (a.kind === "multi" && q.kind === "multi") {
    const picked = q.groups.flatMap((g) => g.options.filter((o) => a.values.includes(o.value)).map((o) => o.label));
    return [...picked, ...a.custom].join("; ") || "None";
  }
  if (a.kind === "text") return a.text.trim() || "No preference";
  return "No preference";
}

/** The agreed plan, for Generate (and for later turns' context). */
/** The design system a plan request names, or that there is none (Generate picks the look). */
const systemFields = (t: ChatTurn) => (t.request.system?.id === FREEFORM_ID ? { freeform: true } : { systemName: t.request.system?.name });

export function planPayload(state: PlanState): PlanPayloadT | undefined {
  const plan = state.result;
  if (!plan) return undefined;
  return {
    product: plan.product,
    understanding: plan.understanding,
    standard: plan.standard ? { ...plan.standard, research: state.market?.notes.slice(0, 6000) || undefined } : undefined,
    layout: plan.layout,
    mustHave: plan.mustHave,
    ...(plan.interactions?.length ? { interactions: plan.interactions } : {}),
    avoid: plan.avoid,
    variants: plan.variants,
    answers: bucketsOf(state).flatMap((_, i) => bucketAnswers(state, i)),
    libraries: state.libraries?.research?.notes || undefined,
  };
}

// ---------------------------------------------------------------------------
// Running it

export interface PlanDeps {
  patch: (p: Partial<ChatTurn> | ((cur: ChatTurn) => Partial<ChatTurn>)) => void;
  current: () => ChatTurn | null;
  context: string;
  onEvent: (e: AIEvent) => void;
}

/** Library searches in flight, per turn (they run while the designer answers). */
const searches = new Map<string, Promise<void>>();

function patchPlan(deps: PlanDeps, fn: (cur: PlanState) => PlanState) {
  deps.patch((cur) => (cur.plan ? { plan: fn(cur.plan) } : {}));
}

function searchLibraries(t: ChatTurn, plan: PlanResult, deps: PlanDeps): Promise<void> {
  const running = searches.get(t.id);
  if (running) return running;
  const setLibs = (libraries: PlanLibraries) => patchPlan(deps, (cur) => ({ ...cur, libraries }));
  setLibs({ status: "searching", activity: "Looking up libraries for what the catalog can't draw" });
  const run = (async () => {
    try {
      const { data } = await callAI<ResearchInfo>(
        "/api/plan",
        { stage: "libraries", product: plan.product, gaps: plan.gaps, connectors: t.request.connectors },
        undefined,
        undefined,
        (e) => e.type === "activity" && setLibs({ status: "searching", activity: e.label }),
      );
      setLibs(data.notes ? { status: "done", research: data } : { status: "error", research: data, error: data.error || "No libraries turned up." });
    } catch (e) {
      setLibs({ status: "error", error: e instanceof Error ? e.message : String(e) });
    } finally {
      searches.delete(t.id);
    }
  })();
  searches.set(t.id, run);
  return run;
}

/** Wait for the library search (restarting one a reload cut off), unless the turn is stopped. */
async function librariesSettled(t: ChatTurn, deps: PlanDeps, signal: AbortSignal) {
  const plan = t.plan?.result;
  if (!plan?.gaps.length || t.plan?.libraries?.status !== "searching") return;
  deps.patch({ activity: "Finishing the library search" });
  const done = searches.get(t.id) ?? searchLibraries(t, plan, deps);
  await Promise.race([
    done,
    new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true })),
  ]);
}

/**
 * Qalam AI reads the bucket just answered: it revises the plan, then asks the next bucket (false:
 * wait for the designer) or is ready (true: generate). A failure keeps the answers, so Try again
 * reads them again.
 */
async function readAnswers(t: ChatTurn, state: PlanState, progress: (tokens: number) => void, signal: AbortSignal, deps: PlanDeps): Promise<boolean> {
  const buckets = bucketsOf(state);
  const plan = planPayload(state);
  // Nothing of Qalam AI's was asked (only where it runs): nothing to read.
  if (!plan || !buckets.at(-1)?.questions.length) {
    patchPlan(deps, (cur) => ({ ...cur, phase: "ready" }));
    await librariesSettled(deps.current() ?? t, deps, signal);
    return true;
  }
  deps.patch({ activity: "Reading your answers" });
  const { data } = await callAI<FollowupResult>(
    "/api/plan",
    {
      stage: "followup",
      prompt: t.request.text,
      lang: t.request.lang ?? "en",
      platform: t.request.platform ?? "mobile",
      ...systemFields(t),
      context: deps.context || undefined,
      // The rounds carry the answers; the research notes already went into the standard.
      plan: { ...plan, answers: [], libraries: undefined, standard: plan.standard && { ...plan.standard, research: undefined } },
      rounds: planRounds(state),
      last: buckets.length >= MAX_BUCKETS,
    },
    progress,
    signal,
  );
  const followup = sanitizeFollowup(data);
  patchPlan(deps, (cur) => applyFollowup(cur, followup));
  deps.patch({ activity: undefined });
  if (deps.current()?.plan?.phase === "asking") return false;
  await librariesSettled(deps.current() ?? t, deps, signal);
  return true;
}

/**
 * The planning step of a Generate turn. Returns true when the plan is agreed (Qalam AI is ready
 * or the designer skipped) and generation can go on; false when it has just asked the designer a
 * bucket and waits for their answers.
 */
export async function planFirst(t: ChatTurn, progress: (tokens: number) => void, signal: AbortSignal, deps: PlanDeps): Promise<boolean> {
  const state = t.plan;
  if (state?.phase === "ready" || state?.phase === "skipped") {
    await librariesSettled(t, deps, signal);
    return true;
  }
  if (state?.phase === "asking") return false;
  if (state?.phase === "analyzing") return readAnswers(t, state, progress, signal, deps);
  const fixed = !!state?.platformFixed;
  const platform = t.request.platform ?? "mobile";
  patchPlan(deps, (cur) => ({ ...cur, phase: "planning", error: undefined, market: undefined }));
  deps.patch({ activity: "Reading your brief" });
  // The market-standard lookup runs first: each search as it happens, then what it found.
  const onEvent = (e: AIEvent) => {
    if (e.type === "activity") return deps.patch({ activity: e.label });
    patchPlan(deps, (cur) => ({ ...cur, market: e.research }));
    deps.patch({ activity: e.research.notes ? "Planning from the market standard" : "Planning the screen" });
  };
  try {
    const { data, model } = await callAI<PlanResult>(
      "/api/plan",
      {
        stage: "plan",
        prompt: t.request.text,
        lang: t.request.lang ?? "en",
        platform: fixed ? platform : "auto",
        ...systemFields(t),
        context: deps.context || undefined,
        connectors: t.request.connectors,
      },
      progress,
      signal,
      onEvent,
    );
    const result = sanitizePlan(data, platform);
    if (fixed) result.platform = platform;
    patchPlan(deps, (cur) => ({ ...cur, phase: "asking", result, buckets: firstBucket(result, fixed), form: undefined, model, libraries: undefined }));
    deps.patch({ activity: undefined });
    if (result.gaps.length) void searchLibraries(deps.current() ?? t, result, deps);
    return false;
  } catch (e) {
    if ((e as Error).name !== "AbortError") patchPlan(deps, (cur) => ({ ...cur, phase: "failed", error: e instanceof Error ? e.message : String(e) }));
    throw e;
  }
}
