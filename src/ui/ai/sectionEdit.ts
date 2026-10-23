import { recordTurnDecision, systemEntries, withKnowledge } from "../knowledge/record";
import { studio } from "@/doc/store";
import { descendants, worldBounds, type Box } from "@/doc/geometry";
import { clearGhosts, setGhost } from "@/doc/ghosts";
import { release, reserve } from "@/doc/reservations";
import type { Doc } from "@/doc/schema";
import { callAI, type AIDelta, type AIEvent } from "@/ai/client";
import { parsePartial, isPartial } from "@/ai/partial-json";
import type { SectionResult } from "@/ai/schemas";
import { systemPayload } from "@/ai/ds-payload";
import { isEdited } from "@/design-system/apply";
import type { Inst, ScreenSpec } from "@/design-system/builders";
import { specAt } from "@/design-system/instances";
import { attachDefs, cleanDefs } from "@/design-system/custom";
import { isReservedName } from "@/design-system/components";
import type { ComponentDef } from "@/design-system/docs";
import { settledItems } from "@/design-system/partial-spec";
import { buildScreenNodes, ensureSystemFonts } from "@/design-system/place";
import { rebuildInstance, rebuildScreen } from "@/design-system/refresh";
import { systemFor } from "@/design-system/registry";
import { spliceSection, type SectionEdit } from "@/design-system/section";
import { ensureYoga } from "@/engine/layout";
import { lintNodes } from "@/lint/rules";
import { addCreated, appendThought, narrate, setStep, startAgent, updateAgent } from "./agents";
import { beginFollow, followTarget } from "./follow";
import { referenceImages } from "./references";
import type { ChatTurn, GenerateOutcome } from "./chatTypes";

/**
 * Generate, scoped to part of a screen: the designer selected components inside a generated
 * screen, so only those are replaced. The new version takes shape in place while the model
 * writes it (the screen is drawn as a ghost with the part swapped in), then goes into the
 * document as one undo step. Everything else stays as it is, layer for layer.
 */

const MIN_TICK = 150;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Components in a list, counting everything inside them. */
const size = (list: Inst[]): number => list.reduce((n, i) => n + 1 + size(i.children ?? []), 0);

/** The first `count` components of a list, in reading order. */
function take(list: Inst[], count: { left: number }): Inst[] {
  const out: Inst[] = [];
  for (const inst of list) {
    if (count.left <= 0) break;
    count.left--;
    out.push(inst.children ? { ...inst, children: take(inst.children, count) } : inst);
  }
  return out;
}

/** The edits written so far, for the allowed paths only; `done` when an edit's list is closed. */
function editsOf(value: unknown, allowed: Set<string>): { approach: string; approachDone: boolean; edits: (SectionEdit & { done: boolean })[]; defs: ComponentDef[] } {
  const root = isObj(value) ? value : {};
  // Components the edit defines come first; they count once written in full.
  const defs = cleanDefs(Array.isArray(root.newComponents) ? root.newComponents.filter((d) => isObj(d) && !isPartial(d)) : [], isReservedName);
  const out: (SectionEdit & { done: boolean })[] = [];
  for (const e of Array.isArray(root.edits) ? root.edits : []) {
    if (!isObj(e) || typeof e.path !== "string" || !allowed.has(e.path) || !("items" in e)) continue;
    // The path must be written in full before its items start.
    if (out.some((o) => o.path === e.path)) continue;
    out.push({ path: e.path, items: settledItems(e.items), done: !isPartial(e.items) && !isPartial(e) });
  }
  const approach = typeof root.approach === "string" ? root.approach : "";
  return { approach, approachDone: approach !== "" && "edits" in root, edits: out, defs };
}

const nodeAt = (d: Doc, rootId: string, path: string) => descendants(d, rootId).find((id) => d.nodes[id]?.meta.specPath === path);

function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

