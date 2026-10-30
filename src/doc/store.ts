import { create } from "zustand";
import { produce, setAutoFreeze } from "immer";
import type { Doc } from "./schema";
import { emptyDoc } from "./schema";
import { BUILTIN } from "@/design-system/resolve";
import { putAsset } from "./assets";
import { normalizeBrief } from "./brief";
import { normalizeControls } from "@/knowledge/controls";
import { relayoutAll, relayoutDoc } from "./autolayout";
import { fitGroups } from "./group-fit";
import { busyIds, isBusy, useReservations } from "./reservations";
import { isOnPage, normalizePages } from "./pages";

// Docs are replaced wholesale on every edit and never mutated outside immer.
setAutoFreeze(false);

export type Tool =
  | "select" | "hand" | "scale"
  | "frame"
  | "rect" | "ellipse" | "line" | "arrow" | "polygon" | "star"
  | "pen" | "pencil"
  | "text"
  // Discovery projects: an opportunity-tree card, a sticky note.
  | "card" | "sticky";

/**
 * A pass over the document after every edit's layout, in the same undo step: (doc before the
 * edit, doc after it) → the doc to keep, the same object when there's nothing to do. A project
 * mode registers its own at boot (Discovery lays out its trees), so other projects pay nothing.
 */
export type DocPass = (prev: Doc, next: Doc) => Doc;
const docPasses: DocPass[] = [];
export function registerDocPass(pass: DocPass): () => void {
  if (!docPasses.includes(pass)) docPasses.push(pass);
  return () => {
    const i = docPasses.indexOf(pass);
    if (i >= 0) docPasses.splice(i, 1);
  };
}
const runDocPasses = (prev: Doc, next: Doc): Doc => docPasses.reduce((d, pass) => pass(prev, d), next);

export interface Camera {
  /** World coordinate at the screen's top-left. */
  x: number;
  y: number;
  zoom: number;
}

export type AITab = "generate" | "import" | "audit" | "critique" | "direction" | "tune" | "extract" | "component";
/** Figma's View menu toggles (drawn by the renderer and the shell; flipped by commands). */
export interface ViewOptions {
  /** ⌘\: hide every panel, canvas only. */
  uiHidden: boolean;
  rulers: boolean;
  outlines: boolean;
  pixelGrid: boolean;
  /** ⌃P: draw the canvas at 1× and scale it up, so designs show their real pixels. */
  pixelPreview: boolean;
  snapToPixels: boolean;
  layoutGrids: boolean;
  /** Qalam AI agents' cursors on the canvas (Figma's multiplayer cursors). */
  agentCursors: boolean;
  /** Screens' prototype parts on the canvas: their sheets, dialogs and bars, and the wires to them. */
  routeParts: boolean;
  /** A Discovery board's sources lane: the sources its cards rest on, wired to them. */
  sources: boolean;
}

const VIEW_KEY = "qalam/view";
const DEFAULT_VIEW: ViewOptions = { uiHidden: false, rulers: false, outlines: false, pixelGrid: true, pixelPreview: false, snapToPixels: true, layoutGrids: true, agentCursors: true, routeParts: true, sources: true };

/** View options persist per browser like Figma's, except hiding the UI (a fresh load always shows it). */
function loadView(): ViewOptions {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(VIEW_KEY) : null;
    return { ...DEFAULT_VIEW, ...(raw ? (JSON.parse(raw) as Partial<ViewOptions>) : {}), uiHidden: false };
  } catch {
    return DEFAULT_VIEW;
  }
}

/** Panels in the left icon rail (Sources: a Discovery board's only). The right side is always the Design panel. */
export type LeftTab = "layers" | "components" | "tokens" | "knowledge" | "sources";

export interface StudioState {
  doc: Doc;
  past: Doc[];
  future: Doc[];
  txBase: Doc | null;
  selection: string[];
  hoverId: string | null;
  tool: Tool;
  camera: Camera;
  editingTextId: string | null;
  aiTab: AITab;
  /** The floating Qalam AI chat window over the canvas. */
  chatOpen: boolean;
  /** Bumped when something asks for the cursor in the chat's composer ("/"), even with the chat already open. */
  chatFocus: number;
  leftTab: LeftTab;
  /** The left panel can be collapsed to the icon rail. */
  leftOpen: boolean;
  /** Bumps when something outside the doc (fonts, images) needs a redraw. */
  renderTick: number;
  /** View options (Figma's View menu). */
  view: ViewOptions;
  setView: (patch: Partial<ViewOptions>) => void;
  /** A layer whose name is being edited in the Layers panel (⌘R). */
  renamingId: string | null;
  setRenaming: (id: string | null) => void;

