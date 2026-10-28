import { studio } from "@/doc/store";
import type { Doc } from "@/doc/schema";
import { emptyBrief } from "@/doc/brief";
import { rootBounds, treeRootOf, visibleCards } from "@/doc/board";
import { type Box, type Pt, boundsOf, worldBounds } from "@/doc/geometry";
import { clearGhosts, setGhost } from "@/doc/ghosts";
import { descendants } from "@/doc/geometry";
import { AIError, type AIDelta } from "@/ai/client";
import { parsePartial } from "@/ai/partial-json";
import { feedback } from "@/commands/feedback";
import { partialDraft, sanitizeDraft, type Draft } from "@/discovery/sanitize";
import { draftToDoc, placeholderDoc } from "@/discovery/draft-doc";
import { briefFromAnswers, type InterviewAnswer } from "@/discovery/interview";
import { isAssumed } from "@/discovery/evidence";
import { KIND_LABEL } from "@/discovery/kinds";
import { outcomeRoots } from "@/discovery/tree";
import { updateProject } from "@/projects/session";
import { openTurn, patchTurn, registerTurnHandlers } from "../ai/chats";
import { appendThought, endAgent, narrate, startAgent, updateAgent } from "../ai/agents";
import { getController } from "../CanvasView";
import { offline, runDraft } from "./ai";
import { orgContext } from "@/org/pack";
import { boardCardRefs, hubQuotes, packProduct, recordCall } from "./knowledge";
import { adoptSources } from "./sources";
import { SAMPLE_ANSWERS, SAMPLE_DRAFT_RAW } from "@/ai/fixtures-discovery";
import { useDiscovery } from "./store";

/*
 * Qalam AI drafting a board's tree from the product interview. The tree takes shape where it will
 * land while the answer is written (a ghost, under the Strategist's cursor), then lands as one undo
 * step, checked by code (sanitize.ts) first. Stop keeps the cards that were complete. The run is a
 * turn in the board's chat; Try again there runs it again with the same answers. It carries what
 * the organization already knows about the product, so a new board starts from what the team
 * learned: customers' quotes from its sources can back the needs it drafts.
 */

interface Run {
  answers: InterviewAnswer[];
  followUps: InterviewAnswer[];
  sample: boolean;
  /** The tree it replaces (Redo the interview), by its root card. */
  replace: string | null;
  ctrl: AbortController;
}

const runs = new Map<string, Run>();

/** Other work on the board that runs as a Discovery turn (a brain dump), with its own Stop and Try again. */
interface TurnRoute {
  owns: (turnId: string) => boolean;
  stop: (turnId: string) => void;
  retry: (turnId: string) => void;
}
const routes: TurnRoute[] = [];
export const routeTurns = (r: TurnRoute) => void routes.push(r);
const routeOf = (turnId: string) => routes.find((r) => r.owns(turnId));

let handlersOn = false;
/** Stop and Try again on the board's draft turns (at boot, so a reloaded chat's Try again works too). */
export function ensureHandlers() {
  if (handlersOn) return;
  handlersOn = true;
  registerTurnHandlers("discovery", {
    stop: (_chatId, turnId) => {
      const route = routeOf(turnId);
      if (route) return route.stop(turnId);
      runs.get(turnId)?.ctrl.abort();
    },
    retry: (_chatId, turnId) => {
      const route = routeOf(turnId);
      if (route) return route.retry(turnId);
      const r = runs.get(turnId);
      // After a reload the answers are on the project: back to the interview to send them again.
      if (!r) return useDiscovery.setState({ sheet: "interview" });
      void draftTree({ answers: r.answers, followUps: r.followUps, sample: r.sample, replace: r.replace });
    },
  });
}

/** Where a new tree goes: in view on an empty board, else to the right of what's there. */
export function placeFor(doc: Doc, replace: string | null): Pt {
  if (replace && doc.nodes[replace]) return { x: doc.nodes[replace].x, y: doc.nodes[replace].y };
  const roots = doc.roots.filter((id) => doc.nodes[id]);
  if (!roots.length) {
    const cam = studio().camera;
    const vw = getController()?.viewport.w ?? 900;
    return { x: Math.round(cam.x + vw / 2 / cam.zoom - 160), y: Math.round(cam.y + 96 / cam.zoom) };
  }
  const b = boundsOf(roots.flatMap((id) => {
    const r = rootBounds(doc, id);
    return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h }];
  }));
  return { x: Math.round(b.x + b.w + 240), y: Math.round(b.y) };
}

