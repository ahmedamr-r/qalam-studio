import { studio } from "@/doc/store";
import { cutCrops } from "./crops";
import { getAssetBlob, isAsset, putAsset, sourceBlob } from "@/doc/assets";
import { makeImage } from "@/doc/factory";
import { insertNodes } from "@/doc/ops";
import { worldBounds } from "@/doc/geometry";
import { callAI, aiStatus, AIError } from "@/ai/client";
import type { ElementBox, FoundationsResult, GuideResult, RebuildResult, ScanResult } from "@/ai/ds-schemas";
import { systemPayload } from "@/ai/ds-payload";
import { SAMPLE_DS_SCAN } from "@/ai/fixtures-ds-scan";
import { prepareImage, MAX_IMAGE_SIDE, type PreparedImage } from "@/design-system/extract";
import { captureScale, type Capture } from "@/design-system/pixels";
import { designSystemFromExtraction, docsFromGuide, foundationsText } from "@/design-system/fromExtraction";
import { MAX_EXTRACT_IMAGES, sameName, trimFoundations, trimGuide, wantsGuide, type ExtractOptions } from "@/design-system/extract-options";
import { recipeGroupsFor } from "@/design-system/recipes";
import { sanitizeScan } from "@/design-system/scan";
import { useSystems, type DesignSystem } from "@/design-system/registry";
import { insertScreens, nextSlot } from "@/design-system/place";
import { ensureFonts } from "@/engine/fonts";
import type { ScreenSpec } from "@/design-system/builders";
import { REVIEW, initialFlow, type FlowState } from "./questionFlow";
import { DEFAULT_ADVANCED, extractQuestions, type ExtractAdvanced } from "./extractQuestions";
import { pinPreview, unpinPreview } from "./extractPreview";
import type { ChatRequest, ChatTurn } from "./chatTypes";
import { compareAndCorrect, type ReconcileState } from "./reconcile";
import { applyChanges } from "@/design-system/tune";
import type { Tried } from "@/design-system/reconcile";

/**
 * Extracting a design system, as a chat turn. Qalam AI first looks at the screenshots (what's
 * there, what to ask), the designer answers in the chat, then pass 1 (foundations) produces a
 * draft the Tokens panel can preview, and pass 2 writes the docs while the first screenshot is
 * rebuilt with the draft as a fidelity check. Everything lives in the turn's outcome, so it
 * survives a reload; the draft joins the registry only when the designer saves it.
 */

export const SAMPLE_DS_IMAGE = "/samples/lumen-wallet.png";
/** Recorded outputs are ~100KB, so they're only loaded when used. */
const samples = () => import("@/ai/fixtures-ds");

/** Base64 budget per image: enough to keep most full-size screenshots lossless. */
const IMAGE_BUDGET = 1_130_000;
/** Base64 budget for all images of one request when hosted (Vercel caps request bodies at ~4.5 MB). */
const HOSTED_REQUEST_BUDGET = 3_400_000;
/** The first look only names things: small, lossy images keep it quick. */
const SCAN_SIDE = 1280;
const SCAN_BUDGET = 1_600_000;

export type ExtractPhase = "scanning" | "asking" | "running" | "draft" | "saved" | "discarded";
export type ExtractStage = "prepare" | "foundations" | "guide";

/** The rebuild of the first screenshot with the draft system (the fidelity check). */
export interface FidelityRebuild {
  status: "running" | "done" | "error";
  spec?: ScreenSpec;
  gaps?: RebuildResult["gaps"];
  error?: string;
}

