import { generateKnowledge, recordTurnDecision, rememberedNames, withKnowledge } from "../knowledge/record";
import { create } from "zustand";
import { nanoid } from "nanoid";
import { studio } from "@/doc/store";
import { onComponentsPage } from "@/doc/pages";
import { getAssetBlob, putAsset } from "@/doc/assets";
import { makeImage } from "@/doc/factory";
import { insertNodes } from "@/doc/ops";
import { selectionBounds, topFrameOf, worldBounds, type Box } from "@/doc/geometry";
import { callAI, aiStatus, AIError, type AIDelta, type AIEvent } from "@/ai/client";
import { parsePartial } from "@/ai/partial-json";
import type { AuditResult, ExtractResult, GenerateResult } from "@/ai/schemas";
import { SAMPLE_EXTRACT_CSS, SAMPLE_GENERATE } from "@/ai/fixtures";
import { systemPayload } from "@/ai/ds-payload";
import { activeSystem, dsIdForNode, getSystem, systemFor, useSystems, type DesignSystem } from "@/design-system/registry";
import { FREEFORM_ID, FREEFORM_NAME, defaultLook, lookSystem, sanitizeLook } from "@/design-system/freeform";
import { knobHash } from "@/design-system/interview/knobs";
import { addDetectedTokens } from "@/design-system/detective";
import { addComponentToSystem, editSystem } from "../workspace/editing";
import { extractFromCSS, extractFromJSON, prepareImage, type RawValue } from "@/design-system/extract";
import { ensureSystemFonts, frameSize, insertScreens, reserveScreens, SCREEN_GAP } from "@/design-system/place";
import { ensureYoga } from "@/engine/layout";
import { platformOf } from "@/design-system/builders";
import { attachDefs, cleanDefs, componentKey } from "@/design-system/custom";
import { cutCrops } from "./crops";
import { isReservedName } from "@/design-system/components";
import { inferPlatform, type Platform } from "@/design-system/platform";
import { release, reserve, updateReservation, useReservations } from "@/doc/reservations";
import { clearGhosts } from "@/doc/ghosts";
import { applyFix, lintNodes, type Finding } from "@/lint/rules";
import { getController } from "../CanvasView";
import { nodeToDataURL } from "../exporter";
import { outline } from "./outline";
import { loadDecisions, type DetectiveRow } from "./aiStore";
import { chatContext, selectionContext } from "./chatContext";
import { CRITIQUE_OWNER, stop as stopCritique, useCritique, type CritiqueSession } from "./critiqueSession";
import * as chatDb from "./chatDb";
import { chatProject } from "@/projects/migrate";
import { runTune, type TuneBrief } from "./tune";
import { activeConnectors } from "./connectors";
import { referenceImages } from "./references";
import { repairScreens } from "./repair";
import { extractOutcomeOf, extractSource, runExtract, settleExtract, shotsOf, type ShotInput } from "./extract";
import { addCreated, agentFor, appendThought, endAgent, isFollowing, narrate, setStep, startAgent, updateAgent } from "./agents";
import { createProgressiveBuild } from "./progressive";
import { replayStream } from "./replay";
import { runSectionEdit } from "./sectionEdit";
import { revisable, runComponentImport } from "./componentImport";
import { runDirection } from "./direction";
import { planFirst, planPayload } from "./plan";
import { screensFor } from "@/ai/screen-count";
import { placeRoute } from "@/proto/takes";
import { selectedSection } from "@/design-system/section";
import { beginFollow, followTarget, showAboveChat } from "./follow";
import type { ScreenSpec } from "@/design-system/builders";
import { TOOL_LABEL, type AuditOutcome, type Chat, type ChatOutcome, type ChatRequest, type ChatTool, type ChatTurn, type GenerateOutcome } from "./chatTypes";

/**
 * AI chats. Every request from the AI panel becomes a turn in the active chat, and so does every
 * critique (its questions stay in the card on the canvas; the turn tracks it). Later requests send
 * the earlier turns as context, until the designer starts a new chat.
 */

interface ChatsState {
  chats: Chat[];
  /** null = a new, empty chat (created on the first request). */
  activeId: string | null;
  loaded: boolean;
}

export const useChats = create<ChatsState>(() => ({ chats: [], activeId: null, loaded: false }));

const MAX_CHATS = 50;
const ACTIVE_KEY = "qalam/ai-chat-active/v1";

/**
 * Chats belong to a project: only the open project's are loaded, and new ones are tagged with it.
 * Chats saved before projects have no project and belong to the one the old document became.
 * (No project set, as in tests: every chat.)
 */
let scope: { projectId: string | null; legacyId: string | null } = { projectId: null, legacyId: null };
export function setChatScope(projectId: string | null, legacyId: string | null) {
  scope = { projectId, legacyId };
}
const activeKey = () => (scope.projectId ? `${ACTIVE_KEY}/${scope.projectId}` : ACTIVE_KEY);
const inScope = (c: Chat) => !scope.projectId || chatProject(c, scope.legacyId) === scope.projectId;
const controllers = new Map<string, AbortController>();

const get = () => useChats.getState();
export const chatById = (id: string | null) => (id ? (get().chats.find((c) => c.id === id) ?? null) : null);
export const useActiveChat = () => useChats((s) => s.chats.find((c) => c.id === s.activeId) ?? null);

// ---------------------------------------------------------------------------
// Persistence: one IndexedDB record per chat, written shortly after it changes.

const dirty = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(id: string) {
  dirty.add(id);
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const ids = [...dirty];
    dirty.clear();
    for (const cid of ids) {
      const c = chatById(cid);
      // A running turn is saved as it stands; on reload it shows as stopped.
      void (c ? chatDb.put(cid, c) : chatDb.remove(cid)).catch(() => {});
    }
  }, 400);
}

function setActive(activeId: string | null) {
  useChats.setState({ activeId });
  try {
    if (activeId) localStorage.setItem(activeKey(), activeId);
    else localStorage.removeItem(activeKey());
  } catch {
    /* storage unavailable */
  }
}

const isMirrored = (turnId: string) => [...mirrored.values()].some((m) => m.turnId === turnId);

/**
 * A turn that was running when the page closed can't finish: show it as stopped. Critique
 * sessions don't survive a reload either, so an unfinished one is closed.
 */
function settleOnLoad(t: ChatTurn): ChatTurn {
  if (controllers.has(t.id) || isMirrored(t.id)) return t;
  if (t.tool === "extract") return settleExtract(t);
  const o = t.outcome;
  const outcome = o?.kind === "critique" && o.status !== "done" && o.status !== "closed" ? { ...o, status: "closed" as const, fix: o.fix === "running" ? null : o.fix } : o;
  return { ...t, status: t.status === "running" ? "stopped" : t.status, outcome };
}

