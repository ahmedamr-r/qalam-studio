import { studio } from "@/doc/store";
import type { Doc } from "@/doc/schema";
import { getSystem, useSystems, type DesignSystem } from "@/design-system/registry";
import { systemPayload, type SystemPayload } from "@/ai/ds-payload";
import { promptSystem, systemFacts, type DsFact } from "@/knowledge/facts";
import { generateBrief } from "@/knowledge/brief";
import { screenBriefFor } from "@/doc/brief";
import { dsKeyOf, listKeys, ref } from "@/knowledge/refs";
import { readRequest } from "@/knowledge/changes";
import { recordDecision, traceById, traceByTurn, updateDecision } from "@/knowledge/store";
import { dsEntries, entry, givenOf, mergeManifest, mergeTrace, researchEntries, sanitizeAssumed, sanitizeReliance, stripFactIds, type Manifest, type ManifestEntry } from "@/knowledge/trace";
import type { DecisionKind, DecisionTrace, KnowledgeControls, Provenance } from "@/knowledge/types";
import type { TuneOutcome } from "../ai/tune";
import { TOOL_LABEL, type Chat, type ChatTurn } from "../ai/chatTypes";
import { useChats } from "../ai/chats";
import { loadDecisions, type NamingDecision } from "../ai/aiStore";

/**
 * Recording decisions: what a request sends (its manifest of facts, under the ids the prompt shows
 * them with) and, when the answer is back, the facts the model says it relied on, kept only when
 * they were really sent. The AI flows call these; the hub reads the traces.
 */

// ---------------------------------------------------------------------------
// What a request sends

/** A system payload with the designer's forget and pin choices for it (the server leaves out and lifts the same facts). */
export function withKnowledge(p: SystemPayload, controls: KnowledgeControls | undefined = studio().doc.knowledge): SystemPayload {
  if (!controls) return p;
  // A copy of a system (a built-in system's first edit makes one) shares its facts' keys: a choice
  // made on the original holds in the copy too.
  const ids = new Set([p.id, getSystem(p.id)?.forkedFrom].filter((x): x is string => !!x));
  const keys = (m: Record<string, number>) => [
    ...new Set(
      Object.keys(m)
        .map((r) => dsKeyOf(r))
        .filter((k): k is { systemId: string; key: string } => !!k && ids.has(k.systemId))
        .map((k) => k.key),
    ),
  ];
  const exclude = keys(controls.forgotten);
  const pin = keys(controls.pinned);
  return exclude.length || pin.length ? { ...p, knowledge: { ...(exclude.length ? { exclude: exclude.slice(0, 400) } : {}), ...(pin.length ? { pin: pin.slice(0, 200) } : {}) } } : p;
}

/** The facts a system payload puts in the prompt, numbered as the server numbers them. */
export function systemEntries(p: SystemPayload): ManifestEntry[] {
  const ps = promptSystem(p);
  const k = p.knowledge;
  const { facts } = systemFacts(ps.name, ps.docs, ps.tokens, ps.inferred, { tags: true, exclude: new Set(k?.exclude ?? []), pin: new Set(k?.pin ?? []) });
  return dsEntries(ps.systemId, facts);
}

/** The decision a chat turn stands for in the hub: its trace, or the turn itself (made before tracing). */
export const decisionRefOfTurn = (turnId: string) => ref.decision(traceByTurn(turnId)?.id ?? `turn:${turnId}`);

/** Earlier turns of the chat as the chat history numbers them ([c2] is turn 2). */
export function contextEntries(turns: ChatTurn[]): ManifestEntry[] {
  return turns.flatMap((t, i) => (t.status === "done" && t.outcome ? [entry(`c${i + 1}`, decisionRefOfTurn(t.id), `${TOOL_LABEL[t.tool]}: ${t.request.text || t.request.screens?.map((s) => s.name).join(", ") || ""}`)] : []));
}

const screenBriefForDoc = (doc: Doc, id: string) => screenBriefFor(doc.brief, doc, id);
const chatOf = (chatId: string): Chat | undefined => useChats.getState().chats.find((c) => c.id === chatId);
const turnsBefore = (chatId: string, turnId: string) => {
  const turns = chatOf(chatId)?.turns ?? [];
  const i = turns.findIndex((t) => t.id === turnId);
  return i < 0 ? turns : turns.slice(0, i);
};
const turnOf = (chatId: string, turnId: string) => chatOf(chatId)?.turns.find((t) => t.id === turnId);

/** What a Generate request sends of the project's knowledge: the system (with forget/pin; none without a design system) and a small brief. */
export function generateKnowledge(ds: DesignSystem | null, doc: Doc, screenIds: string[]): { designSystem: SystemPayload | undefined; brief: string | undefined; entries: ManifestEntry[] } {
  const designSystem = ds ? withKnowledge(systemPayload(ds), doc.knowledge) : undefined;
  const b = generateBrief(doc.brief, doc, screenIds, doc.knowledge);
  return { designSystem, brief: b.text || undefined, entries: [...(designSystem ? systemEntries(designSystem) : []), ...b.entries] };
}