export interface ExtractOutcome {
  kind: "extract";
  phase: ExtractPhase;
  /** The first look (null if it failed: the questions fall back to the whole catalog). */
  scan: ScanResult | null;
  scanError?: string;
  /** The questionnaire. */
  form: FlowState;
  advanced: ExtractAdvanced;
  /** What the answers asked for (set when the designer starts the extraction). */
  options?: ExtractOptions;
  stage?: ExtractStage | null;
  /** Pixel size of the first screenshot, to place it on the canvas on save. */
  source?: { width: number; height: number };
  draft?: DesignSystem;
  /** The docs pass finished. */
  guideDone?: boolean;
  /** The docs pass failed or was stopped; the tokens stand. */
  guideError?: string;
  /** The docs pass is running again on its own. */
  retrying?: { started: number; tokens: number } | null;
  rebuild?: FidelityRebuild | null;
  /** Comparing the rebuild with the screenshot and correcting the draft (after the rebuild). */
  reconcile?: ReconcileState | null;
  /** What the first pass pointed at in the screenshots, for the comparison to measure again. */
  elements?: ElementBox[];
  saved?: { systemId: string; name: string; rebuiltId: string | null };
}

/** A screenshot to extract from: a canvas image or source, or a file. */
export interface ShotInput {
  src?: string;
  blob?: Blob;
  name: string;
  nodeId?: string;
}
export type ShotRef = NonNullable<NonNullable<ChatRequest["source"]>["images"]>[number];

export interface ExtractDeps {
  patch: (p: Partial<ChatTurn> | ((t: ChatTurn) => Partial<ChatTurn>)) => void;
  current: () => ChatTurn | null;
  ids: { chatId: string; turnId: string };
}

const message = (e: unknown) => (e instanceof AIError ? e.message : e instanceof Error ? e.message : String(e));
const aborted = (e: unknown) => (e as Error)?.name === "AbortError";

/** The request's source: every screenshot stored once as an "asset:" reference. */
export async function extractSource(images: ShotInput[], sample: boolean): Promise<NonNullable<ChatRequest["source"]>> {
  const refs: ShotRef[] = [];
  for (const im of images.slice(0, MAX_EXTRACT_IMAGES)) {
    let ref = im.src && isAsset(im.src) ? im.src : null;
    if (!ref) {
      const blob = im.blob ?? (im.src ? await sourceBlob(im.src) : null);
      if (!blob) continue;
      ref = await putAsset(blob);
    }
    if (refs.some((r) => r.ref === ref)) continue;
    refs.push({ ref, name: im.name.slice(0, 80) || "Screenshot", ...(im.nodeId ? { nodeId: im.nodeId } : {}) });
  }
  if (!refs.length) throw new Error("Couldn't read the screenshots.");
  return { mode: "image", count: refs.length, image: refs[0].ref, images: refs, ...(sample ? { sample: true } : {}) };
}

export const shotsOf = (t: ChatTurn): ShotRef[] => t.request.source?.images ?? (t.request.source?.image ? [{ ref: t.request.source.image, name: "Screenshot" }] : []);

export function extractOutcomeOf(t: ChatTurn | null | undefined): ExtractOutcome | null {
  return t?.outcome?.kind === "extract" ? t.outcome : null;
}

function patchOutcome(deps: Pick<ExtractDeps, "patch">, fn: Partial<ExtractOutcome> | ((o: ExtractOutcome) => Partial<ExtractOutcome>)) {
  deps.patch((t) => {
    const o = extractOutcomeOf(t);
    return o ? { outcome: { ...o, ...(typeof fn === "function" ? fn(o) : fn) } } : {};
  });
}

function blank(scan: ScanResult | null): ExtractOutcome {
  return { kind: "extract", phase: "scanning", scan, form: initialFlow(extractQuestions(scan, {})), advanced: DEFAULT_ADVANCED };
}

/** Recorded runs replay when AI is off, or for the bundled sample screenshot. */
const isSample = (t: ChatTurn, ai: boolean) => !ai || !!t.request.source?.sample;

async function blobsOf(t: ChatTurn): Promise<Blob[]> {
  const shots = shotsOf(t);
  if (!shots.length) throw new Error("Attach a screenshot first.");
  const blobs = await Promise.all(shots.map((s) => getAssetBlob(s.ref)));
  if (blobs.some((b) => !b)) throw new Error("A screenshot is no longer available. Attach it again.");
  return blobs as Blob[];
}

const captureOf = (im: PreparedImage): Capture => ({ ...captureScale(im.sourceWidth, im.sourceHeight), sentWidth: im.width, sentHeight: im.height });