let started = false;
/** Load saved chats and start mirroring critiques. Safe to call more than once. */
export function startChats() {
  if (started || typeof window === "undefined") return;
  started = true;
  useCritique.subscribe((s, prev) => {
    if (s.session !== prev.session) mirrorCritique(s.session, prev.session);
  });
  chatDb
    .loadAll<Chat>()
    .then((saved) => {
      const live = get().chats;
      const merged = [...live, ...saved.filter((c) => inScope(c) && !live.some((l) => l.id === c.id))]
        .map((c) => ({ ...c, turns: c.turns.map(settleOnLoad) }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      let activeId = get().activeId;
      if (!activeId) {
        try {
          const want = localStorage.getItem(activeKey()) ?? (scope.projectId && scope.projectId === scope.legacyId ? localStorage.getItem(ACTIVE_KEY) : null);
          if (want && merged.some((c) => c.id === want)) activeId = want;
        } catch {
          /* ignore */
        }
      }
      useChats.setState({ chats: merged, activeId, loaded: true });
    })
    .catch(() => useChats.setState({ loaded: true }));
}

// ---------------------------------------------------------------------------
// Chats

export function newChat() {
  setActive(null);
}

export function openChat(id: string) {
  const c = chatById(id);
  if (!c) return;
  setActive(id);
  if (c.unread) updateChat(id, (x) => ({ ...x, unread: false }));
}

export function renameChat(id: string, title: string) {
  const t = title.trim().replace(/\s+/g, " ").slice(0, 80);
  if (t && chatById(id)) updateChat(id, (c) => ({ ...c, title: t }));
}

/** Move a chat to (or back from) the Archived section; archiving the open chat starts a new one. */
export function archiveChat(id: string, archived = true) {
  if (!chatById(id)) return;
  updateChat(id, (c) => ({ ...c, archived }));
  if (archived && get().activeId === id) setActive(null);
}

export function deleteChat(id: string) {
  for (const t of chatById(id)?.turns ?? []) controllers.get(t.id)?.abort();
  useChats.setState({ chats: get().chats.filter((c) => c.id !== id) });
  if (get().activeId === id) setActive(null);
  scheduleSave(id);
}

function titleFor(tool: ChatTool, r: ChatRequest): string {
  const text = r.text.trim().replace(/\s+/g, " ");
  if (text && tool !== "detective" && tool !== "extract") return text.length > 60 ? `${text.slice(0, 58)}…` : text;
  const screens = (tool === "extract" ? r.source?.images : r.screens)?.map((s) => s.name).join(", ");
  return `${tool === "detective" ? "Token detective" : TOOL_LABEL[tool]}${screens ? ` · ${screens}` : ""}`.slice(0, 60);
}

/** The active chat, created if the designer is on a new one. */
function ensureChat(tool: ChatTool, r: ChatRequest): Chat {
  return chatById(get().activeId) ?? createChat(tool, r);
}

/** A new chat for a request, opened. */
function createChat(tool: ChatTool, r: ChatRequest): Chat {
  const now = Date.now();
  const chat: Chat = { id: nanoid(10), title: titleFor(tool, r), createdAt: now, updatedAt: now, turns: [], ...(scope.projectId ? { projectId: scope.projectId } : {}) };
  const chats = [chat, ...get().chats];
  for (const old of chats.slice(MAX_CHATS)) scheduleSave(old.id);
  useChats.setState({ chats: chats.slice(0, MAX_CHATS) });
  setActive(chat.id);
  return chat;
}

function updateChat(chatId: string, fn: (c: Chat) => Chat) {
  useChats.setState({ chats: get().chats.map((c) => (c.id === chatId ? fn(c) : c)) });
  scheduleSave(chatId);
}

function addTurn(chatId: string, turn: ChatTurn) {
  updateChat(chatId, (c) => ({ ...c, updatedAt: Date.now(), turns: [...c.turns, turn] }));
}

export function patchTurn(chatId: string, turnId: string, patch: Partial<ChatTurn> | ((t: ChatTurn) => Partial<ChatTurn>)) {
  updateChat(chatId, (c) => ({
    ...c,
    updatedAt: Date.now(),
    turns: c.turns.map((t) => (t.id === turnId ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t)),
  }));
}

const turnOf = (chatId: string, turnId: string) => chatById(chatId)?.turns.find((t) => t.id === turnId) ?? null;

/** Earlier turns of a chat, as context for the turn `turnId`. */
function contextFor(chatId: string, turnId: string): string {
  const turns = chatById(chatId)?.turns ?? [];
  const i = turns.findIndex((t) => t.id === turnId);
  return chatContext(studio().doc, i < 0 ? turns : turns.slice(0, i));
}

/** The Generate request that produced a screen, from any chat. */
export function generatedBrief(frameId: string): TuneBrief | undefined {
  for (const c of get().chats)
    for (const t of c.turns) if (t.outcome?.kind === "generate" && t.outcome.frameIds.includes(frameId)) return { text: t.request.text, lang: t.request.lang, platform: t.request.platform };
  return undefined;
}

/** Root frames in the current selection, left to right. */
export function selectedScreens(doc = studio().doc, selection = studio().selection): { id: string; name: string }[] {
  const ids = [...new Set(selection.filter((id) => doc.nodes[id]).map((id) => topFrameOf(doc, id)))].filter((id) => doc.nodes[id]?.type === "frame");
  return ids.map((id) => ({ id, name: doc.nodes[id].name }));
}

// ---------------------------------------------------------------------------
// Sending

export interface SendInput {
  tool: Exclude<ChatTool, "critique">;
  text: string;
  lang?: "en" | "ar" | "both";
  /** Generate: the platform to design for; "auto" (the default) reads it from the brief. */
  platform?: Platform | "auto";
  /** Detective: a screenshot instead of pasted text. Add component: the component's screenshot. */
  image?: Blob;
  rebuild?: boolean;
  /** Tune: change just this catalog component, in this system (from the component library). Add component: the system it joins. */
  component?: string;
  systemId?: string;
  /** Extract: screenshots of one product; `sample` = the bundled sample screenshot. */
  images?: ShotInput[];
  sample?: boolean;
  /** Generate: replay the recorded sample through the live build (the Replays chips). */
  replay?: boolean;
  /** Generate: plan first — ask the designer a few questions before drawing (new screens only). */
  plan?: boolean;
  /** Direction: the frames to switch, and how. */
  frames?: { id: string; name: string }[];
  direction?: ChatRequest["direction"];
}

/**
 * The platform a Generate request is for when the designer leaves it on Auto: that of the
 * selected screens (a follow-up revises them), else what the brief asks for.
 */
export function autoPlatform(text: string, screens: { id: string }[] = selectedScreens()): Platform {
  const { doc } = studio();
  const first = screens.map((s) => doc.nodes[s.id]).find(Boolean);
  if (first) return first.meta.spec ? platformOf(first.meta.spec) : first.w >= 1000 ? "web" : "mobile";
  return inferPlatform(text);
}

/** How many screens a Generate request is expected to return, for the space held for them: one per plan direction, else one. */
function expectedScreens(r: ChatRequest, plan?: { variants: string[] }): number {
  const both = r.lang === "both";
  return r.screens?.length ? r.screens.length * (both ? 2 : 1) : screensFor(plan) + (both ? 1 : 0);
}

/** Parse pasted Detective input (token JSON or CSS). */
export function parseSource(text: string): { mode: "css" | "json"; raw: RawValue[]; error?: string } {
  const t = text.trim();
  if (!t) return { mode: "css", raw: [] };
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return { mode: "json", raw: extractFromJSON(t) };
    } catch (e) {
      return { mode: "json", raw: [], error: (e as Error).message };
    }
  }
  try {
    return { mode: "css", raw: extractFromCSS(t) };
  } catch (e) {
    return { mode: "css", raw: [], error: (e as Error).message };
  }
}