const countsOf = (d: Draft) => ({
  opportunities: d.cards.filter((c) => c.card.kind === "opportunity").length,
  solutions: d.cards.filter((c) => c.card.kind === "solution").length,
  assumed: d.cards.filter((c) => isAssumed(c.card)).length,
});

/** Put a draft on the board (one undo step), replacing a tree if asked; its answers go to the Library. */
function place(draft: Draft, at: Pt, replace: string | null, answers: InterviewAnswer[]): string | null {
  const built = draftToDoc(draft, at);
  if (!built) return null;
  const s = studio();
  s.mutate((d) => {
    if (replace && d.nodes[replace]) {
      for (const id of descendants(d, replace)) delete d.nodes[id];
      delete d.nodes[replace];
      d.roots = d.roots.filter((id) => id !== replace);
    }
    for (const n of Object.values(built.doc.nodes)) d.nodes[n.id] = n;
    d.roots.push(built.rootId);
  });
  const now = Date.now();
  studio().mutate(
    (d) => {
      const b = d.brief ?? emptyBrief();
      d.brief = { ...b, summary: draft.summary || b.summary, answers: [...b.answers.filter((a) => !a.id.startsWith("interview:")), ...briefFromAnswers(answers, now)].slice(-40), updatedAt: now };
    },
    { history: false },
  );
  studio().select([built.rootId]);
  requestAnimationFrame(() => getController()?.glideToFit(visibleCards(studio().doc, built.rootId)));
  return built.rootId;
}