/** Run the turn from where it stands: the first look, or the extraction the designer started. */
export async function runExtract(t: ChatTurn, ai: boolean, progress: (tokens: number) => void, signal: AbortSignal, deps: ExtractDeps): Promise<void> {
  const o = extractOutcomeOf(deps.current() ?? t);
  const phase = o?.phase ?? "scanning";
  if (phase === "scanning") return firstLook(deps.current() ?? t, ai, progress, signal, deps);
  if (phase === "running") return extract(deps.current() ?? t, ai, progress, signal, deps);
}

// ---------------------------------------------------------------------------
// The first look

async function firstLook(t: ChatTurn, ai: boolean, progress: (tokens: number) => void, signal: AbortSignal, deps: ExtractDeps) {
  const n = shotsOf(t).length;
  if (!extractOutcomeOf(t)) deps.patch({ outcome: blank(null) });
  deps.patch({ activity: `Looking at ${n > 1 ? `your ${n} screenshots` : "your screenshot"}…` });
  const blobs = await blobsOf(t);
  const bmp = await createImageBitmap(blobs[0]);
  const source = { width: bmp.width, height: bmp.height };
  bmp.close();

  let scan: ScanResult | null = null;
  let scanError: string | undefined;
  if (isSample(t, ai)) {
    scan = SAMPLE_DS_SCAN;
    deps.patch({ sample: true });
  } else {
    try {
      const budget = Math.min(400_000, Math.floor(SCAN_BUDGET / blobs.length));
      const imgs = await Promise.all(blobs.map((b) => prepareImage(b, SCAN_SIDE, { maxBytes: budget })));
      const captures = imgs.map(captureOf);
      const note = t.request.text.trim();
      const r = await callAI<unknown>(
        "/api/extract-ds",
        { stage: "scan", images: imgs.map((im) => ({ mediaType: im.mediaType, data: im.data })), captures, options: note ? { notes: [{ question: "Designer's note", answer: note.slice(0, 300) }] } : undefined },
        progress,
        signal,
      );
      scan = sanitizeScan(r.data, { images: imgs.length, kinds: captures.map((c) => c.kind) });
      deps.patch({ model: r.model });
    } catch (e) {
      if (aborted(e)) throw e;
      // Don't dead-end: the designer can still pick what to extract from the whole catalog.
      scanError = message(e);
    }
  }
  patchOutcome(deps, { phase: "asking", scan, scanError, source, form: initialFlow(extractQuestions(scan, {})) });
  deps.patch({ activity: undefined });
}

// ---------------------------------------------------------------------------
// The extraction

/** What a run sends, kept so the docs or the rebuild can be retried without preparing again. */
interface RunInput {
  images: { mediaType: string; data: string }[];
  captures: Capture[];
  options: ExtractOptions;
  sample: boolean;
}
/** Per turn; pixels aren't kept (8 full-size screenshots would pin ~100 MB). */
const runs = new Map<string, RunInput>();
const retries = new Map<string, AbortController>();

async function prepareRun(t: ChatTurn, options: ExtractOptions, sample: boolean): Promise<{ run: RunInput; imgs: PreparedImage[]; thumbnail: string }> {
  const blobs = await blobsOf(t);
  const live = await aiStatus();
  // Locally each image keeps its own budget; hosted, they share one that fits the request cap.
  const budget = live.hosted ? Math.min(IMAGE_BUDGET, Math.floor(HOSTED_REQUEST_BUDGET / blobs.length)) : IMAGE_BUDGET;
  const [imgs, thumb] = await Promise.all([Promise.all(blobs.map((b) => prepareImage(b, MAX_IMAGE_SIDE, { lossless: true, maxBytes: budget }))), prepareImage(blobs[0], 240)]);
  const run: RunInput = { images: imgs.map((im) => ({ mediaType: im.mediaType, data: im.data })), captures: imgs.map(captureOf), options, sample };
  runs.set(t.id, run);
  return { run, imgs, thumbnail: thumb.dataUrl };
}