/** Add a request to the active chat and run it. */
export async function send(input: SendInput) {
  // From the Components page, work goes to the page it was opened from (new screens land there);
  // a component's tune stays (it changes the system the page shows).
  if (onComponentsPage(studio().doc) && !(input.tool === "tune" && input.component)) {
    const { backPage, goToPage } = await import("../pages");
    goToPage(backPage());
  }
  const screens = selectedScreens();
  const request: ChatRequest = { text: input.text.trim() };
  if (input.tool === "generate") {
    const ds = activeSystem();
    const picked = screens.length ? screens.slice(0, 3) : undefined;
    const platform = input.platform && input.platform !== "auto" ? input.platform : autoPlatform(input.text, picked);
    // No design system: Qalam AI picks the look (a section edit below still uses its screen's).
    const system = useSystems.getState().freeform ? { id: FREEFORM_ID, name: FREEFORM_NAME } : { id: ds.id, name: ds.name };
    Object.assign(request, { lang: input.lang ?? "en", platform, system, screens: picked });
    if (input.replay) Object.assign(request, { replay: true, platform: "mobile", screens: undefined });
    else {
      // Part of a generated screen selected: only that part changes, in place.
      const { doc, selection } = studio();
      const section = selectedSection(doc, selection);
      if (section) {
        const spec = doc.nodes[section.rootId].meta.spec as ScreenSpec;
        const sys = systemFor(doc.nodes[section.rootId].meta.designSystem ?? ds.id);
        Object.assign(request, { section, screens: [{ id: section.rootId, name: section.name }], platform: platformOf(spec), system: { id: sys.id, name: sys.name }, lang: spec.lang ?? "en" });
      } else if (input.plan && !picked) request.plan = true;
    }
  }
  if (input.tool === "audit") request.screens = screens.length ? screens : undefined;
  if (input.tool === "tune") {
    // The system named, else the one the selected screen was built with, else the active one.
    const picked = input.component ? [] : screens.slice(0, 2);
    const ds = input.systemId ? systemFor(input.systemId) : picked.length ? systemFor(dsIdForNode(studio().doc, picked[0].id)) : activeSystem();
    Object.assign(request, { system: { id: ds.id, name: ds.name }, screens: picked.length ? picked : undefined, component: input.component });
  }
  if (input.tool === "generate" || input.tool === "tune") request.connectors = await activeConnectors();
  if (input.tool === "detective") {
    const ds = activeSystem();
    request.system = { id: ds.id, name: ds.name };
    if (input.image) {
      const ref = await putAsset(input.image);
      request.source = { mode: "image", count: 0, image: ref, rebuild: input.rebuild ?? true };
      request.text = request.text || "Screenshot";
    } else {
      const p = parseSource(request.text);
      request.source = { mode: p.mode, count: p.raw.length };
    }
  }
  if (input.tool === "extract") request.source = await extractSource(input.images ?? [], !!input.sample);
  if (input.tool === "component") {
    // A screenshot adds a component; words alone change the one this chat added last.
    const target = input.image ? null : revisable(chatById(get().activeId)?.turns ?? []);
    const ds = systemFor(target?.systemId ?? input.systemId ?? useSystems.getState().activeId);
    request.system = { id: ds.id, name: ds.name };
    if (input.image) request.source = { mode: "image", count: 0, image: await putAsset(input.image) };
    else if (target) request.revise = { turnId: target.turnId, name: target.name };
    else throw new Error("Attach a screenshot of the component to add.");
  }
  if (input.tool === "direction") Object.assign(request, { screens: input.frames, direction: input.direction });
  const chat = ensureChat(input.tool, request);
  const now = Date.now();
  const turn: ChatTurn = { id: nanoid(10), tool: input.tool, at: now, request, status: "running", started: now, tokens: 0 };
  // Plan first: the platform the designer picked stays; on Auto the plan proposes one and asks.
  if (request.plan) turn.plan = { phase: "planning", platformFixed: !!input.platform && input.platform !== "auto" };
  addTurn(chat.id, turn);
  await execute(chat.id, turn.id);
  return { chatId: chat.id, turnId: turn.id };
}

/**
 * Add a finished turn for a tool that runs locally (no model call), so it's part of the chat and
 * of the context later requests see. Add a case for the tool in chatContext.ts's summary too.
 */
export function recordTurn(tool: ChatTool, request: ChatRequest, outcome: ChatOutcome): { chatId: string; turnId: string } {
  const chat = ensureChat(tool, request);
  const now = Date.now();
  const turn: ChatTurn = { id: nanoid(10), tool, at: now, request, status: "done", started: now, tokens: 0, outcome };
  addTurn(chat.id, turn);
  return { chatId: chat.id, turnId: turn.id };
}

/**
 * A running turn for work done outside this module (a Discovery board's draft); the caller patches
 * it as it goes. Pair it with `registerTurnHandlers` so Stop and Try again reach that work.
 */
export function openTurn(tool: ChatTool, request: ChatRequest): { chatId: string; turnId: string } {
  const chat = ensureChat(tool, request);
  const now = Date.now();
  const turn: ChatTurn = { id: nanoid(10), tool, at: now, request, status: "running", started: now, tokens: 0 };
  addTurn(chat.id, turn);
  return { chatId: chat.id, turnId: turn.id };
}

type TurnHandlers = { stop?: (chatId: string, turnId: string) => void; retry?: (chatId: string, turnId: string) => void };
const turnHandlers = new Map<ChatTool, TurnHandlers>();
/** How a tool run elsewhere stops and runs again (see `openTurn`). */
export function registerTurnHandlers(tool: ChatTool, h: TurnHandlers) {
  turnHandlers.set(tool, h);
}

/**
 * Run a turn again with the same request (after an error or a stop). Turns that run in phases
 * (Extract: first look, the designer's answers, then the extraction) continue from their outcome.
 */
export function retry(chatId: string, turnId: string) {
  const t = turnOf(chatId, turnId);
  if (!t || t.status === "running" || t.tool === "critique") return;
  const own = turnHandlers.get(t.tool)?.retry;
  if (own) return own(chatId, turnId);
  const fresh = t.tool === "detective" || t.tool === "generate";
  patchTurn(chatId, turnId, { status: "running", started: Date.now(), tokens: 0, error: undefined, activity: undefined, research: undefined, outcome: fresh ? undefined : t.outcome, ...(t.tool === "generate" ? { sample: undefined } : {}) });
  void execute(chatId, turnId);
}

