import { getAssetBlob } from "@/doc/assets";
import { callAI, AIError, type AIDelta } from "@/ai/client";
import { parsePartial } from "@/ai/partial-json";
import { systemPayload } from "@/ai/ds-payload";
import type { ComponentRequest } from "@/ai/component-import";
import { prepareImage, type PreparedImage } from "@/design-system/extract";
import {
  cleanReading,
  contentBox,
  edgeColor,
  fidelity,
  keepRevision,
  nearestRoles,
  patternFromReading,
  snapWidth,
  type CleanReading,
  type ComponentReading,
  type Fidelity,
  type Measure,
} from "@/design-system/component-import";
import { componentKey, fillComposition } from "@/design-system/custom";
import type { ComponentDef } from "@/design-system/docs";
import { getSystem, systemFor, tokenSetFor, useSystems, type DesignSystem } from "@/design-system/registry";
import { componentDrawing } from "../componentPreviews";
import { editSystem } from "../workspace/editing";
import { cutCrops } from "./crops";
import type { ChatTurn, ComponentOutcome } from "./chatTypes";

/**
 * Add component: a screenshot of one component becomes a component of a design system. Qalam AI
 * reads it into a composition of catalog parts; the studio cuts out its pictures, draws it with
 * the system, measures how close the drawing is to the screenshot, has Qalam AI compare the two
 * once and keeps the correction only if it measures closer; then the component joins the system
 * (a copy, for the built-in one), with the screenshot kept as its reference. A follow-up in the
 * same chat revises it in place.
 */

type Progress = (tokens: number) => void;

export interface ComponentDeps {
  patch: (p: Partial<ChatTurn> | ((t: ChatTurn) => Partial<ChatTurn>)) => void;
  context: string;
  /** Another turn of this chat (a follow-up revises the component an earlier turn added). */
  turn: (turnId: string) => ChatTurn | null;
}

/** Patch the turn's outcome (once there is one). */
const patchOutcome = (deps: ComponentDeps, p: Partial<ComponentOutcome>) =>
  deps.patch((t) => (t.outcome?.kind === "component" ? { outcome: { ...t.outcome, ...p } } : {}));

/** The component with every prop at its example, drawn directly (a system's version of the same name can't stand in for it). */
const exampleInst = (def: ComponentDef) => fillComposition(def, Object.fromEntries((def.props ?? []).map((p) => [p.name, p.example])));

const defPayload = (def: ComponentDef): NonNullable<ComponentRequest["current"]> => ({ name: def.name, purpose: def.purpose, props: def.props ?? [], composition: def.composition });

interface Drawn {
  render?: { data: string; width: number };
  renderError?: string;
  fit: Fidelity | null;
  /** Copy the drawing cuts off. */
  cut: string[];
  /** Parts that stick out of their container. */
  overflow: { name: string; by: number }[];
}

/** Draw a component with the system at its 1x width and measure it against the screenshot. */
async function drawAndMeasure(def: ComponentDef, dsId: string, width: number, img: PreparedImage): Promise<Drawn> {
  const d = await componentDrawing(exampleInst(def), dsId, width);
  if ("error" in d) return { renderError: d.error, fit: null, cut: [], overflow: [] };
  return { render: { data: d.base64, width }, fit: img.pixels ? fidelity(img.pixels, d.pixels) : null, cut: d.cut, overflow: d.overflow };
}

const measureOf = (d: Drawn): Measure => ({ fit: d.fit, broken: d.cut.length + d.overflow.length });

/** What the studio measured wrong in a drawing, for the model to fix. */
const issuesOf = (d: Drawn) => [
  ...(d.cut.length ? [`Text cut off in the drawing (it doesn't fit, so it ends in an ellipsis): ${d.cut.map((c) => JSON.stringify(c)).join(", ")}. Make it fit at this width: smaller sizes or padding, fewer parts in the row, or wrapping where the screenshot wraps; don't shorten copy the screenshot shows in full.`] : []),
  ...(d.overflow.length ? [`Parts stick out of their container in the drawing: ${d.overflow.map((o) => `${o.name} by ${o.by}px`).join(", ")}. A row's items must fit its width together (items that share a row equally, smaller sizes, or less padding).`] : []),
];