async function ensureRun(t: ChatTurn, o: ExtractOutcome): Promise<RunInput> {
  const cached = runs.get(t.id);
  if (cached) return { ...cached, options: o.options ?? cached.options };
  return (await prepareRun(t, o.options!, !!t.sample)).run;
}

async function extract(t: ChatTurn, ai: boolean, progress: (tokens: number) => void, signal: AbortSignal, deps: ExtractDeps) {
  const o = extractOutcomeOf(t)!;
  const options = o.options;
  if (!options) throw new Error("Answer the questions first.");
  const sample = isSample(t, ai) || !!t.sample;
  const docs = wantsGuide(options);
  const rebuild = o.advanced.rebuild && !sample;
  const step = (activity: string) => deps.patch({ activity, started: Date.now(), tokens: 0 });

  patchOutcome(deps, { stage: "prepare", draft: undefined, guideDone: false, guideError: undefined, rebuild: null, reconcile: null, retrying: null });
  step(`Preparing ${shotsOf(t).length > 1 ? "the screenshots" : "the screenshot"}…`);
  const { run, imgs, thumbnail } = await prepareRun(t, options, sample);

  let foundations: FoundationsResult;
  let model: string | undefined;
  if (sample) {
    foundations = trimFoundations((await samples()).SAMPLE_DS_FOUNDATIONS as unknown as Record<string, unknown>, options.depth) as unknown as FoundationsResult;
    deps.patch({ sample: true });
  } else {
    patchOutcome(deps, { stage: "foundations" });
    step(`Measuring tokens (pass 1 of ${docs ? 2 : 1})…`);
    const r = await callAI<FoundationsResult>("/api/extract-ds", { stage: "foundations", images: run.images, captures: run.captures, palette: mergePalettes(imgs), options }, progress, signal);
    foundations = r.data;
    model = r.model;
  }
  // The recording's regions point into the sample screenshot: only measure pixels that match it.
  const pixels = !sample || t.request.source?.sample ? imgs.map((im) => im.pixels!) : undefined;
  const draft = designSystemFromExtraction({
    foundations,
    pixels,
    captures: pixels ? run.captures : [],
    thumbnail,
    sources: shotsOf(t).map((s) => s.ref),
    recipeGroups: options.recipes === "chosen" ? recipeGroupsFor(options.components) : undefined,
  });
  if (sample && !t.request.source?.sample) draft.notes = [...(draft.notes ?? []), "AI is off, so this is the recorded Lumen Wallet run, not your screenshots."];
  patchOutcome(deps, { draft, stage: docs ? "guide" : null, elements: Array.isArray(foundations.elements) ? foundations.elements.slice(0, 60) : undefined });
  if (model) deps.patch({ model });
  pinPreview(deps.ids);
  void ensureFonts(draft.fonts.map((f) => f.googleFont ?? f.family));

  if (docs || rebuild) step(docs && rebuild ? "Writing the docs and rebuilding screen 1 (pass 2 of 2)…" : docs ? "Writing the docs (pass 2 of 2)…" : "Rebuilding screen 1 with the draft…");
  try {
    // The comparison follows the rebuild while the docs are still being written.
    await Promise.all([docs ? runGuide(run, deps, progress, signal) : undefined, rebuild ? runRebuild(run, deps, signal).then((ok) => (ok ? runReconcile(run, imgs[0]?.pixels, deps, signal) : undefined)) : undefined]);
  } catch (e) {
    if (!aborted(e)) throw e;
    // Stopped after the tokens: keep the draft, say what's missing.
    patchOutcome(deps, (cur) => ({
      phase: "draft",
      stage: null,
      guideError: docs && !cur.guideDone ? "Stopped before the docs were written." : cur.guideError,
      rebuild: cur.rebuild?.status === "running" ? { status: "error", error: "Stopped." } : cur.rebuild,
      reconcile: cur.reconcile?.status === "running" ? { status: "error", error: "Stopped." } : cur.reconcile,
    }));
    deps.patch({ activity: undefined });
    return;
  }
  patchOutcome(deps, { phase: "draft", stage: null });
  deps.patch({ activity: undefined });
}