export function stopTurn(chatId: string, turnId: string) {
  const t = turnOf(chatId, turnId);
  if (t?.tool === "critique") return stopCritique();
  const own = t ? turnHandlers.get(t.tool)?.stop : undefined;
  if (own) return own(chatId, turnId);
  controllers.get(turnId)?.abort();
}

/** The screenshots an extraction reads that are on the canvas. */
function shotNodes(t: ChatTurn): string[] {
  const { doc } = studio();
  return shotsOf(t)
    .map((s) => s.nodeId)
    .filter((n): n is string => !!n && !!doc.nodes[n]);
}

/** Where the System builder's cursor points: the first screenshot it reads. */
function shotTarget(ids: string[]): Box | null {
  if (!ids.length) return null;
  const b = worldBounds(studio().doc, ids[0]);
  return { ...b, h: Math.min(b.h, 160) };
}

async function execute(chatId: string, turnId: string) {
  const t = turnOf(chatId, turnId);
  if (!t) return;
  const ctrl = new AbortController();
  controllers.set(turnId, ctrl);
  // Extraction runs a while with nothing new on the canvas: its agent sits on the screenshots and
  // says what it's doing, and the screenshots are held (dimmed, shimmering, locked) until it's done.
  const shots = t.tool === "extract" ? shotNodes(t) : [];
  const hold = shots.length ? reserve(extractOutcomeOf(t)?.phase === "running" ? "Extracting" : "Reading", [], shots, turnId) : null;
  if (t.tool === "extract") startAgent({ turnId, chatId, kind: "systems", task: chatById(chatId)?.title, activity: "Reading", target: shotTarget(shots) });
  const progress = (tokens: number) => patchTurn(chatId, turnId, { tokens });
  // The research step: each lookup as it happens, then what it found.
  const onEvent = (e: AIEvent) => patchTurn(chatId, turnId, e.type === "activity" ? { activity: e.label } : { research: e.research, activity: undefined });
  try {
    const { ai } = await aiStatus();
    if (t.tool === "generate") await runGenerate(chatId, t, ai, progress, ctrl.signal, onEvent);
    else if (t.tool === "detective") await runDetective(chatId, t, ai, progress, ctrl.signal);
    else if (t.tool === "audit") await runAudit(chatId, t, ai, progress, ctrl.signal);
    else if (t.tool === "direction") await runDirection(t, ai, progress, ctrl.signal, { patch: (p) => patchTurn(chatId, turnId, p) });
    else if (t.tool === "component") {
      const model = await runComponentImport(t, ai, progress, ctrl.signal, { patch: (p) => patchTurn(chatId, turnId, p), context: contextFor(chatId, turnId), turn: (id) => turnOf(chatId, id) });
      if (model) patchTurn(chatId, turnId, { model });
    }
    else if (t.tool === "tune") await runTune(t, ai, progress, ctrl.signal, { patch: (p) => patchTurn(chatId, turnId, p), context: contextFor(chatId, turnId), briefOf: generatedBrief, onEvent, ids: { chatId, turnId } });
    else if (t.tool === "extract")
      await runExtract(t, ai, progress, ctrl.signal, {
        patch: (p) => {
          patchTurn(chatId, turnId, p);
          if (typeof p === "object" && p.activity) narrate(turnId, p.activity);
        },
        current: () => turnOf(chatId, turnId),
        ids: { chatId, turnId },
      });
    patchTurn(chatId, turnId, (cur) => (cur.status === "running" ? { status: "done", activity: undefined } : { activity: undefined }));
  } catch (e) {
    if ((e as Error).name === "AbortError") patchTurn(chatId, turnId, { status: "stopped", activity: undefined });
    else patchTurn(chatId, turnId, { status: "error", activity: undefined, error: e instanceof AIError ? e.message : e instanceof Error ? e.message : String(e) });
  } finally {
    controllers.delete(turnId);
    if (hold) release(hold);
    if (t.tool === "extract") endAgent(turnId);
    // Finished while another chat was open: flag it in the chat list.
    if (get().activeId !== chatId && chatById(chatId)) updateChat(chatId, (c) => ({ ...c, unread: true }));
  }
}

type Progress = (tokens: number) => void;

async function placeGenerated(chatId: string, turnId: string, res: GenerateResult, dsId: string, sample: boolean, model?: string, at?: { x: number; y: number }, extra: Partial<GenerateOutcome> = {}): Promise<string[]> {
  const frameIds = await insertScreens(res.variants, "ai", systemFor(dsId).id, at);
  // Alternatives are takes of one route; what the brief asked to see happen waits for its prototype.
  placeRoute(frameIds, res.interactions, turnOf(chatId, turnId)?.request);
  const outcome: ChatOutcome = { kind: "generate", approach: res.approach, variants: res.variants, offSystem: res.offSystem, frameIds, ...(res.newComponents?.length ? { newComponents: res.newComponents } : {}), ...extra };
  patchTurn(chatId, turnId, { outcome, sample, model, status: "done" });
  // Show the finished screens, unless the designer took the camera elsewhere while they were built.
  if (isFollowing(turnId) || !agentFor(turnId))
    requestAnimationFrame(() => {
      const box = selectionBounds(studio().doc, frameIds);
      if (box) showAboveChat(box);
    });
  return frameIds;
}

/** The self-check: generated screens are checked and what's wrong goes back to the model once. */
async function selfCheck(chatId: string, turnId: string, frameIds: string[], dsId: string, progress: Progress, signal: AbortSignal) {
  patchTurn(chatId, turnId, { status: "running", started: Date.now(), tokens: 0, activity: "Checking the screens and fixing what's off…" });
  const variantsNow = (cur: GenerateOutcome) => frameIds.map((id, i) => (studio().doc.nodes[id]?.meta.spec as ScreenSpec | undefined) ?? cur.variants[i]);
  // Components made for the screens as the repair left them, so adding one to the system adds that version.
  const madeNow = (cur: GenerateOutcome) => {
    const defs = variantsNow(cur).flatMap((v) => v.components ?? []);
    return cur.newComponents ? { newComponents: cur.newComponents.map((d) => defs.find((c) => componentKey(c.name) === componentKey(d.name)) ?? d) } : {};
  };
  try {
    const repair = (await repairScreens(frameIds, dsId, signal, progress)) ?? { found: 0, remaining: 0, changes: [] };
    patchTurn(chatId, turnId, (cur) => (cur.outcome?.kind === "generate" ? { outcome: { ...cur.outcome, repair, variants: variantsNow(cur.outcome), ...madeNow(cur.outcome) }, activity: undefined } : {}));
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    const message = e instanceof AIError ? e.message : e instanceof Error ? e.message : String(e);
    patchTurn(chatId, turnId, (cur) => (cur.outcome?.kind === "generate" ? { outcome: { ...cur.outcome, repair: { found: 0, remaining: 0, changes: [], error: message } }, activity: undefined } : {}));
  }
}