/** The screenshot's pictures cut out for the component (crop boxes are in pixels of the image as sent). */
async function withPictures(r: CleanReading, blob: Blob, img: PreparedImage): Promise<CleanReading> {
  const composition = await cutCrops(r.def.composition, blob, { x: img.sourceWidth / img.width, y: img.sourceHeight / img.height });
  return { ...r, def: { ...r.def, composition } };
}

/** Streams the model's first sentence to the turn while the rest is written. */
function readStream(deps: ComponentDeps) {
  let buf = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onDelta = (d: AIDelta) => {
    if (d.kind === "reset") buf = "";
    if (d.kind !== "json") return;
    buf += d.text;
    timer ??= setTimeout(() => {
      timer = undefined;
      const read = (parsePartial(buf) as { read?: unknown } | undefined)?.read;
      if (typeof read === "string" && read) patchOutcome(deps, { read });
    }, 150);
  };
  return { onDelta, stop: () => clearTimeout(timer) };
}

/**
 * Put the component in the system as one of its own, or replace `replace` (a revision, or a run
 * started again after it had already added its first version). A revision keeps the designer's
 * edits to the guide and takes the new parts, props and anatomy.
 */
function save(dsId: string, r: CleanReading, reference: string | undefined, replace?: string): NonNullable<ComponentOutcome["added"]> {
  const name = r.def.name;
  let replaced = false;
  const res = editSystem(dsId, replace ? `Revise ${name}` : `Add ${name}`, (_tree, docs) => {
    const next = patternFromReading(r, reference);
    const i = replace ? docs.patterns.findIndex((p) => componentKey(p.name) === componentKey(replace)) : -1;
    if (i >= 0) {
      replaced = true;
      const old = docs.patterns[i];
      const patterns = docs.patterns.map((p, j) => (j === i ? { ...old, name, purpose: next.purpose || old.purpose, props: next.props, composition: next.composition, reference: next.reference ?? old.reference, guide: { ...old.guide, component: name, anatomy: next.guide.anatomy } } : p));
      return { docs: { ...docs, patterns } };
    }
    if (docs.patterns.some((p) => componentKey(p.name) === componentKey(name))) return { error: `${systemFor(dsId).name} already has a component called ${name}.` };
    return { docs: { ...docs, patterns: [...docs.patterns, next] } };
  });
  if ("error" in res) throw new Error(res.error);
  const target = systemFor(res.id);
  return { systemId: target.id, systemName: target.name, name, ...(target.id !== dsId ? { forkedFrom: dsId } : {}), ...(replaced ? { replaced: true } : {}) };
}

async function screenshot(ref: string | undefined): Promise<{ blob: Blob; img: PreparedImage }> {
  const blob = ref ? await getAssetBlob(ref) : null;
  if (!blob) throw new Error("The screenshot is no longer available. Attach it again.");
  // Lossless when it fits: JPEG smears the hairlines and soft shadows a component is made of.
  return { blob, img: await prepareImage(blob, 1568, { lossless: true }) };
}

const imagePayload = (img: PreparedImage): ComponentRequest["image"] => ({ mediaType: img.mediaType, data: img.data, width: img.width, height: img.height });
const message = (e: unknown) => (e instanceof AIError || e instanceof Error ? e.message : String(e));