export async function runSectionEdit(
  t: ChatTurn,
  ai: boolean,
  progress: (tokens: number) => void,
  signal: AbortSignal,
  x: { chatId: string; title: string; context: string; onEvent: (e: AIEvent) => void; patch: (p: Partial<ChatTurn>) => void },
) {
  const sec = t.request.section!;
  const rootId = sec.rootId;
  const doc0 = studio().doc;
  const root = doc0.nodes[rootId];
  const base = root?.meta.spec as ScreenSpec | undefined;
  if (!root || !base) throw new Error("That screen is no longer on the canvas.");
  const paths = sec.paths.filter((p) => specAt(base, p));
  if (!paths.length) throw new Error("The selected part is no longer in that screen. Select it again and retry.");
  if (!ai) throw new Error("Changing part of a screen needs Qalam AI, which isn't configured on this deployment.");
  const dsId = root.meta.designSystem ?? "builtin";
  const names = paths.map((p) => specAt(base, p)!.component);
  // Hand-edited screens can't be redrawn from their spec without showing those edits undone.
  const edited = isEdited(doc0, rootId);
  const targetIds = paths.map((p) => nodeAt(doc0, rootId, p)).filter((id): id is string => !!id);
  const area = unionBox(targetIds.map((id) => worldBounds(doc0, id)));
  const screen = worldBounds(doc0, rootId);

  // The selected part shimmers until its new version starts to show.
  let veil: string | null = reserve("Updating", [], targetIds, t.id);
  const stepKey = "screen-0";
  const stepTitle = `${names.join(", ")} in ${root.name}`;
  startAgent({ turnId: t.id, chatId: x.chatId, kind: "designer", task: x.title, activity: "Thinking", target: area });
  beginFollow(t.id);
  if (area) followTarget(t.id, area, screen);
  setStep(t.id, stepKey, "", true, stepTitle);

  const allowed = new Set(paths);
  let latest: ReturnType<typeof editsOf> | null = null;
  let shown = 0;
  let lastKey = "";
  const known = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let buildMs = 0;

  /** Draw the screen with what's written so far swapped in, a component or two more each tick. */
  const tick = () => {
    timer = undefined;
    if (!latest || signal.aborted) return;
    if (latest.approach) {
      setStep(t.id, "approach", latest.approach, !latest.approachDone);
      if (!known.size) narrate(t.id, latest.approach);
    }
    const total = latest.edits.reduce((n, e) => n + size(e.items), 0);
    shown = Math.min(total, shown + (total - shown > 8 ? 2 : 1));
    const count = { left: shown };
    // An edit shows once something of it is ready (or it's a finished removal): the old part stays until then.
    const visible = latest.edits.map((e) => ({ path: e.path, items: take(e.items, count) })).filter((e, i) => e.items.length || (latest!.edits[i].done && !latest!.edits[i].items.length));
    const next = spliceSection(base, visible);
    const spec = attachDefs(next.spec, latest.defs);
    const key = JSON.stringify(spec);
    if (key !== lastKey && !edited) {
      lastKey = key;
      const t0 = performance.now();
      const nodes = buildScreenNodes(spec, dsId, { x: root.x, y: root.y }, root.meta.source);
      const ghost: Doc = { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), roots: [nodes[0].id] };
      setGhost({ key: `${t.id}:0`, turnId: t.id, index: 0, doc: ghost, covers: rootId });
      buildMs = performance.now() - t0;
      if (veil && visible.length) {
        release(veil);
        veil = null;
      }
      // What's new in the part, in reading order: listed in the chat, glowing on the canvas.
      let target: Box | null = null;
      for (const p of next.paths) {
        if (known.has(p)) continue;
        known.add(p);
        const n = nodes.find((m) => m.meta.specPath === p);
        if (!n) continue;
        target = worldBounds(ghost, n.id);
        addCreated(t.id, stepKey, { variant: 0, specPath: p, name: n.name, component: n.meta.component ?? n.name }, target);
        narrate(t.id, `${latest.approach ? `${latest.approach}\n` : ""}Adding ${n.name}…`);
      }
      if (target) {
        updateAgent(t.id, { target, phase: "building", activity: "Building" });
        followTarget(t.id, target, screen);
      }
    }
    if (shown < total) timer = setTimeout(tick, Math.max(MIN_TICK, buildMs * 4));
  };
  const schedule = () => {
    timer ??= setTimeout(tick, Math.max(MIN_TICK, buildMs * 4));
  };

  let buffer = "";
  let parseTimer: ReturnType<typeof setTimeout> | undefined;
  const onDelta = (d: AIDelta) => {
    if (d.kind === "reset") {
      // The model started over: keep showing what's there until the new answer catches up.
      buffer = "";
      return;
    }
    if (d.kind !== "json") return appendThought(t.id, d.text);
    buffer += d.text;
    parseTimer ??= setTimeout(() => {
      parseTimer = undefined;
      const next = editsOf(parsePartial(buffer), allowed);
      // A restarted answer only takes over once it has caught up with what's shown.
      if (latest && next.edits.reduce((n, e) => n + size(e.items), 0) < shown) return;
      latest = next;
      schedule();
    }, 100);
  };

  try {
    await Promise.all([ensureYoga(), ensureSystemFonts(dsId)]);
    const ds = systemFor(dsId);
    const references = await referenceImages(ds);
    const designSystem = withKnowledge(systemPayload(ds));
    const { data, model } = await callAI<SectionResult>(
      "/api/generate-section",
      {
        prompt: t.request.text,
        spec: base,
        targets: paths.map((p) => ({ path: p, component: specAt(base, p)!.component, spec: specAt(base, p) })),
        designSystem,
        context: x.context || undefined,
        connectors: t.request.connectors,
        references: references.length ? references : undefined,
      },
      progress,
      signal,
      x.onEvent,
      onDelta,
    );
    clearTimeout(parseTimer);
    clearTimeout(timer);
    const edits: SectionEdit[] = (data.edits ?? []).filter((e) => allowed.has(e.path) && Array.isArray(e.items));
    const made = cleanDefs(data.newComponents, isReservedName);
    const spliced = spliceSection(base, edits);
    const next = { ...spliced, spec: attachDefs(spliced.spec, made) };

    // Into the document as one undo step. An untouched screen is rebuilt from the new spec (its
    // other layers keep their ids); a hand-edited one gets just the new components, when the
    // change keeps its structure.
    const reshaped = edited && !next.oneForOne;
    studio().beginTx();
    studio().mutate((d) => {
      if (!d.nodes[rootId]) return;
      if (!edited || reshaped) rebuildScreen(d, rootId, next.spec);
      else {
        d.nodes[rootId].meta.spec = structuredClone(next.spec);
        for (const e of edits) {
          const id = nodeAt(d, rootId, e.path);
          if (id) rebuildInstance(d, id, rootId, dsId);
        }
      }
    });
    studio().commitTx();
    clearGhosts(t.id);
    lintNodes([rootId]);
    const doc = studio().doc;
    const put = [...new Set(next.paths.filter((p) => !next.paths.some((q) => q !== p && p.startsWith(`${q}.`))))].map((p) => nodeAt(doc, rootId, p)).filter((id): id is string => !!id);
    if (put.length) studio().select(put);

    const outcome: GenerateOutcome = {
      kind: "generate",
      approach: data.approach,
      variants: [next.spec],
      offSystem: data.offSystem ?? [],
      frameIds: [rootId],
      section: { paths: next.paths, names },
      ...(reshaped ? { lostEdits: true } : {}),
      ...(made.length ? { newComponents: made } : {}),
    };
    x.patch({ outcome, model, status: "done" });
    recordTurnDecision({ chatId: x.chatId, turnId: t.id, kind: "section", entries: systemEntries(designSystem), reliedOn: (data as { reliedOn?: unknown }).reliedOn, assumed: (data as { assumed?: unknown }).assumed, summary: data.approach, model, produced: { frames: [rootId] }, about: [rootId] });
  } finally {
    clearTimeout(parseTimer);
    clearTimeout(timer);
    clearGhosts(t.id);
    if (veil) release(veil);
  }
}