/** Where screen `i` of an answer goes: its reserved box, or further right for extra screens. */
function slotFor(reservationId: string, i: number, fallback: { x: number; y: number }): { x: number; y: number } {
  const boxes = useReservations.getState().list.find((r) => r.id === reservationId)?.boxes;
  if (!boxes?.length) return fallback;
  if (i < boxes.length) return { x: boxes[i].x, y: boxes[i].y };
  // More screens than expected: hold room for them too, so other requests place theirs clear of it.
  const grown = [...boxes];
  while (grown.length <= i) {
    const last = grown[grown.length - 1];
    grown.push({ ...last, x: last.x + last.w + SCREEN_GAP });
  }
  updateReservation(reservationId, { boxes: grown });
  return { x: grown[i].x, y: grown[i].y };
}

const humanize = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

/**
 * Without a design system, the look new screens continue: the selected screens' (when Qalam AI
 * picked it), else the latest one the chat picked before `beforeTurnId`. None: a new look.
 */
export function lookToContinue(chatId: string | undefined, screenIds: string[], beforeTurnId?: string): DesignSystem | undefined {
  const { doc } = studio();
  for (const id of screenIds) {
    const ds = doc.nodes[id] ? getSystem(dsIdForNode(doc, id)) : undefined;
    if (ds?.source === "freeform") return ds;
  }
  const turns = (chatId && chatById(chatId)?.turns) || [];
  const end = beforeTurnId ? turns.findIndex((x) => x.id === beforeTurnId) : turns.length;
  for (let i = (end < 0 ? turns.length : end) - 1; i >= 0; i--) {
    const o = turns[i].outcome;
    const ds = o?.kind === "generate" && o.look ? getSystem(o.look.systemId) : undefined;
    if (ds?.source === "freeform") return ds;
  }
  return undefined;
}

/** The designer's own words a look's brand colour may come from: the brief and their plan answers. */
const lookBrief = (t: ChatTurn) => [t.request.text, ...(t.plan ? (planPayload(t.plan)?.answers.map((a) => a.answer) ?? []) : [])].join("\n");

/** The look is written once the answer has moved past it (the keys after it in the schema). */
const lookWritten = (v: unknown) => !!v && typeof v === "object" && ("newComponents" in v || "variants" in v);

/**
 * Generate: the screens take shape on the canvas while the model writes them (ghosts, see
 * progressive.ts), with Qalam AI's cursor at the element being built. The finished screens are
 * then inserted as one undo step and checked. Stop keeps what had been built.
 */