export async function runComponentImport(t: ChatTurn, ai: boolean, progress: Progress, signal: AbortSignal, deps: ComponentDeps): Promise<string | undefined> {
  if (!ai) throw new Error("Reading a screenshot needs Qalam AI, and AI isn't configured here.");
  if (t.request.revise) return revise(t, progress, signal, deps);

  const ref = t.request.source?.image;
  const { blob, img } = await screenshot(ref);
  const ds = systemFor(getSystem(t.request.system?.id) ? t.request.system!.id : useSystems.getState().activeId);
  const colours = nearestRoles(img.palette, tokenSetFor(ds.id));
  // Run again after a stop that came after it was added: the new version replaces that one.
  const prev = t.outcome?.kind === "component" && t.outcome.added && !t.outcome.removed ? t.outcome.added : undefined;
  deps.patch({ outcome: { kind: "component", phase: "reading", colours, source: ref, ...(prev ? { added: prev } : {}) } });

  const base = { image: imagePayload(img), palette: colours, designSystem: systemPayload(ds), context: deps.context || undefined };
  const stream = readStream(deps);
  let data: ComponentReading;
  let model: string | undefined;
  try {
    ({ data, model } = await callAI<ComponentReading>("/api/component", { ...base, stage: "build", note: t.request.text || undefined }, progress, signal, undefined, stream.onDelta));
  } finally {
    stream.stop();
  }
  if (data.scope === "screen") {
    patchOutcome(deps, { phase: "done", read: data.read, screen: true });
    return model;
  }

  const taken = ds.docs.patterns.map((p) => p.name).filter((n) => !prev || componentKey(n) !== componentKey(prev.name));
  const opts = { taken, systemName: ds.name, ...(prev ? { keep: prev.name } : {}) };
  const firstRaw = cleanReading(data, opts);
  // Its width at 1x: the model's judgement, snapped to what the screenshot's pixels allow.
  const bg = img.pixels ? edgeColor(img.pixels) : null;
  const contentPx = img.pixels && bg ? (contentBox(img.pixels, bg).w * img.sourceWidth) / img.width : img.sourceWidth;
  const width = snapWidth("error" in firstRaw ? Number(data.width) || 0 : firstRaw.width, contentPx).width;

  // An answer that can't be drawn goes straight to the check as something to fix.
  let first = "error" in firstRaw ? null : await withPictures(firstRaw, blob, img);
  patchOutcome(deps, { phase: "checking", read: data.read, width, ...(first ? { def: first.def, differences: first.differences } : {}) });
  deps.patch({ activity: first ? "Checking it against the screenshot" : "Fixing what the catalog can't draw" });
  const drawn1: Drawn = first ? await drawAndMeasure(first.def, ds.id, width, img) : { renderError: (firstRaw as { error: string }).error, fit: null, cut: [], overflow: [] };

  let kept = first;
  let keptDrawn = drawn1;
  let check: ComponentOutcome["check"];
  let checkNote: string | undefined;
  try {
    const current = first ? defPayload(first.def) : { name: String(data.name ?? "").slice(0, 60), purpose: String(data.purpose ?? "").slice(0, 400), props: data.props, composition: data.composition };
    const { data: d2 } = await callAI<ComponentReading>("/api/component", { ...base, stage: "check", current, render: drawn1.render, renderError: drawn1.renderError, issues: issuesOf(drawn1) }, progress, signal);
    const raw2 = cleanReading(d2, { ...opts, ...(first ? { keep: first.def.name } : {}) });
    if ("error" in raw2) {
      check = { before: drawn1.fit?.score ?? null, after: null, kept: "first", error: raw2.error };
    } else {
      const second = await withPictures(raw2, blob, img);
      const drawn2 = await drawAndMeasure(second.def, ds.id, width, img);
      const better = !first || keepRevision(measureOf(drawn1), measureOf(drawn2));
      if (better) kept = second;
      keptDrawn = better ? drawn2 : drawn1;
      check = { before: drawn1.fit?.score ?? null, after: drawn2.fit?.score ?? null, kept: better ? "revised" : "first" };
      checkNote = second.read || undefined;
    }
  } catch (e) {
    // Stopped during the check: the first version still joins the system.
    if ((e as Error).name === "AbortError") {
      if (first) patchOutcome(deps, { phase: "done", added: save(ds.id, first, ref, prev?.name), cut: drawn1.cut, overflow: drawn1.overflow, check: { before: drawn1.fit?.score ?? null, after: null, kept: "first", error: "Stopped before the check finished." } });
      throw e;
    }
    check = { before: drawn1.fit?.score ?? null, after: null, kept: "first", error: message(e) };
  }
  if (!kept) throw new Error(check?.error ? `Qalam AI couldn't build a component the catalog can draw: ${check.error}` : "Qalam AI couldn't build a component the catalog can draw.");
  const added = save(ds.id, kept, ref, prev?.name);
  patchOutcome(deps, { phase: "done", def: kept.def, differences: kept.differences, check, checkNote, added, cut: keptDrawn.cut, overflow: keptDrawn.overflow });
  return model;
}

