import { studio } from "@/doc/store";
import type { Doc } from "@/doc/schema";
import { callAI, type AIEvent } from "@/ai/client";
import { tuneFacts, type TuneRequest, type TuneResult } from "@/ai/tune";
import { SAMPLE_TUNE } from "@/ai/fixtures-tune";
import { isEdited } from "@/design-system/apply";
import type { Platform } from "@/design-system/platform";
import { getSystem, systemFor, useSystems, type DesignSystem } from "@/design-system/registry";
import { TokenSet } from "@/design-system/resolve";
import { TUNABLE_PATHS, applyChanges, revertChanges, tokenText, type ApplyResult, type SystemChange, type Undo } from "@/design-system/tune";
import { editSystem } from "../workspace/editing";
import { recordTune } from "../knowledge/record";
import { stripFactIds } from "@/knowledge/trace";
import { CATALOG } from "@/design-system/components";
import { recipePaths } from "@/design-system/recipes";
import { componentPNG } from "../componentPreviews";
import { nodeToDataURL } from "../exporter";
import { outline } from "./outline";
import { referenceImages } from "./references";
import type { ChatTurn } from "./chatTypes";

/**
 * The "Tune system" tool: Claude proposes changes to a design system (tokens, component recipes,
 * generator rules) from the designer's feedback or a screen they didn't like; the designer picks
 * which to apply. The built-in system is never edited: its changes go into a copy.
 */

export type ProposedChange = SystemChange & {
  picked: boolean;
  /** Why it can't be applied as proposed. */
  problem?: string;
  /** Token changes: the value it replaces, and the colours before and after for swatches. */
  from?: string;
  fromColor?: string;
  toColor?: string;
};

export interface TuneBrief {
  text: string;
  lang?: "en" | "ar" | "both";
  platform?: Platform;
}

export interface TuneApplied {
  at: number;
  /** The system that was changed (a new copy when the source was the built-in one). */
  systemId: string;
  systemName: string;
  forked: boolean;
  prevActiveId: string;
  undo: Undo[];
}

export interface TuneOutcome {
  kind: "tune";
  systemId: string;
  systemName: string;
  diagnosis: string;
  limitations: string[];
  changes: ProposedChange[];
  /** The Generate request behind the screen, to try again once the system is tuned. */
  brief?: TuneBrief;
  applied?: TuneApplied;
}

// ---------------------------------------------------------------------------
// Request

const valueText = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v));

export function tunePayload(ds: DesignSystem): TuneRequest["system"] {
  const ts = new TokenSet(ds.tree);
  const tokens = TUNABLE_PATHS.flatMap((path) => {
    const t = ts.get(path);
    return t ? [{ path, type: t.type, value: tokenText(ts, path).slice(0, 400), resolved: valueText(t.value).slice(0, 400) }] : [];
  });
  return { name: ds.name, tokens, docs: ds.docs };
}

function screenPayload(doc: Doc, id: string, brief?: string): TuneRequest["screens"][number] {
  const n = doc.nodes[id];
  const spec = n.meta.spec && !isEdited(doc, id) ? n.meta.spec : undefined;
  // About 1500px on the long side: detailed enough to judge, within what the model reads at full size.
  const img = nodeToDataURL(id, Math.min(2, 1500 / Math.max(n.w, n.h, 1)));
  return { name: n.name.slice(0, 120), spec, outline: spec ? undefined : outline(doc, id).slice(0, 19_500), image: img?.split(",")[1], brief: brief?.slice(0, 800) };
}

/** Claude's answer as a reviewable proposal, checked against the system as it is now. */
export function proposal(ds: DesignSystem, res: TuneResult, brief?: TuneBrief): TuneOutcome {
  // Fact ids ("[d12]") the model may have copied from the prompt never reach a rule: a removal must quote the rule exactly.
  const changes: SystemChange[] = [
    ...res.tokens.map((t) => ({ kind: "token" as const, ...t, reason: stripFactIds(t.reason) })),
    ...res.guidance.map((g) => ({ kind: "guidance" as const, ...g, text: stripFactIds(g.text), reason: stripFactIds(g.reason) })),
  ];
  const dry = applyChanges(ds.tree, ds.docs, changes);
  const before = new TokenSet(ds.tree);
  const after = new TokenSet(dry.tree);
  return {
    kind: "tune",
    systemId: ds.id,
    systemName: ds.name,
    diagnosis: stripFactIds(res.diagnosis),
    limitations: res.limitations.map(stripFactIds),
    brief,
    changes: changes.map((c, i) => {
      const problem = dry.problems[i] ?? undefined;
      const p: ProposedChange = { ...c, picked: !problem, ...(problem ? { problem } : {}) };
      if (c.kind === "token") {
        p.from = tokenText(before, c.path);
        if (before.get(c.path)?.type === "color") {
          p.fromColor = before.paint(c.path)?.color;
          if (!problem) p.toColor = after.paint(c.path)?.color;
        }
      }
      return p;
    }),
  };
}