/** Dominant colours of every image, without near-duplicates. */
function mergePalettes(imgs: PreparedImage[]): string[] {
  const out: string[] = [];
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  for (const im of imgs)
    for (const h of im.palette) {
      const c = rgb(h);
      if (out.some((o) => rgb(o).reduce((s, v, i) => s + Math.abs(v - c[i]), 0) < 24)) continue;
      out.push(h);
    }
  return out.slice(0, 24);
}

/** Pass 2: the written system, merged into the current draft. Its own failure leaves the tokens. */
async function runGuide(run: RunInput, deps: ExtractDeps, progress: (t: number) => void, signal: AbortSignal) {
  const draft = extractOutcomeOf(deps.current())?.draft;
  if (!draft) return;
  try {
    const guide = run.sample
      ? trimGuide((await samples()).SAMPLE_DS_GUIDE, run.options)
      : (await callAI<GuideResult>("/api/extract-ds", { stage: "guide", images: run.images, captures: run.captures, foundations: foundationsText(draft.tree), name: draft.name, options: run.options }, progress, signal)).data;
    const missing = run.sample && run.options.patterns === "listed" ? run.options.patternNames.filter((n) => !(guide.patterns ?? []).some((p) => sameName(n, p.name))) : [];
    patchOutcome(deps, (o) => {
      const d = o.draft ?? draft;
      const notes = [...(d.notes ?? [])];
      if (missing.length) notes.push(`The recorded sample can't create components by name, so ${missing.join(", ")} ${missing.length > 1 ? "were" : "was"} left out.`);
      return { draft: { ...d, docs: docsFromGuide(guide, notes, d.docs), notes, updatedAt: Date.now() }, guideDone: true, guideError: undefined };
    });
  } catch (e) {
    if (aborted(e)) throw e;
    patchOutcome(deps, { guideError: message(e) });
  }
}

/** The fidelity check: the first screenshot rebuilt from catalog components with the draft. True when it's done. */
async function runRebuild(run: RunInput, deps: ExtractDeps, signal: AbortSignal): Promise<boolean> {
  const draft = extractOutcomeOf(deps.current())?.draft;
  if (!draft) return false;
  patchOutcome(deps, { rebuild: { status: "running" } });
  try {
    const { data } = await callAI<RebuildResult>(
      "/api/extract-ds",
      { stage: "rebuild", images: run.images.slice(0, 1), captures: run.captures.slice(0, 1), designSystem: systemPayload(draft), options: run.options },
      undefined,
      signal,
    );
    // The rebuild keeps the screenshot's pictures, cut from the image the model saw (its crop boxes are in its pixels).
    const shot = run.images[0];
    const screen = shot ? await cutCrops(data.screen, await (await fetch(`data:${shot.mediaType};base64,${shot.data}`)).blob()) : data.screen;
    patchOutcome(deps, { rebuild: { status: "done", spec: { ...screen, name: `${screen.name || "Screenshot"} (rebuilt)` }, gaps: data.gaps ?? [] } });
    return true;
  } catch (e) {
    if (aborted(e)) throw e;
    patchOutcome(deps, { rebuild: { status: "error", error: message(e) } });
    return false;
  }
}

/** How long the comparison may take before the draft is kept as measured. */
const RECONCILE_MS = 120_000;

/**
 * Compare and correct: the model compares the screenshot with its rebuild and proposes changes;
 * code keeps each only if the rebuild measurably gets closer (reconcile.ts). The corrected tree
 * replaces the draft's tokens (the docs pass may be updating its docs meanwhile).
 */