async function runGenerate(chatId: string, t: ChatTurn, ai: boolean, progress: Progress, signal: AbortSignal, onEvent: (e: AIEvent) => void) {
  // Plan first: read the brief and ask the designer; the screens come once they've answered.
  if (t.request.plan && ai && !t.request.replay && !t.sample) {
    const deps = { patch: (p: Parameters<typeof patchTurn>[2]) => patchTurn(chatId, t.id, p), current: () => turnOf(chatId, t.id), context: contextFor(chatId, t.id), onEvent };
    if (!(await planFirst(t, progress, signal, deps))) return;
    // The designer's answers may have changed the platform.
    t = turnOf(chatId, t.id) ?? t;
    patchTurn(chatId, t.id, { activity: undefined, started: Date.now(), tokens: 0 });
  }
  if (t.request.section) {
    try {
      return await runSectionEdit(t, ai, progress, signal, {
        chatId,
        title: chatById(chatId)?.title ?? "",
        context: contextFor(chatId, t.id),
        onEvent,
        patch: (p) => patchTurn(chatId, t.id, p),
      });
    } finally {
      endAgent(t.id);
    }
  }
  const freeform = t.request.system?.id === FREEFORM_ID;
  let dsId = freeform ? "" : (t.request.system?.id ?? useSystems.getState().activeId);
  const platform = t.request.platform ?? "mobile";
  // No AI configured, a Replays chip, or "Use sample output": the recorded answer, built live.
  const sample = !ai || !!t.request.replay || !!t.sample;
  const { doc } = studio();
  const selected = !sample && t.request.screens?.length ? selectionContext(doc, t.request.screens.map((s) => s.id)) : "";
  // Hold the space the screens will land in; the ghosts fill it as they're written.
  const count = sample ? SAMPLE_GENERATE.variants.length : expectedScreens(t.request, t.plan?.result);
  const slot = reserveScreens("Generating", Array.from({ length: count }, () => frameSize(platform)));
  const first = useReservations.getState().list.find((r) => r.id === slot.id)?.boxes[0];

  startAgent({ turnId: t.id, chatId, kind: "designer", task: chatById(chatId)?.title, activity: "Thinking", target: first ? { ...first, h: 120 } : null });
  beginFollow(t.id, first ? { ...first, h: Math.min(first.h, 320) } : slot.bounds);
  const screenBox = (i: number): Box | undefined => {
    const b = useReservations.getState().list.find((r) => r.id === slot.id)?.boxes[i];
    return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : undefined;
  };
  const stepLine = new Map<number, string>();
  // No design system: the screens are drawn with the look Qalam AI writes before them, or the one they continue.
  const prior = freeform ? lookToContinue(chatId, t.request.screens?.map((x) => x.id) ?? [], t.id) : undefined;
  let look: GenerateOutcome["look"];
  let lookFonts: Promise<unknown> = Promise.resolve();
  const pickLook = (style: unknown) => {
    if (look) return settleLook(look, style);
    if (style == null && prior) look = { systemId: prior.id, name: prior.name, rationale: prior.look?.rationale ?? "", made: false };
    else {
      const l = style == null ? defaultLook(platform) : sanitizeLook(style, { brief: lookBrief(t), platform });
      const ds = lookSystem(l, { platform, projectId: scope.projectId ?? undefined });
      useSystems.getState().add(ds, false);
      look = { systemId: ds.id, name: ds.name, rationale: l.rationale, made: true };
      narrate(t.id, `Look: ${l.name}${l.rationale ? `. ${l.rationale}` : ""}`);
    }
    dsId = look.systemId;
    build.setSystem(dsId);
    lookFonts = ensureSystemFonts(dsId);
  };
  // A retry may write another look: the one this turn made follows the final answer.
  const settleLook = (cur: NonNullable<typeof look>, style: unknown) => {
    const ds = getSystem(cur.systemId);
    if (!cur.made || style == null || !ds?.look) return;
    const l = sanitizeLook(style, { brief: lookBrief(t), platform });
    if (knobHash(l.knobs) === knobHash(ds.look.knobs) && l.name === ds.name) return;
    const next = lookSystem(l, { platform, projectId: ds.projectId, id: ds.id, now: ds.createdAt });
    useSystems.getState().update(ds.id, { name: next.name, tree: next.tree, docs: next.docs, fonts: next.fonts, notes: next.notes, look: next.look });
    look = { ...cur, name: l.name, rationale: l.rationale };
  };
  const build = createProgressiveBuild({
    turnId: t.id,
    dsId,
    platform,
    reservationId: slot.id,
    slotAt: (i) => slotFor(slot.id, i, { x: slot.at.x + i * (frameSize(platform).w + SCREEN_GAP), y: slot.at.y }),
    onApproach: (text, done) => {
      if (!text) return;
      setStep(t.id, "approach", text, !done);
      if (!stepLine.size) narrate(t.id, text);
    },
    onScreen: (i, name, rationale, done) => {
      if (!name) return;
      setStep(t.id, `screen-${i}`, rationale, !done, name);
      const line = rationale ? `${name}: ${rationale}` : name;
      if (stepLine.get(i) !== line) {
        stepLine.set(i, line);
        narrate(t.id, line);
      }
    },
    onCreated: (e, box) => {
      addCreated(t.id, `screen-${e.variant}`, e, box);
      narrate(t.id, `${stepLine.get(e.variant) ?? ""}\nAdding ${humanize(e.name)}…`.trim());
    },
    onTarget: (box, i) => {
      updateAgent(t.id, { target: box, phase: "building", activity: "Building" });
      // With several agents at work, the camera follows the one being followed (top bar).
      followTarget(t.id, box, screenBox(i));
    },
  });

  // Parse what has arrived at most every 100ms; the build paces itself.
  let buffer = "";
  let parseTimer: ReturnType<typeof setTimeout> | undefined;
  const onDelta = (d: AIDelta) => {
    if (d.kind === "reset") {
      buffer = "";
      clearTimeout(parseTimer);
      parseTimer = undefined;
      // The model started over (a retry): keep what's built and swap screens as their new versions finish.
      build.revise();
      if (build.revising) {
        updateAgent(t.id, { activity: "Revising" });
        narrate(t.id, "Reworking the answer so it fits the design system…");
      }
      return;
    }
    if (d.kind !== "json") return appendThought(t.id, d.text);
    buffer += d.text;
    parseTimer ??= setTimeout(() => {
      parseTimer = undefined;
      const value = parsePartial(buffer);
      // Without a design system nothing is drawn until the look is written (the model moved past it).
      if (freeform && !look && lookWritten(value)) pickLook((value as { style?: unknown }).style);
      build.push(freeform && !look ? { ...(value as object), variants: [] } : value);
    }, 100);
  };

  try {
    await Promise.all([ensureYoga(), freeform ? null : ensureSystemFonts(dsId)]);
    let data: GenerateResult;
    let model: string | undefined;
    // What the request sends of the project's knowledge (the system with forget/pin, a small brief), for its trace.
    // Without a design system: only the look the screens continue, if any.
    const know = generateKnowledge(freeform ? (prior ?? null) : systemFor(dsId), doc, t.request.screens?.map((s) => s.id) ?? []);
    if (sample) {
      await replayStream(SAMPLE_GENERATE, { onDelta, onProgress: progress, signal });
      data = SAMPLE_GENERATE;
    } else {
      const references = freeform ? [] : await referenceImages(systemFor(dsId));
      ({ data, model } = await callAI<GenerateResult>(
        "/api/generate",
        {
          prompt: t.request.text,
          lang: t.request.lang ?? "en",
          platform,
          designSystem: know.designSystem,
          freeform: freeform || undefined,
          brief: know.brief,
          context: contextFor(chatId, t.id) || undefined,
          selected: selected || undefined,
          connectors: t.request.connectors,
          references: references.length ? references : undefined,
          plan: t.plan && (t.plan.phase === "ready" || t.plan.phase === "skipped") ? planPayload(t.plan) : undefined,
        },
        progress,
        signal,
        onEvent,
        onDelta,
      ));
    }
    clearTimeout(parseTimer);
    if (freeform) {
      pickLook(data.style);
      await lookFonts;
    }
    // The designer picked (or Auto read) the platform, and the space held for the screens is sized for it.
    // Components made for the screens travel with the screens that place them.
    const made = cleanDefs(data.newComponents, isReservedName);
    const final: GenerateResult = { ...data, newComponents: made, variants: data.variants.map((v) => attachDefs({ ...v, platform }, made)) };
    updateAgent(t.id, { activity: "Finishing" });
    await build.finish(final);
    build.stop();
    const frameIds = await placeGenerated(chatId, t.id, final, dsId, sample, model, slot.at, look ? { look } : {});
    recordTurnDecision({ chatId, turnId: t.id, kind: "generate", entries: know.entries, reliedOn: data.reliedOn, assumed: data.assumed, summary: data.approach, model, sample, produced: { frames: frameIds }, about: t.request.screens?.map((s) => s.id) });
    // After inserting, so the screens never blink out between ghost and real.
    clearGhosts(t.id);
    release(slot.id);
    if (sample) return;
    const firstFrame = studio().doc.nodes[frameIds[0]] ? worldBounds(studio().doc, frameIds[0]) : null;
    updateAgent(t.id, { phase: "checking", activity: "Checking", target: firstFrame ? { ...firstFrame, h: 120 } : null });
    narrate(t.id, "Checking the screens and fixing what's off…");
    await selfCheck(chatId, t.id, frameIds, dsId, progress, signal);
  } catch (e) {
    if ((e as Error).name === "AbortError" && dsId) await keepPartial(chatId, t.id, build.snapshot(), dsId, slot.at, sample, look);
    throw e;
  } finally {
    clearTimeout(parseTimer);
    build.stop();
    clearGhosts(t.id);
    release(slot.id);
    endAgent(t.id);
  }
}

/** Stopped mid-way: what had been built becomes real screens (one undo step), marked unfinished. */
async function keepPartial(chatId: string, turnId: string, specs: ScreenSpec[], dsId: string, at: { x: number; y: number }, sample: boolean, look?: GenerateOutcome["look"]) {
  const cur = turnOf(chatId, turnId);
  if (!specs.length || cur?.outcome?.kind === "generate") return;
  const frameIds = await insertScreens(specs, "ai", systemFor(dsId).id, at);
  const approach = agentFor(turnId)?.steps.find((s) => s.key === "approach")?.text;
  patchTurn(chatId, turnId, { outcome: { kind: "generate", approach, variants: specs, offSystem: [], frameIds, partial: true, ...(look ? { look } : {}) }, sample });
}

/** Sample output for a failed Generate or Detective turn (Generate replays it through the live build). */
export async function applySample(chatId: string, turnId: string) {
  const t = turnOf(chatId, turnId);
  if (!t) return;
  if (t.tool === "generate") {
    patchTurn(chatId, turnId, { status: "running", started: Date.now(), tokens: 0, error: undefined, sample: true, outcome: undefined });
    return execute(chatId, turnId);
  }
  if (t.tool === "detective") acceptDetective(chatId, turnId, SAMPLE_EXTRACT_CSS, true);
  patchTurn(chatId, turnId, { error: undefined });
}

function acceptDetective(chatId: string, turnId: string, res: ExtractResult, sample: boolean, model?: string) {
  const rows: DetectiveRow[] = res.suggestions.map((s, i) => ({ ...s, key: `${i}-${s.sourceId}`, finalName: s.name, decision: undefined }));
  patchTurn(chatId, turnId, { outcome: { kind: "detective", extract: res, rows }, sample, model, status: "done" });
}