/** A component asked about from the component library: its recipe tokens and how it looks now. */
async function componentPayload(name: string, ds: DesignSystem): Promise<NonNullable<TuneRequest["component"]>> {
  const spec = CATALOG.find((c) => c.name === name);
  const guide = ds.docs.components.find((c) => c.component === name);
  const tokens = recipePaths(name, TUNABLE_PATHS, guide?.tokens ?? []).slice(0, 150);
  const image = spec ? await componentPNG({ component: name, props: spec.example, children: spec.exampleChildren }, ds.id) : null;
  return { name, tokens, image: image ?? undefined };
}

export interface TuneDeps {
  patch: (p: Partial<ChatTurn>) => void;
  context: string;
  /** The Generate request that produced a screen, if it came from a chat. */
  briefOf: (frameId: string) => TuneBrief | undefined;
  /** Research-step events (lookups, then what they found). */
  onEvent?: (e: AIEvent) => void;
  /** The turn, for the decision's trace in the Knowledge hub. */
  ids?: { chatId: string; turnId: string };
}

export async function runTune(t: ChatTurn, ai: boolean, progress: (tokens: number) => void, signal: AbortSignal, deps: TuneDeps) {
  const ds = systemFor(t.request.system?.id);
  const { doc } = studio();
  const ids = (t.request.screens ?? []).map((s) => s.id).filter((id) => doc.nodes[id]);
  const brief = ids.map(deps.briefOf).find(Boolean);
  if (!ai) {
    const outcome = proposal(ds, SAMPLE_TUNE, brief);
    deps.patch({ outcome, sample: true });
    if (deps.ids) recordTune({ ...deps.ids, systemId: ds.id, facts: tuneFacts(tunePayload(ds)), reliedOn: SAMPLE_TUNE.reliedOn, summary: outcome.diagnosis, sample: true, about: ids });
    return;
  }
  const body: TuneRequest = {
    feedback: t.request.text,
    system: tunePayload(ds),
    screens: ids.map((id) => screenPayload(doc, id, deps.briefOf(id)?.text)),
    context: deps.context || undefined,
    connectors: t.request.connectors,
    component: t.request.component ? await componentPayload(t.request.component, ds) : undefined,
  };
  const references = await referenceImages(ds);
  if (references.length) body.references = references;
  const { data, model } = await callAI<TuneResult>("/api/tune-system", body, progress, signal, deps.onEvent);
  const outcome = proposal(systemFor(ds.id), data, brief);
  deps.patch({ outcome, model });
  if (deps.ids) recordTune({ ...deps.ids, systemId: ds.id, facts: tuneFacts(body.system), reliedOn: data.reliedOn, summary: outcome.diagnosis, model, about: ids });
}

// ---------------------------------------------------------------------------
// Applying

const stripUi = ({ picked: _p, problem: _pr, from: _f, fromColor: _fc, toColor: _tc, ...c }: ProposedChange): SystemChange => c as SystemChange;

/**
 * Apply the picked changes through the design-system editor, like a hand edit: the built-in
 * system gets an editable copy (active if the original was), the change joins the editor's undo
 * history, and screens bound to the system follow at once.
 */
export function applyTune(o: TuneOutcome): TuneOutcome {
  if (!getSystem(o.systemId)) throw new Error(`${o.systemName} has been deleted.`);
  const prevActiveId = useSystems.getState().activeId;
  let result: ApplyResult | null = null;
  const r = editSystem(o.systemId, "AI changes", (tree, docs) => {
    result = applyChanges(tree, docs, o.changes.filter((c) => c.picked && !c.problem).map(stripUi));
    return { tree: result.tree, docs: result.docs };
  });
  if ("error" in r) throw new Error(r.error);
  const applied = result as unknown as ApplyResult;
  // Anything that stopped checking out since the proposal is shown as skipped.
  let k = 0;
  const changes = o.changes.map((c) => {
    if (!c.picked || c.problem) return c;
    const problem = applied.problems[k++];
    return problem ? { ...c, picked: false, problem } : c;
  });
  const target = systemFor(r.id);
  return { ...o, changes, applied: { at: Date.now(), systemId: target.id, systemName: target.name, forked: target.id !== o.systemId, prevActiveId, undo: applied.undo } };
}

/** Take the changes back out of the system they went into (a copy stays, with any later edits). */
export function undoTune(o: TuneOutcome): TuneOutcome {
  const a = o.applied;
  if (!a) return o;
  if (getSystem(a.systemId)) editSystem(a.systemId, "Undo AI changes", (tree, docs) => revertChanges(tree, docs, a.undo));
  return { ...o, applied: undefined };
}