async function runReconcile(run: RunInput, pixels: ImageData | undefined, deps: ExtractDeps, signal: AbortSignal) {
  const o = extractOutcomeOf(deps.current());
  const draft = o?.draft;
  const spec = o?.rebuild?.status === "done" ? o.rebuild.spec : undefined;
  if (!draft || !spec || run.sample || !pixels || !run.images[0] || !run.captures[0]) return;
  patchOutcome(deps, { reconcile: { status: "running" } });
  const timeout = AbortSignal.timeout(RECONCILE_MS);
  try {
    const r = await compareAndCorrect({ draft, spec, gaps: o.rebuild?.gaps ?? [], image: run.images[0], capture: run.captures[0], pixels, elements: o.elements, signal: AbortSignal.any([signal, timeout]) });
    patchOutcome(deps, (cur) => ({
      reconcile: r.state,
      ...(cur.draft && (r.tree || r.note) ? { draft: { ...cur.draft, ...(r.tree ? { tree: r.tree } : {}), notes: [...(cur.draft.notes ?? []), ...(r.note ? [r.note] : [])], updatedAt: Date.now() } } : {}),
    }));
  } catch (e) {
    // Stopped by the designer: the run's own handler says so.
    if (aborted(e) && signal.aborted) throw e;
    patchOutcome(deps, { reconcile: { status: "error", error: timeout.aborted ? "The comparison took too long, so the draft stays as measured." : message(e) } });
  }
}

/** Apply a change the comparison couldn't verify, because the designer chose to. */
export function applySuggestion(deps: ExtractDeps, s: Tried): string | null {
  const o = extractOutcomeOf(deps.current());
  if (!o?.draft) return "The draft is gone.";
  const r = applyChanges(o.draft.tree, o.draft.docs, [{ kind: "token", path: s.path, value: s.to, reason: s.reason }]);
  if (r.problems[0]) return r.problems[0];
  patchOutcome(deps, (cur) => ({
    draft: cur.draft ? { ...cur.draft, tree: r.tree, updatedAt: Date.now() } : cur.draft,
    reconcile: cur.reconcile ? { ...cur.reconcile, suggestions: (cur.reconcile.suggestions ?? []).filter((x) => x.path !== s.path), applied: [...(cur.reconcile.applied ?? []), { ...s, why: "Applied by you." }] } : cur.reconcile,
  }));
  return null;
}

/** Write the docs again on their own (they failed or were stopped; the tokens stand). */
export async function retryDocs(t: ChatTurn, deps: ExtractDeps) {
  const o = extractOutcomeOf(t);
  if (!o?.draft || !o.options || retries.has(t.id)) return;
  const ctrl = new AbortController();
  retries.set(t.id, ctrl);
  patchOutcome(deps, { retrying: { started: Date.now(), tokens: 0 }, guideError: undefined });
  try {
    const run = await ensureRun(t, o);
    await runGuide(run, deps, (tokens) => patchOutcome(deps, (cur) => ({ retrying: { started: cur.retrying?.started ?? Date.now(), tokens } })), ctrl.signal);
  } catch (e) {
    patchOutcome(deps, { guideError: aborted(e) ? "Stopped before the docs were written." : message(e) });
  } finally {
    retries.delete(t.id);
    patchOutcome(deps, { retrying: null });
  }
}

/** Rebuild the first screenshot again with the current draft. */
export async function retryRebuild(t: ChatTurn, deps: ExtractDeps) {
  const o = extractOutcomeOf(t);
  if (!o?.draft || !o.options || t.sample) return;
  try {
    const run = await ensureRun(t, o);
    const signal = new AbortController().signal;
    patchOutcome(deps, { reconcile: null });
    if (!(await runRebuild(run, deps, signal))) return;
    // The comparison measures the screenshot again (pixels aren't kept between runs).
    const blob = (await blobsOf(t))[0];
    const img = blob ? await prepareImage(blob, MAX_IMAGE_SIDE, { lossless: true, maxBytes: IMAGE_BUDGET }).catch(() => null) : null;
    await runReconcile(run, img?.pixels, deps, signal);
  } catch (e) {
    patchOutcome(deps, { rebuild: { status: "error", error: message(e) } });
  }
}

export const stopRetry = (turnId: string) => retries.get(turnId)?.abort();
export const isRetrying = (turnId: string) => retries.has(turnId);

// ---------------------------------------------------------------------------
// After the extraction

/**
 * Save the draft as a design system (the active one). With `placeRebuild`, the rebuilt screenshot
 * goes on the canvas beside the screenshot (placed there too if it isn't), bound to the new system.
 */