async function runDetective(chatId: string, t: ChatTurn, ai: boolean, progress: Progress, signal: AbortSignal) {
  const src = t.request.source;
  // The library suggestions are named for and the rebuild is drawn with.
  const ds = systemFor(t.request.system?.id ?? useSystems.getState().activeId);
  if (src?.mode === "image") {
    if (!ai) throw new Error("Reading a screenshot needs AI. Paste CSS instead, or try the messy CSS sample.");
    const blob = src.image ? await getAssetBlob(src.image) : null;
    if (!blob) throw new Error("The screenshot is no longer available. Attach it again.");
    const img = await prepareImage(blob);
    // The screenshot goes on the left at the width of the screen rebuilt from it, which is on the
    // right; a landscape capture is a web or dashboard page. Both spots shimmer until it's done.
    const screen = frameSize(img.width > img.height ? "web" : "mobile");
    const ref = { w: screen.w, h: Math.round((img.height * screen.w) / img.width) };
    const slot = src.rebuild ? reserveScreens("Rebuilding", [ref, { ...screen, h: Math.max(ref.h, screen.h) }]) : null;
    if (slot) requestAnimationFrame(() => getController()?.zoomToBox(slot.bounds));
    try {
      const { data, model } = await callAI<ExtractResult>(
        "/api/extract",
        { mode: "image", image: { mediaType: img.mediaType, data: img.data, width: img.width, height: img.height }, palette: img.palette, decisions: rememberedNames(), context: contextFor(chatId, t.id) || undefined, designSystem: withKnowledge(systemPayload(ds)) },
        progress,
        signal,
      );
      acceptDetective(chatId, t.id, data, false, model);
      if (data.rebuild && slot) {
        // The screen keeps the screenshot's own pictures: the boxes the model pointed at, cut from the full-size original.
        const rebuilt = await cutCrops(data.rebuild, blob, { x: img.sourceWidth / img.width, y: img.sourceHeight / img.height });
        release(slot.id);
        const ids = await insertScreens([{ ...rebuilt, name: `${rebuilt.name || "Rebuilt screen"} (from screenshot)` }], "import", ds.id, { x: slot.at.x + ref.w + 80, y: slot.at.y });
        insertNodes([makeImage(src.image!, { name: "Screenshot (reference)", x: slot.at.x, y: slot.at.y, w: ref.w, h: ref.h, meta: { source: "import" } })], null, undefined, false);
        patchTurn(chatId, t.id, (cur) => (cur.outcome?.kind === "detective" ? { outcome: { ...cur.outcome, rebuiltId: ids[0] } } : {}));
        requestAnimationFrame(() => getController()?.zoomToFit([ids[0]]));
      }
    } finally {
      if (slot) release(slot.id);
    }
    return;
  }
  const parsed = parseSource(t.request.text);
  if (!ai) return acceptDetective(chatId, t.id, SAMPLE_EXTRACT_CSS, true);
  if (parsed.error) throw new Error(`Couldn't parse that ${parsed.mode === "json" ? "JSON" : "CSS"}: ${parsed.error}`);
  if (!parsed.raw.length) throw new Error("No colours, sizes or fonts found. Paste CSS or a token JSON export, or attach a screenshot.");
  const { data, model } = await callAI<ExtractResult>(
    "/api/extract",
    { mode: parsed.mode, raw: parsed.raw.slice(0, 160), decisions: rememberedNames(), context: contextFor(chatId, t.id) || undefined, designSystem: withKnowledge(systemPayload(ds)) },
    progress,
    signal,
  );
  acceptDetective(chatId, t.id, data, false, model);
}

export function updateDetectiveRows(chatId: string, turnId: string, rows: DetectiveRow[]) {
  patchTurn(chatId, turnId, (t) => (t.outcome?.kind === "detective" ? { outcome: { ...t.outcome, rows } } : {}));
}

/**
 * Add the approved suggestions to the system the Detective read against (a copy, when that's the
 * built-in one), as new tokens. Returns why nothing was added, if nothing was.
 */
export function addDetectiveTokens(chatId: string, turnId: string): string | null {
  const t = turnOf(chatId, turnId);
  if (t?.outcome?.kind !== "detective") return null;
  const approved = t.outcome.rows.filter((r) => r.decision === "approved");
  if (!approved.length) return "Approve some suggestions first.";
  const dsId = getSystem(t.request.system?.id) ? t.request.system!.id : useSystems.getState().activeId;
  let result: ReturnType<typeof addDetectedTokens> | null = null;
  const r = editSystem(dsId, "Detective tokens", (tree) => {
    result = addDetectedTokens(
      tree,
      approved.map((a) => ({ name: a.finalName, type: a.type, value: a.value, intent: a.intent, usage: a.usage, action: a.action })),
    );
    return result.added.length ? { tree: result.tree } : { error: result.skipped.length ? `Nothing new to add: ${result.skipped.map((x) => `${x.name} (${x.reason})`).join("; ")}.` : "Nothing new to add." };
  });
  if ("error" in r) return r.error;
  const res = result as unknown as ReturnType<typeof addDetectedTokens>;
  const target = systemFor(r.id);
  patchTurn(chatId, turnId, (cur) =>
    cur.outcome?.kind === "detective" ? { outcome: { ...cur.outcome, added: { systemId: target.id, systemName: target.name, paths: res.added, skipped: res.skipped } } } : {},
  );
  return null;
}

/**
 * Add a component Qalam AI made to the design system its screens use (a copy, when that's the
 * built-in one). From then on its instances are linked to the system's version, and generations
 * with that system reuse it. Returns why it wasn't added, if it wasn't.
 */
export function adoptComponent(chatId: string, turnId: string, name: string): string | null {
  const t = turnOf(chatId, turnId);
  const o = t?.outcome;
  if (o?.kind !== "generate") return null;
  const def = o.newComponents?.find((d) => componentKey(d.name) === componentKey(name));
  if (!def) return "That component isn't in this answer any more.";
  const { doc } = studio();
  const root = o.frameIds.find((id) => doc.nodes[id]);
  const dsId = root ? dsIdForNode(doc, root) : useSystems.getState().activeId;
  const r = addComponentToSystem(dsId, def);
  if ("error" in r) return r.error;
  const target = systemFor(r.id);
  patchTurn(chatId, turnId, (cur) =>
    cur.outcome?.kind === "generate"
      ? { outcome: { ...cur.outcome, adopted: { ...cur.outcome.adopted, [def.name]: { systemId: target.id, systemName: target.name, ...(target.id !== dsId ? { forkedFrom: dsId } : {}) } } } }
      : {},
  );
  return null;
}

function auditScope(t: ChatTurn): string[] {
  const { doc } = studio();
  const ids = t.request.screens?.map((s) => s.id).filter((id) => doc.nodes[id]);
  return ids?.length ? ids : doc.roots.filter((id) => doc.nodes[id]?.type === "frame");
}