/** The newest component this chat added that's still in its system, for a follow-up to revise. */
export function revisable(turns: ChatTurn[]): { turnId: string; name: string; systemId: string } | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const o = turns[i].outcome;
    if (o?.kind !== "component" || !o.added || o.removed) continue;
    const ds = getSystem(o.added.systemId);
    if (ds?.docs.patterns.some((p) => componentKey(p.name) === componentKey(o.added!.name))) return { turnId: turns[i].id, name: o.added.name, systemId: ds.id };
  }
  return null;
}

/** A follow-up: change the component an earlier turn added, as it is in the system now (hand edits included). */
async function revise(t: ChatTurn, progress: Progress, signal: AbortSignal, deps: ComponentDeps): Promise<string | undefined> {
  const from = deps.turn(t.request.revise!.turnId);
  const o = from?.outcome?.kind === "component" ? from.outcome : undefined;
  const ds: DesignSystem | undefined = o?.added ? getSystem(o.added.systemId) : undefined;
  const name = o?.added?.name ?? t.request.revise!.name;
  const pattern = ds?.docs.patterns.find((p) => componentKey(p.name) === componentKey(name));
  if (!ds || !pattern) throw new Error(`${name} isn't in a design system any more, so there's nothing to change. Attach the screenshot again to add it.`);
  const ref = o?.source ?? from?.request.source?.image ?? pattern.reference;
  const { blob, img } = await screenshot(ref);
  const width = o?.width ?? 358;
  deps.patch({ outcome: { kind: "component", phase: "reading", source: ref, width, colours: o?.colours }, activity: `Changing ${pattern.name}` });
  const drawn = await drawAndMeasure(pattern, ds.id, width, img);
  const stream = readStream(deps);
  let data: ComponentReading;
  let model: string | undefined;
  try {
    ({ data, model } = await callAI<ComponentReading>(
      "/api/component",
      { stage: "revise", image: imagePayload(img), palette: o?.colours ?? [], designSystem: systemPayload(ds), context: deps.context || undefined, note: t.request.text, current: defPayload(pattern), render: drawn.render, renderError: drawn.renderError, issues: issuesOf(drawn) },
      progress,
      signal,
      undefined,
      stream.onDelta,
    ));
  } finally {
    stream.stop();
  }
  const raw = cleanReading(data, { taken: [], keep: pattern.name });
  if ("error" in raw) throw new Error(raw.error);
  const next = await withPictures(raw, blob, img);
  const after = await drawAndMeasure(next.def, ds.id, width, img);
  const added = save(ds.id, next, ref, pattern.name);
  patchOutcome(deps, { phase: "done", read: next.read, def: next.def, differences: next.differences, added, cut: after.cut, overflow: after.overflow, check: { before: drawn.fit?.score ?? null, after: after.fit?.score ?? null, kept: "revised" } });
  return model;
}

/** Take the component a turn added out of its system again. Returns why it couldn't, if it couldn't. */
export function removeAdded(o: ComponentOutcome): string | null {
  const a = o.added;
  if (!a) return null;
  const r = editSystem(a.systemId, `Remove ${a.name}`, (_tree, docs) => {
    if (!docs.patterns.some((p) => componentKey(p.name) === componentKey(a.name))) return { error: `${a.name} isn't in ${a.systemName} any more.` };
    return { docs: { ...docs, patterns: docs.patterns.filter((p) => componentKey(p.name) !== componentKey(a.name)) } };
  });
  return "error" in r ? r.error : null;
}