  mutate: (recipe: (d: Doc) => void, opts?: { history?: boolean }) => void;
  replaceDoc: (doc: Doc) => void;
  /** Open a document file: replaces the doc and its history. */
  openDoc: (doc: Doc) => void;
  beginTx: () => void;
  commitTx: () => void;
  cancelTx: () => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[]) => void;
  setHover: (id: string | null) => void;
  setTool: (tool: Tool) => void;
  setCamera: (cam: Camera) => void;
  setEditingText: (id: string | null) => void;
  /** Pick an AI tool and open the chat window on it. */
  setAITab: (t: AITab) => void;
  setChatOpen: (open: boolean) => void;
  toggleChat: () => void;
  /** Open the chat and put the cursor in its composer. */
  focusChat: () => void;
  /** Show a left panel (opening it if collapsed). */
  setLeftTab: (t: LeftTab) => void;
  /** Rail click: open that panel, or collapse it if it is already showing. */
  toggleLeftTab: (t: LeftTab) => void;
  setLeftOpen: (open: boolean) => void;
  invalidate: () => void;
}

const HISTORY_LIMIT = 200;
/** Older documents stored only a shadow token; shadows are now materialized as effects. */
function migrate(d: Doc): Doc {
  for (const n of Object.values(d.nodes)) {
    if (n.shadowToken && !n.effects) {
      const layers = BUILTIN.shadowLayers(n.shadowToken);
      if (layers?.length) n.effects = layers;
    }
  }
  const brief = normalizeBrief(d.brief);
  if (brief) d.brief = brief;
  else delete d.brief;
  const knowledge = normalizeControls(d.knowledge);
  if (knowledge) d.knowledge = knowledge;
  else delete d.knowledge;
  return normalizePages(d);
}

/** Selection keeps to the page showing (ids not in the document yet are left to the caller). */
const onPage = (doc: Doc, ids: string[]) => (doc.pages?.length || doc.page ? ids.filter((id) => !doc.nodes[id] || isOnPage(doc, id)) : ids);

/**
 * The Knowledge hub (doc.brief, and what the designer told Qalam AI to forget or pin) is not part
 * of undo history: whenever a snapshot replaces the live doc, it keeps the current knowledge, so
 * undoing a canvas edit never loses answers or brings a forgotten fact back.
 */
const carryKnowledge = (target: Doc, current: Doc): Doc =>
  target.brief === current.brief && target.knowledge === current.knowledge ? target : { ...target, brief: current.brief, knowledge: current.knowledge };