/** The designer's naming choices Token Detective follows, less the ones they told Qalam AI to forget. */
export function rememberedNames(): NamingDecision[] {
  const forgotten = studio().doc.knowledge?.forgotten ?? {};
  return loadDecisions().filter((d) => !forgotten[ref.naming(d)]);
}

// ---------------------------------------------------------------------------
// Recording

const clip = (t: string, n = 60) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
};

/** A turn's trace: the request's facts plus the chat before it and its research, and what the model relied on. */
export function recordTurnDecision(o: {
  chatId: string;
  turnId: string;
  kind: DecisionKind;
  entries: ManifestEntry[];
  reliedOn: unknown;
  status?: DecisionTrace["status"];
  summary?: string;
  model?: string;
  sample?: boolean;
  produced?: DecisionTrace["produced"];
  about?: string[];
  parentId?: string;
  assumed?: unknown;
}): string {
  const turn = turnOf(o.chatId, o.turnId);
  const manifest = mergeManifest(o.entries, contextEntries(turnsBefore(o.chatId, o.turnId)), researchEntries(o.turnId, turn?.research?.notes));
  const asked = readRequest(turn?.request.text ?? "");
  const title = asked.revise ? `Generate again · ${clip(asked.original || turn?.request.screens?.map((s) => s.name).join(", ") || "", 40)}` : `${TOOL_LABEL[turn?.tool ?? "generate"]} · ${clip(turn?.request.text || turn?.request.screens?.map((s) => s.name).join(", ") || "", 40)}`;
  return recordDecision({
    id: traceByTurn(o.turnId)?.id,
    kind: o.kind,
    at: turn?.at ?? Date.now(),
    title,
    summary: o.summary,
    chatId: o.chatId,
    turnId: o.turnId,
    parentId: o.parentId,
    model: o.model,
    sample: o.sample,
    status: o.status ?? "done",
    given: givenOf(manifest),
    reliedOn: sanitizeReliance(o.reliedOn, manifest),
    produced: o.produced ?? {},
    about: o.about,
    ...(o.assumed ? { assumed: sanitizeAssumed(o.assumed) } : {}),
  });
}

/** A critique session's trace: one decision, updated with each turn (given facts add up, the latest reason wins). */
export function recordCritique(o: { startedAt: number; screenIds: string[]; title: string; manifest: Manifest; reliedOn: unknown; summary: string; model?: string; sample?: boolean; produced: string[] }): string {
  const id = `critique-${o.startedAt.toString(36)}`;
  const turn = critiqueTurn(o.startedAt);
  const reliedOn = sanitizeReliance(o.reliedOn, o.manifest);
  const given = givenOf(o.manifest);
  const existing = traceById(id);
  if (existing) {
    updateDecision(id, (t) => ({ ...mergeTrace(t, { given, reliedOn }), summary: o.summary || t.summary, model: o.model ?? t.model, produced: { refs: [...new Set([...(t.produced.refs ?? []), ...o.produced])] }, ...(turn ? { chatId: turn.chatId, turnId: turn.turnId } : {}) }));
    return id;
  }
  return recordDecision({
    id,
    kind: "critique",
    at: o.startedAt,
    title: `Critique · ${clip(o.title, 40)}`,
    summary: o.summary,
    ...(turn ? { chatId: turn.chatId, turnId: turn.turnId } : {}),
    model: o.model,
    sample: o.sample,
    status: "done",
    given,
    reliedOn,
    produced: { refs: o.produced },
    about: o.screenIds,
  });
}


/** The chat turn that mirrors a critique session. */
function critiqueTurn(startedAt: number): { chatId: string; turnId: string } | null {
  for (const c of useChats.getState().chats) for (const t of c.turns) if (t.outcome?.kind === "critique" && t.outcome.startedAt === startedAt) return { chatId: c.id, turnId: t.id };
  return null;
}

/** Where the hub finds a critique's research: the chat turn that mirrors the session (its research is on that turn). */
export const critiqueResearchRef = (startedAt: number) => critiqueTurn(startedAt)?.turnId ?? `critique-${startedAt.toString(36)}`;

/** The critique decision a session recorded (for a fix's parent). */
export const critiqueDecisionId = (startedAt: number) => `critique-${startedAt.toString(36)}`;

/** A critique fix's trace: the system and goal it was given, the critique it follows ([p1]), what it relied on. */
export function recordFix(o: { startedAt: number; frameId: string; name: string; manifest: Manifest; reliedOn: unknown; summary?: string; model?: string; sample?: boolean }): string {
  const turn = critiqueTurn(o.startedAt);
  // Not tied to the chat turn: "Why?" on the critique turn shows the critique, and the fix hangs off it.
  return recordDecision({
    kind: "fix",
    at: Date.now(),
    title: `Fix · ${clip(o.name, 40)}`,
    summary: o.summary,
    ...(turn ? { chatId: turn.chatId } : {}),
    parentId: critiqueDecisionId(o.startedAt),
    model: o.model,
    sample: o.sample,
    status: "done",
    given: givenOf(o.manifest),
    reliedOn: sanitizeReliance(o.reliedOn, o.manifest),
    produced: { frames: [o.frameId] },
    about: [o.frameId],
  });
}