export async function draftTree(input: { answers: InterviewAnswer[]; followUps?: InterviewAnswer[]; sample?: boolean; replace?: string | null }) {
  ensureHandlers();
  const followUps = input.followUps ?? [];
  const replace = input.replace ?? null;
  const all = [...input.answers, ...followUps];
  const { chatId, turnId } = openTurn("discovery", { text: input.sample ? "Draft the sample tree" : "Draft the tree from my answers" });
  const ctrl = new AbortController();
  runs.set(turnId, { answers: input.answers, followUps, sample: !!input.sample, replace, ctrl });
  useDiscovery.setState({ sheet: "closed", drafting: { chatId, turnId } });
  void updateProject((p) => ({ discovery: { ...(p.discovery ?? { v: 1, stage: "start" }), stage: "drafting" } }), { touch: false });

  // The tree takes shape here, over the one it replaces.
  const at = placeFor(studio().doc, replace);
  const key = `${turnId}:tree`;
  const ghost = (doc: Doc) => setGhost({ key, turnId, index: 0, doc, ...(replace ? { covers: replace } : {}) });
  const first = placeholderDoc(at);
  ghost(first.doc);
  const firstBox = worldBounds(first.doc, first.rootId);
  startAgent({ turnId, chatId, kind: "strategist", task: "Drafting the tree", activity: "Reading", target: firstBox });
  const c = getController();
  if (c) c.glideTo(c.fitCamera({ x: firstBox.x - 320, y: firstBox.y - 40, w: firstBox.w + 640, h: 520 }, {}, 1));

  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown = 0;
  const show = () => {
    timer = undefined;
    const d = partialDraft(parsePartial(buffer), all, hub);
    const built = draftToDoc(d, at);
    if (!built) return;
    ghost(built.doc);
    if (d.cards.length === shown && shown) return;
    shown = d.cards.length;
    // The cursor goes to the newest card; its bubble says what it is.
    const ids = Object.keys(built.doc.nodes);
    const newest = ids[ids.length - 1];
    const box: Box = worldBounds(built.doc, newest);
    const card = built.doc.nodes[newest].meta.ost!;
    updateAgent(turnId, { target: box, phase: "building", activity: "Drafting" });
    narrate(turnId, `${KIND_LABEL[card.kind]}: ${card.title || "…"}`);
  };
  const onDelta = (dl: AIDelta) => {
    if (dl.kind === "reset") {
      buffer = "";
      return;
    }
    if (dl.kind !== "json") return appendThought(turnId, dl.text);
    buffer += dl.text;
    timer ??= setTimeout(show, 150);
  };

  // What the organization already knows about what the builder said (none for the sample).
  const org = input.sample || (await offline()) ? null : await orgContext({ query: all.map((a) => `${a.question} ${a.answer}`).join("\n"), product: packProduct(), budget: 3000, exclude: boardCardRefs(studio().doc) });
  const hub = new Map([...(await hubQuotes(org))].map(([k, h]) => [k, () => h.evidence()]));
  /** The sources whose quotes the tree rests on join the board with it. */
  const adopt = (d: Draft) => void adoptSources([...(d.outcome ? [d.outcome] : []), ...d.cards.map((c) => c.card)].flatMap((c) => c.evidence.flatMap((e) => (e.sourceId ? [e.sourceId] : []))));
  try {
    const { raw, sample, model } = await runDraft(input.answers, followUps, { sample: input.sample, signal: ctrl.signal, onDelta, onProgress: (tokens) => patchTurn(chatId, turnId, { tokens }), ...(org ? { context: org.context } : {}) });
    clearTimeout(timer);
    // Asked for theirs, given the sample (Qalam AI isn't set up here): never pass one off as the other.
    if (sample && !input.sample) feedback("Qalam AI isn't set up here, so this is the sample tree. Connections sets it up.", { kind: "error", id: "discovery.sample" });
    const draft = sanitizeDraft(raw, all, Date.now(), hub);
    if (!draft.outcome) throw new AIError("parse", "Qalam AI didn't return an outcome. Try again.");
    const rootId = place(draft, at, replace, all);
    adopt(draft);
    recordCall({ title: "Drafted the tree from the interview", summary: draft.summary, org, raw, model, sample, produced: { refs: rootId ? [rootId] : [] } });
    patchTurn(chatId, turnId, { status: "done", model, sample, outcome: { kind: "discovery", action: "draft", summary: draft.summary, counts: countsOf(draft), ...(rootId ? { rootId } : {}) } });
    runs.delete(turnId);
    void updateProject((p) => ({ discovery: { ...(p.discovery ?? { v: 1, stage: "start" }), stage: "ready" } }), { touch: false });
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name === "AbortError") {
      // Stopped: what was complete stays (one undo step), marked as unfinished in the chat.
      const d = partialDraft(parsePartial(buffer), all, hub);
      const rootId = d.outcome ? place(d, at, replace, all) : null;
      if (rootId) adopt(d);
      patchTurn(chatId, turnId, { status: "stopped", ...(rootId ? { outcome: { kind: "discovery", action: "draft", summary: d.summary, counts: countsOf(d), rootId, partial: true } } : {}) });
      void updateProject((p) => ({ discovery: { ...(p.discovery ?? { v: 1, stage: "start" }), stage: rootId ? "ready" : "interview" } }), { touch: false });
    } else {
      const message = e instanceof Error ? e.message : String(e);
      patchTurn(chatId, turnId, { status: "error", error: message });
      feedback(`Qalam AI couldn't draft the tree: ${message}`, { kind: "error", id: "discovery.draft" });
      void updateProject((p) => ({ discovery: { ...(p.discovery ?? { v: 1, stage: "start" }), stage: "interview" } }), { touch: false });
    }
  } finally {
    clearGhosts(turnId);
    endAgent(turnId);
    useDiscovery.setState({ drafting: null });
  }
}

/** Basket's sample tree, straight onto the board (no turn): a brain dump's sample merges into it. */
export function placeSample(): string | null {
  return place(sanitizeDraft(SAMPLE_DRAFT_RAW, SAMPLE_ANSWERS), placeFor(studio().doc, null), null, SAMPLE_ANSWERS);
}

/** Stop the draft running on the board. */
export function stopDraft() {
  const d = useDiscovery.getState().drafting;
  if (d) runs.get(d.turnId)?.ctrl.abort();
}

/** The outcome tree work on the board is about: the one a selected card is in, else the first on the board. */
export function treeFor(doc: Doc, selection: readonly string[] = []): string | null {
  for (const id of selection) {
    const root = treeRootOf(doc, id);
    if (root && doc.nodes[root].meta.ost?.kind === "outcome") return root;
  }
  return outcomeRoots(doc)[0] ?? null;
}

/** The board has a tree that starts at an outcome. */
export const hasOutcome = (doc: Doc) => outcomeRoots(doc).length > 0;