export const useStudio = create<StudioState>((set, get) => ({
  // A project opens its document (src/projects/session.ts); until then the canvas is empty.
  doc: emptyDoc(),
  past: [],
  future: [],
  txBase: null,
  selection: [],
  hoverId: null,
  tool: "select",
  camera: { x: -80, y: -80, zoom: 1 },
  editingTextId: null,
  aiTab: "generate",
  chatOpen: false,
  chatFocus: 0,
  leftTab: "layers",
  leftOpen: true,
  renderTick: 0,
  view: loadView(),
  renamingId: null,

  mutate: (recipe, opts) => {
    const { doc, txBase, past } = get();
    // Auto layout reflows whatever the edit touched, in the same undo step; groups hug their
    // children before and after it (a group's size feeds the flow; the flow resizes what's inside).
    const edited = fitGroups(doc, produce(doc, recipe), txBase);
    const laid = relayoutDoc(doc, edited);
    const next = runDocPasses(doc, laid === edited ? laid : fitGroups(edited, laid, txBase));
    if (next === doc) return;
    if (txBase || opts?.history === false) {
      set({ doc: next });
      return;
    }
    set({ doc: next, past: [...past, doc].slice(-HISTORY_LIMIT), future: [] });
  },

  replaceDoc: (doc) => {
    const { past } = get();
    set({ doc: carryKnowledge(runDocPasses(get().doc, relayoutDoc(get().doc, doc)), get().doc), past: [...past, get().doc].slice(-HISTORY_LIMIT), future: [], selection: [] });
  },
  openDoc: (doc) => set({ doc: runDocPasses(emptyDoc(), relayoutAll(migrate(doc))), past: [], future: [], txBase: null, selection: [], editingTextId: null }),

  beginTx: () => {
    if (!get().txBase) set({ txBase: get().doc });
  },
  commitTx: () => {
    const { txBase, doc, past } = get();
    if (!txBase) return;
    if (txBase === doc) set({ txBase: null });
    else set({ txBase: null, past: [...past, txBase].slice(-HISTORY_LIMIT), future: [] });
  },
  cancelTx: () => {
    const { txBase } = get();
    if (txBase) set({ doc: carryKnowledge(txBase, get().doc), txBase: null });
  },

  undo: () => {
    const { past, future, doc, selection } = get();
    if (!past.length) return;
    const prev = carryKnowledge(past[past.length - 1], doc);
    set({
      doc: prev,
      past: past.slice(0, -1),
      future: [doc, ...future],
      selection: onPage(prev, selection.filter((id) => prev.nodes[id])),
      editingTextId: null,
    });
  },
  redo: () => {
    const { past, future, doc, selection } = get();
    if (!future.length) return;
    const next = carryKnowledge(future[0], doc);
    set({
      doc: next,
      past: [...past, doc],
      future: future.slice(1),
      selection: onPage(next, selection.filter((id) => next.nodes[id])),
      editingTextId: null,
    });
  },

  // Layers AI is working on can't be selected (see reservations.ts).
  select: (ids) => {
    const busy = busyIds();
    const here = onPage(get().doc, ids);
    set({ selection: busy.size ? here.filter((id) => !isBusy(get().doc, id, busy)) : here });
  },
  setHover: (id) => {
    if (get().hoverId !== id) set({ hoverId: id });
  },
  setTool: (tool) => set({ tool }),
  setCamera: (camera) => set({ camera }),
  setEditingText: (id) => set({ editingTextId: id }),
  setAITab: (aiTab) => set({ aiTab, chatOpen: true }),
  setChatOpen: (chatOpen) => set({ chatOpen }),
  toggleChat: () => set({ chatOpen: !get().chatOpen }),
  focusChat: () => set({ chatOpen: true, chatFocus: get().chatFocus + 1 }),
  setLeftTab: (leftTab) => set({ leftTab, leftOpen: true }),
  toggleLeftTab: (leftTab) => set(get().leftOpen && get().leftTab === leftTab ? { leftOpen: false } : { leftTab, leftOpen: true }),
  setLeftOpen: (leftOpen) => set({ leftOpen }),
  invalidate: () => set({ renderTick: get().renderTick + 1 }),
  setView: (patch) => {
    const view = { ...get().view, ...patch };
    set({ view });
    try {
      window.localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch {
      /* storage unavailable: options last for this session */
    }
  },
  setRenaming: (renamingId) => set({ renamingId }),
}));

export const studio = () => useStudio.getState();

/** Move images stored inline as data URLs into the asset store (they bloat the saved document). */
export function moveInlineImages() {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return;
  const inline = Object.values(useStudio.getState().doc.nodes).filter((n) => n.type === "image" && n.src.startsWith("data:"));
  if (!inline.length) return;
  void Promise.all(
    inline.map(async (n) => {
      const blob = await (await fetch((n as { src: string }).src)).blob();
      return [n.id, await putAsset(blob)] as const;
    }),
  )
    .then((pairs) =>
      useStudio.getState().mutate(
        (d) => {
          for (const [id, src] of pairs) {
            const n = d.nodes[id];
            if (n?.type === "image") n.src = src;
          }
        },
        { history: false },
      ),
    )
    .catch(() => {
      /* leave inline images as they are */
    });
}

// AI started working on layers in place: let go of them (selection, hover, text editing) until it's done.
useReservations.subscribe((r, prev) => {
  if (r.list === prev.list) return;
  const busy = busyIds();
  if (!busy.size) return;
  const s = useStudio.getState();
  const held = (id: string | null) => !!id && isBusy(s.doc, id, busy);
  if (s.selection.some((id) => held(id))) s.select(s.selection);
  if (held(s.hoverId)) s.setHover(null);
  if (held(s.editingTextId)) s.setEditingText(null);
});

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __studio: typeof useStudio }).__studio = useStudio;
}