/** What a fix is told of the brief, with ids in front ([b1] the summary, [b2] the screen's goal), and the critique it follows. */
export function fixContext(doc: Doc, frameId: string, startedAt: number | undefined): { context: { summary: string; goal: string; firstNotice: string; primaryAction: string }; entries: ManifestEntry[] } {
  const controls = doc.knowledge;
  const off = (r: string) => !!controls?.forgotten[r];
  const entries: ManifestEntry[] = [];
  const summaryText = (doc.brief?.summary ?? "").slice(0, 2000);
  const summary = summaryText && !off(ref.summary) ? (entries.push(entry("b1", ref.summary, summaryText)), `[b1] ${summaryText}`) : "";
  const sb = doc.brief ? screenBriefForDoc(doc, frameId) : null;
  const goalOff = off(ref.screenGoal(frameId));
  const fields = { goal: goalOff ? "" : (sb?.goal ?? ""), firstNotice: goalOff ? "" : (sb?.firstNotice ?? ""), primaryAction: goalOff ? "" : (sb?.primaryAction ?? "") };
  const first = (["goal", "firstNotice", "primaryAction"] as const).find((k) => fields[k]);
  if (first) {
    entries.push(entry("b2", ref.screenGoal(frameId), [fields.goal, fields.firstNotice, fields.primaryAction].filter(Boolean).join(" · ")));
    fields[first] = `[b2] ${fields[first]}`;
  }
  if (startedAt) entries.push(entry("p1", ref.decision(critiqueDecisionId(startedAt)), "The critique this fix follows"));
  return { context: { summary, ...fields }, entries };
}

// ---------------------------------------------------------------------------
// Tune: a proposal is a decision; applying it makes the rules it added learned (with its reason).

const TUNE_LISTS: Record<string, string> = { "language.dos": "lang.dos", "language.donts": "lang.donts", "layout.rules": "layout.rules" };

function tuneListOf(docs: DesignSystem["docs"], target: string): string[] {
  if (target === "language.dos") return docs.language?.dos ?? [];
  if (target === "language.donts") return docs.language?.donts ?? [];
  if (target === "layout.rules") return docs.layout?.rules ?? [];
  return [];
}

/** The proposal was applied: the facts it added say so (with Tune's reason), and its trace counts as applied. */
export function noteTuneApplied(turnId: string, o: TuneOutcome) {
  const a = o.applied;
  if (!a) return;
  const trace = traceByTurn(turnId);
  const sys = getSystem(a.systemId);
  const refs: string[] = [];
  const tokens: string[] = [];
  const provenance: Record<string, Provenance> = { ...(sys?.provenance ?? {}) };
  for (const c of o.changes) {
    if (!c.picked || c.problem) continue;
    if (c.kind === "token") {
      tokens.push(c.path);
      continue;
    }
    if (c.op !== "add" || !sys) continue;
    const prefix = TUNE_LISTS[c.target];
    if (!prefix) {
      const comp = c.target.slice(0, c.target.lastIndexOf("."));
      refs.push(ref.ds(a.systemId, `guide:${comp}`));
      continue;
    }
    const list = tuneListOf(sys.docs, c.target).map((t) => t.slice(0, 200));
    const i = list.indexOf(c.text.slice(0, 200));
    if (i < 0) continue;
    const key = listKeys(prefix, list)[i];
    provenance[key] = { origin: "tune", at: a.at, turnId, reason: stripFactIds(c.reason).slice(0, 300), ...(trace ? { decisionId: trace.id } : {}) };
    refs.push(ref.ds(a.systemId, key));
  }
  if (sys && sys.source !== "builtin") useSystems.getState().update(a.systemId, { provenance });
  if (trace) updateDecision(trace.id, { status: "applied", produced: { refs, tokens, systemId: a.systemId } });
}

/** The proposal's changes were taken back out. */
export function noteTuneUndone(turnId: string) {
  const trace = traceByTurn(turnId);
  if (trace) updateDecision(trace.id, { status: "undone" });
}

/** A Tune proposal's trace: the system as its prompt showed it, the chat, the research. */
export function recordTune(o: { chatId: string; turnId: string; systemId: string; facts: DsFact[]; reliedOn: unknown; summary: string; model?: string; sample?: boolean; about?: string[] }) {
  return recordTurnDecision({ chatId: o.chatId, turnId: o.turnId, kind: "tune", entries: dsEntries(o.systemId, o.facts), reliedOn: o.reliedOn, status: "proposed", summary: o.summary, model: o.model, sample: o.sample, about: o.about });
}