export async function saveExtract(t: ChatTurn, o: ExtractOutcome, name: string, opts: { placeRebuild?: boolean } = {}): Promise<ExtractOutcome> {
  const draft = o.draft;
  if (!draft) return o;
  // What the rebuild couldn't draw of this product goes into the docs, so later requests approximate it the same way.
  const gaps = [...(o.rebuild?.gaps ?? []), ...(o.reconcile?.rebuildIssues ?? []).map((i) => ({ element: i.element, workaround: i.note }))].slice(0, 12);
  const ds = { ...draft, name: name.trim() || draft.name, updatedAt: Date.now(), ...(gaps.length ? { docs: { ...draft.docs, gaps } } : {}) };
  useSystems.getState().add(ds, true);
  let rebuiltId: string | null = null;
  if (opts.placeRebuild && o.rebuild?.status === "done" && o.rebuild.spec) {
    const { doc } = studio();
    const shot = shotsOf(t)[0];
    let anchorId = shot?.nodeId && doc.nodes[shot.nodeId] ? shot.nodeId : null;
    if (!anchorId && shot) {
      // The screenshot came from a file: put it on the canvas as the reference.
      const w = 390;
      const h = o.source ? Math.round((o.source.height / o.source.width) * w) : 844;
      const at = nextSlot();
      const img = makeImage(shot.ref, { name: `${ds.name} (source)`, x: at.x, y: at.y, w, h, meta: { source: "import" } });
      insertNodes([img], null, undefined, false);
      anchorId = img.id;
    }
    const a = anchorId ? worldBounds(studio().doc, anchorId) : null;
    const ids = await insertScreens([o.rebuild.spec], "import", ds.id, a ? { x: Math.round(a.x + a.w + 80), y: Math.round(a.y) } : undefined);
    rebuiltId = ids[0] ?? null;
  }
  unpinPreview(t.id);
  runs.delete(t.id);
  return { ...o, phase: "saved", draft: undefined, rebuild: null, reconcile: null, stage: null, retrying: null, saved: { systemId: ds.id, name: ds.name, rebuiltId } };
}

export function discardExtract(t: ChatTurn, o: ExtractOutcome): ExtractOutcome {
  stopRetry(t.id);
  unpinPreview(t.id);
  runs.delete(t.id);
  return { ...o, phase: "discarded", draft: undefined, rebuild: null, reconcile: null, stage: null, retrying: null };
}

/** Back to the answers (after an error, a stop, or to change them before running again). */
export function reopenAnswers(t: ChatTurn, o: ExtractOutcome): ExtractOutcome {
  stopRetry(t.id);
  unpinPreview(t.id);
  return { ...o, phase: "asking", form: { ...o.form, submitted: false, editing: false, current: REVIEW }, draft: undefined, rebuild: null, reconcile: null, stage: null, guideDone: false, guideError: undefined, retrying: null };
}

/**
 * A turn that was running when the page closed: a draft that exists is kept for review (with what
 * didn't finish noted); otherwise the turn shows as stopped and can run again with the same answers.
 */
export function settleExtract(t: ChatTurn): ChatTurn {
  const o = extractOutcomeOf(t);
  const running = t.status === "running";
  if (!o) return { ...t, status: running ? "stopped" : t.status, activity: undefined };
  const out: ExtractOutcome = { ...o, retrying: null };
  if (o.rebuild?.status === "running") out.rebuild = { status: "error", error: "Interrupted by a reload." };
  if (o.reconcile?.status === "running") out.reconcile = { status: "error", error: "Interrupted by a reload." };
  if (o.retrying && !o.guideDone) out.guideError = "Interrupted by a reload before the docs were written.";
  if (running && o.phase === "running" && o.draft) {
    const docs = o.options ? wantsGuide(o.options) : false;
    return { ...t, status: "done", activity: undefined, outcome: { ...out, phase: "draft", stage: null, guideError: docs && !o.guideDone ? "Interrupted by a reload before the docs were written." : out.guideError } };
  }
  if (running && o.phase === "running") return { ...t, status: "stopped", activity: undefined, outcome: { ...out, stage: null } };
  return { ...t, status: running ? "stopped" : t.status, activity: undefined, outcome: out };
}