async function runAudit(chatId: string, t: ChatTurn, ai: boolean, progress: Progress, signal: AbortSignal) {
  const scope = auditScope(t);
  const findings = lintNodes(scope);
  patchTurn(chatId, t.id, { outcome: { kind: "audit", scope, findings } });
  if (!ai || !scope.length) return;
  const { doc } = studio();
  const img = nodeToDataURL(scope[0], 1);
  try {
    const { data, model } = await callAI<AuditResult>(
      "/api/audit",
      {
        findings: findings.slice(0, 120).map((f) => ({ id: f.id, nodeId: f.nodeId, nodeName: f.nodeName.slice(0, 80), rule: f.rule, severity: f.severity, message: f.message.slice(0, 400), wcag: f.wcag, replaceWith: f.replaceWith })),
        outline: scope.map((id) => outline(doc, id)).join("\n\n").slice(0, 19500),
        image: img ? img.split(",")[1] : undefined,
        designSystem: systemPayload(systemFor(dsIdForNode(doc, scope[0]))),
        request: t.request.text || undefined,
        context: contextFor(chatId, t.id) || undefined,
      },
      progress,
      signal,
    );
    patchTurn(chatId, t.id, (cur) => (cur.outcome?.kind === "audit" ? { outcome: { ...cur.outcome, ai: data }, model } : {}));
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    // The linter's findings stand on their own.
    patchTurn(chatId, t.id, (cur) => (cur.outcome?.kind === "audit" ? { outcome: { ...cur.outcome, aiError: e instanceof AIError ? e.message : String(e) } } : {}));
  }
}

/** Apply one finding's fix, or every fixable one (one per node and property, most severe first). */
export function fixFindings(chatId: string, turnId: string, only?: Finding) {
  const t = turnOf(chatId, turnId);
  if (t?.outcome?.kind !== "audit") return;
  const o: AuditOutcome = t.outcome;
  const done = new Set<string>();
  studio().beginTx();
  for (const f of only ? [only] : o.findings) {
    if (!f.fix) continue;
    const key = `${f.nodeId}:${f.fix.kind === "stroke-token" ? "stroke" : f.fix.kind === "fill-token" ? "fill" : f.fix.kind}`;
    if (done.has(key)) continue;
    done.add(key);
    applyFix(f);
  }
  studio().commitTx();
  const scope = o.scope.filter((id) => studio().doc.nodes[id]);
  patchTurn(chatId, turnId, { outcome: { ...o, findings: lintNodes(scope) } });
}

// ---------------------------------------------------------------------------
// Critiques run in their card on the canvas; the chat gets a turn that follows each one.

const mirrored = new Map<number, { chatId: string; turnId: string }>();

function critiqueOutcome(s: CritiqueSession): ChatOutcome {
  return {
    kind: "critique",
    startedAt: s.startedAt,
    status: s.status,
    questions: s.transcript.length,
    summary: s.summary,
    verdict: s.goalFit?.verdict ?? null,
    issues: s.issues.length,
    fix: s.fix?.status ?? null,
    fixedIssues: Object.values(s.issueFixes).filter((f) => f.status === "done").length,
  };
}

function mirrorCritique(s: CritiqueSession | null, prev: CritiqueSession | null) {
  if (prev && (!s || s.startedAt !== prev.startedAt)) {
    const m = mirrored.get(prev.startedAt);
    if (m) endAgent(m.turnId);
    if (m) unhold(m.turnId);
    if (m)
      patchTurn(m.chatId, m.turnId, (t) =>
        t.outcome?.kind === "critique" && t.outcome.status !== "done" ? { status: t.status === "running" ? "stopped" : t.status, outcome: { ...t.outcome, status: "closed" } } : {},
      );
  }
  if (!s) return;
  let m = mirrored.get(s.startedAt);
  if (!m) {
    const request: ChatRequest = { text: "", screens: s.screenIds.map((id) => ({ id, name: s.names[id] })) };
    // "Critique again" continues where the last one was; from the chat it continues the open
    // chat; from the canvas it's a session of its own.
    const again = s.after !== undefined ? chatById(mirrored.get(s.after)?.chatId ?? null) : null;
    const chat = again ?? (s.origin === "chat" ? ensureChat("critique", request) : createChat("critique", request));
    const turn: ChatTurn = { id: nanoid(10), tool: "critique", at: s.startedAt, request, status: "running", started: s.startedAt, tokens: 0 };
    addTurn(chat.id, turn);
    m = { chatId: chat.id, turnId: turn.id };
    mirrored.set(s.startedAt, m);
  }
  const fixing = s.fix?.status === "running" ? s.fix : Object.values(s.issueFixes).find((f) => f.status === "running");
  const busy = s.status === "busy" || !!fixing;
  critic(m, s, busy, !!fixing);
  patchTurn(m.chatId, m.turnId, {
    status: busy ? "running" : s.status === "error" ? "error" : "done",
    started: fixing ? fixing.started : s.busySince,
    tokens: fixing ? fixing.tokens : s.tokens,
    error: s.status === "error" ? (s.error ?? undefined) : undefined,
    model: s.model,
    sample: s.sample,
    activity: s.activity,
    research: s.research,
    outcome: critiqueOutcome(s),
  });
}

/** Screens held while the Critic reviews them, by chat turn. Fixes hold their own (critiqueSession.ts). */
const reviewing = new Map<string, string>();

function unhold(turnId: string) {
  const id = reviewing.get(turnId);
  if (id) release(id);
  reviewing.delete(turnId);
}

/**
 * The Critic is on the canvas while it reviews or fixes, its cursor on the first screen, and the
 * screens it reviews are held (dimmed, shimmering, locked) until the turn ends or is stopped.
 * Waiting for an answer, it steps away and lets go of them.
 */
function critic(m: { chatId: string; turnId: string }, s: CritiqueSession, busy: boolean, fixing: boolean) {
  if (busy && !fixing) {
    if (!reviewing.has(m.turnId)) reviewing.set(m.turnId, reserve("Reviewing", [], s.screenIds, CRITIQUE_OWNER));
  } else unhold(m.turnId);
  if (!busy) return endAgent(m.turnId);
  const { doc } = studio();
  const first = s.screenIds.find((id) => doc.nodes[id]);
  const b = first ? worldBounds(doc, first) : null;
  const activity = fixing ? "Fixing" : "Reviewing";
  startAgent({ turnId: m.turnId, chatId: m.chatId, kind: "critic", task: chatById(m.chatId)?.title, claims: CRITIQUE_OWNER, activity, target: b ? { ...b, h: Math.min(b.h, 160) } : null });
  if (agentFor(m.turnId)?.activity !== activity) updateAgent(m.turnId, { activity });
  narrate(m.turnId, s.activity ?? (fixing ? "Fixing what the critique found…" : s.transcript.length ? "Reading your answer…" : "Reviewing the screens against the heuristics…"));
}

/** The critique session a turn follows, if it's still open. */
export function isLiveCritique(t: ChatTurn): boolean {
  const s = useCritique.getState().session;
  return !!s && t.outcome?.kind === "critique" && t.outcome.startedAt === s.startedAt;
}
