import { create } from "zustand";
import type { Doc } from "@/doc/schema";
import { registerDocPass, studio, useStudio } from "@/doc/store";
import { laneOf } from "@/discovery/lane";
import { ostPass } from "@/discovery/pass";
import type { Bearing } from "@/goals/bearings";
import { changeGoal, goalsNow } from "@/goals/client";
import type { GoalTree } from "@/goals/types";
import type { Notice } from "@/hub/checks";
import type { RankedNeed } from "@/hub/needs";
import { ConflictError, orgJson } from "@/org/client";
import { onOrgChange } from "@/org/live";
import { feedback } from "@/commands/feedback";
import { openStores, type IdbStore } from "@/ui/idb";
import { newProject, type Project } from "@/projects/model";
import { announceFromElsewhere, flushAlso } from "@/projects/session";
import { useSources } from "@/ui/discovery/sources";
import { useBriefs } from "@/ui/discovery/briefs";
import { sourcesDb } from "@/discovery/db";
import { allCards } from "@/discovery/tree";
import type { Space } from "@/ui/frame/spaces";
import { keepOtherBoards } from "./arrange";
import { assignBoards, isNewBoard, type Known } from "./assign";
import { composeSpace, isProblemPage, type SpaceDoc } from "./compose";
import { goalsLast, groupsOf, laneRows, layoutSpace } from "./layout";
import { splitSpace } from "./split";
import { addedGoals, sameCards, withContent, withGoals } from "./history";
import { resetSpaceView, useSpaceView, type SpacePreview } from "./view";
import { PLACE_CARD } from "@/business/card";
import { lab } from "@/lab";
import { useBusiness } from "@/org/business";
import { useMarket } from "@/org/market";
import { useOrgContext } from "@/org/context";

/*
 * A space's canvas in this window (the home): its boards loaded, composed into one document the
 * board's editing works on (./compose.ts), laid out after every edit, and saved back to the
 * boards each change touched (./split.ts), all of them in one write. It stays open while this
 * window moves between the space's pages, so coming back keeps the undo history; another space
 * closes it (saving first). Changes made elsewhere come in as they happen: what came from goals.md
 * or another window is composed in again, outside undo, and a board changed both here and there
 * waits for a choice (`useSpaceConflict`).
 */

export interface SpaceInputs {
  tree: GoalTree;
  links: readonly Bearing[];
  needs: readonly RankedNeed[] | null;
  notices: readonly Notice[];
  products: readonly { id: string; name: string }[];
}

interface Stored {
  id: string;
  name: string;
  product: string | null;
  version: string;
  doc: Doc | null;
}

interface Open {
  key: string;
  space: Space;
  stored: Map<string, Stored>;
  /** The canvas as last saved or composed: a save writes what changed since. */
  base: Doc;
  known: Known;
  composed: SpaceDoc;
  inputs: SpaceInputs;
}

/** Boards changed here and elsewhere since they loaded: the save waits until the person chooses. */
export const useSpaceConflict = create<{ boards: { id: string; name: string; doc: Doc | null; version: string }[] }>(() => ({ boards: [] }));

/** What the open canvas is composed from besides its boards (the goals, their problems): read beside a picked card too. */
export const useSpaceInputs = create<{ inputs: SpaceInputs | null }>(() => ({ inputs: null }));

/** Whether the canvas is loading its boards, and why it couldn't. */
export const useSpaceStatus = create<{ key: string | null; loading: boolean; error: string | null }>(() => ({ key: null, loading: false, error: null }));

let open: Open | null = null;
let opening: { key: string; done: Promise<void> } | null = null;
/** The newest inputs that came while the space was opening (the problems' links often do): taken in as it opens. */
let cameOpening: SpaceInputs | null = null;
let unsaved = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve();
/** The document this session last put in the studio (not an edit). */
let quiet: Doc | null = null;
let installed = false;
let laneMemo: { sources: unknown; groups: unknown; rows: Map<string, number> } | null = null;

export const spaceOpen = () => !!open;
export const hasUnsavedSpace = () => unsaved;

/** Open a space's canvas (or take new inputs for the one open). */
export async function openSpace(org: string, space: Space, inputs: SpaceInputs): Promise<void> {
  const key = `${org}:${space ?? "org"}`;
  if (open?.key === key) return setSpaceInputs(inputs);
  if (opening?.key === key) {
    cameOpening = inputs;
    return opening.done;
  }
  cameOpening = null;
  const done = (async () => {
    await closeSpace();
    install();
    useSpaceStatus.setState({ key, loading: true, error: null });
    try {
      const where = `/boards/docs${space ? `?space=${encodeURIComponent(space)}` : ""}`;
      // What this page left unsaved when it last went: saved first, then the boards are read.
      await sendLeft(key);
      const boards = await orgJson<Stored[]>(where);
      const stored = new Map(boards.map((b) => [b.id, b]));
      await fixCopies(stored, inputs);
      open = { key, space, stored, base: studio().doc, known: { boardOf: new Map(), anchors: new Set(), virtual: new Set() }, composed: composeSpace({ tree: inputs.tree, boards: [], space }), inputs };
      useSpaceInputs.setState({ inputs });
      unsaved = false;
      compose({ fresh: true });
      useSpaceStatus.setState({ loading: false });
      if (cameOpening) setSpaceInputs(cameOpening);
      cameOpening = null;
    } catch (e) {
      useSpaceStatus.setState({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  })();
  opening = { key, done };
  await done;
  if (opening?.key === key) opening = null;
}

/** Save what's waiting and let the canvas go (another space opens next). */
export async function closeSpace() {
  if (!open) return;
  await flushSpace();
  open = null;
  resetSpaceView();
  useSpaceInputs.setState({ inputs: null });
  useSpaceConflict.setState({ boards: [] });
}

/** What the canvas takes from its inputs, to tell a real change from the same things loaded again. */
function signOf(i: SpaceInputs): string {
  return JSON.stringify([
    i.tree.goals,
    i.tree.north,
    i.links.map((l) => [l.need, l.goal, l.bears, l.by]),
    (i.needs ?? []).map((n) => [n.topic, n.title, n.products, n.sources, n.quotes, n.newest, n.boards.map((b) => b.board)]),
    i.notices.map((n) => [n.board, n.card, n.other?.board, n.other?.card, n.goal, n.topic]),
    i.products.map((p) => [p.id, p.name]),
  ]);
}

/** The goals, problems and notices the canvas is composed from changed: compose it again. */
export function setSpaceInputs(inputs: SpaceInputs) {
  if (!open) return;
  const was = signOf(open.inputs);
  open.inputs = inputs;
  useSpaceInputs.setState({ inputs });
  if (signOf(inputs) !== was) void recompose();
}

/** Once no gesture is under way (a title being typed, a drag): what comes from elsewhere waits for it. */
function settled(): Promise<void> {
  if (!studio().txBase) return Promise.resolve();
  return new Promise((resolve) => {
    const off = useStudio.subscribe((s) => {
      if (s.txBase) return;
      off();
      // The edit it ends is noticed (and its save scheduled) before what came in is composed.
      setTimeout(resolve, 0);
    });
  });
}

/** Compose again once anything waiting is saved (a change from elsewhere). */
async function recompose() {
  await settled();
  if (unsaved) await flushSpace();
  if (!open || unsaved || useSpaceConflict.getState().boards.length) return;
  compose({ fresh: false });
}

const known = (s: SpaceDoc): Known => ({
  boardOf: s.boardOf,
  anchors: new Set([...s.things].flatMap(([id, t]) => (t.type === "goal" && t.board ? [id] : []))),
  virtual: new Set([...s.virtual].filter((id) => !isProblemPage(id))),
});

/** The canvas composed from the boards as stored and the inputs, put in the studio outside undo. */
function compose(o: { fresh: boolean }) {
  if (!open) return;
  const s = composeSpace({ tree: open.inputs.tree, boards: [...open.stored.values()], space: open.space, links: open.inputs.links, needs: open.inputs.needs, notices: open.inputs.notices, products: open.inputs.products });
  const before = open.base;
  open.composed = s;
  open.known = known(s);
  useSpaceView.setState({
    active: true,
    space: open.space,
    things: s.things,
    boardOf: s.boardOf,
    virtual: s.virtual,
    faint: s.faint,
    fainter: s.fainter,
    tags: s.tags,
    noticed: s.noticed,
    boards: new Map([...open.stored.values()].map((b) => [b.id, { name: b.name, product: b.product }])),
  });
  const doc = laidOut(s.doc);
  open.base = doc;
  quiet = doc;
  const was = studio().doc;
  if (o.fresh) {
    studio().openDoc(doc);
    announceFromElsewhere(studio().doc, was);
    for (const fn of composed) fn(s);
    return;
  }
  // What came from elsewhere goes into each step back too, when the cards are the same ones, or
  // when all that came is goals with no board yet (a goal accepted under another); when cards
  // came or went elsewhere otherwise, the steps back would undo that, so they go.
  const { past, future, selection } = useStudio.getState();
  const same = sameCards(before, doc);
  const goals = same ? null : addedGoals(before, doc, s);
  const keep = (d: Doc) => (same ? withContent(d, doc, before) : goals ? unlaidStep(withGoals(d, doc, goals, before)) : d);
  const kept = same || !!goals;
  useStudio.setState({ doc, past: kept ? past.map(keep) : [], future: kept ? future.map(keep) : [], selection: selection.filter((id) => !!doc.nodes[id]) });
  announceFromElsewhere(doc, was);
  for (const fn of composed) fn(s);
}

const composed = new Set<(s: SpaceDoc) => void>();
/** Hear each time the canvas is composed (opened, or what came from elsewhere put in). */
export function onSpaceComposed(fn: (s: SpaceDoc) => void): () => void {
  composed.add(fn);
  return () => composed.delete(fn);
}

/** Steps back given a goal from elsewhere (by their nodes, which undo keeps): laid out when undo or redo brings one back. */
const unlaid = new WeakSet<object>();
const unlaidStep = (d: Doc) => (unlaid.add(d.nodes), d);

// ---------------------------------------------------------------------------
// Layout: worked out after every edit, never saved.

const isGoalCard = (id: string) => useSpaceView.getState().things.get(id)?.type === "goal";
const inColumn = (id: string) => id.startsWith("topic:none:");

/** Each goal's lane rows: worked out from the canvas and the space's sources. */
function rowsFor(doc: Doc) {
  const groups = groupsOf(doc, isGoalCard);
  const sources = useSources.getState().list;
  const rows = laneMemo && laneMemo.sources === sources && sameGroups(laneMemo.groups as typeof groups, groups) ? laneMemo.rows : laneRows(laneOf(doc, sources, groups).items);
  laneMemo = { sources, groups, rows };
  return { groups, rows };
}
const sameGroups = (a: { head: string; cards: string[] }[], b: { head: string; cards: string[] }[]) => a.length === b.length && a.every((g, i) => g.head === b[i].head && g.cards.join() === b[i].cards.join());

/** The Business card over the trees, while the consultant is built (src/lab.ts). */
const placeOption = () => (lab("consult") ? { place: PLACE_CARD } : {});

/** The cards with a brief, whose tiles the layout makes room for. */
const briefCards = () => new Set(useBriefs.getState().list.map((b) => b.card));

function laidOut(doc: Doc): Doc {
  const lanes = useStudio.getState().view.sources;
  const { groups, rows } = lanes ? rowsFor(doc) : { groups: groupsOf(doc, isGoalCard), rows: undefined };
  const { doc: laid, slots } = layoutSpace(doc, { column: inColumn, isGoal: isGoalCard, lanes: rows, ...(lanes ? { briefs: briefCards() } : {}), ...placeOption() });
  useSpaceView.setState({ groups, slots });
  return laid;
}

/**
 * The canvas laid out as an edit would lay it out, telling nothing (a review's ghost: drawn where
 * accepting puts it, lanes and all).
 */
export function previewLayout(doc: Doc, goals: ReadonlySet<string> = new Set()): SpacePreview {
  // A goal proposed under a goal is laid out as the goal it would be.
  const isGoal = (id: string) => isGoalCard(id) || goals.has(id);
  const next = goalsLast(doc, isGoal);
  const groups = groupsOf(next, isGoal);
  // Its own lane rows (the canvas's are remembered for the canvas as it is).
  const rows = useStudio.getState().view.sources ? laneRows(laneOf(next, useSources.getState().list, groups).items) : undefined;
  const { doc: laid, slots } = layoutSpace(next, { column: inColumn, isGoal, lanes: rows, ...(rows ? { briefs: briefCards() } : {}), ...placeOption() });
  return { doc: laid, groups, slots };
}

/** After every edit on the canvas, in the same undo step: another board's cards kept, everything laid out. */
function spacePass(prev: Doc, next: Doc): Doc {
  if (!open || !useSpaceView.getState().active) return next;
  const kept = keepOtherBoards(prev, next, (id) => open?.known.boardOf.get(id) ?? (open?.known.virtual.has(id) ? `new:${id}` : undefined));
  return laidOut(goalsLast(kept, isGoalCard));
}

/** Again when the lane's sources change or the lane is switched (its columns). */
export function relayoutSpace() {
  if (!open) return;
  const doc = studio().doc;
  const laid = laidOut(doc);
  if (laid === doc) return;
  quiet = laid;
  if (doc === open.base) open.base = laid;
  useStudio.setState({ doc: laid });
}

function install() {
  if (installed) return;
  installed = true;
  // Leaving the page (a link, Design this) saves the canvas first, as a board's page did.
  flushAlso(() => flushSpace());
  registerDocPass(ostPass);
  registerDocPass(spacePass);
  // An edit settles when its transaction does (a title typed letter by letter is one edit).
  let last = studio().doc;
  useStudio.subscribe((s) => {
    if (!open || s.doc === last || s.txBase) return;
    last = s.doc;
    if (s.doc === quiet) {
      quiet = null;
      return;
    }
    unsaved = true;
    clearTimeout(timer);
    timer = setTimeout(() => void flushSpace(), 400);
    // A step back that was given a goal from elsewhere, brought back: laid out as the canvas is.
    if (unlaid.has(s.doc.nodes)) queueMicrotask(relayoutSpace);
  });
  useStudio.subscribe((s, prev) => s.view.sources !== prev.view.sources && relayoutSpace());
  useSources.subscribe((s, prev) => s.list !== prev.list && relayoutSpace());
  useBriefs.subscribe((s, prev) => s.list !== prev.list && relayoutSpace());
  // The Business card says what the business page, the market and the About say: drawn again when one changes.
  useBusiness.subscribe((s, prev) => s.business !== prev.business && studio().invalidate());
  useMarket.subscribe((s, prev) => s.market !== prev.market && studio().invalidate());
  useOrgContext.subscribe((s, prev) => s.about !== prev.about && studio().invalidate());
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && void flushSpace());
  window.addEventListener("pagehide", () => {
    keepLeft();
    void flushSpace({ leaving: true });
  });
  // Boards changed elsewhere (another window, the folder): load them again.
  onOrgChange((c) => {
    if (!open || c.kind !== "project") return;
    if (open.stored.has(c.id) || !c.removed) void reloadBoards(c.id);
  });
}

// ---------------------------------------------------------------------------
// Saving

/** Save the canvas's changes now (before leaving, or once edits settle). */
export function flushSpace(o: { force?: boolean; skip?: ReadonlySet<string>; leaving?: boolean } = {}): Promise<void> {
  clearTimeout(timer);
  saving = saving.then(() => saveOnce(o)).catch(() => {});
  return saving;
}

type SaveBody = { writes: { id: string; doc: Doc; ifMatch: string; patch: Record<string, unknown> }[]; create: { record: Project; doc: Doc }[] };

/** What a save would send now: each board's new document, and the boards to make. */
function planSave(s: Open, o: { force?: boolean; skip?: ReadonlySet<string> }) {
  const now = studio().doc;
  const before = assignBoards(s.base, s.known);
  const after = assignBoards(now, s.known);
  const stored = new Map([...s.stored].flatMap(([id, b]) => (b.doc ? [[id, b.doc] as const] : [])));
  const r = splitSpace({ base: s.base, now, before, after, stored, anchors: s.known.anchors, virtual: s.known.virtual });
  // Boards whose edits here are being given up for another window's.
  for (const id of o.skip ?? []) r.writes.delete(id);
  const tree = goalsNow();
  const made = new Map<string, Project>();
  for (const c of r.create) {
    const goal = c.goal ? tree.goals.find((g) => g.id === c.goal) : undefined;
    const top = c.doc.nodes[c.doc.roots[0]]?.meta.ost?.title.trim();
    made.set(c.key, newProject("discovery", (goal?.title ?? top ?? "").slice(0, 80) || "Untitled board", { product: goal ? goal.product : s.space, discovery: { v: 1, stage: "ready" } }));
  }
  const conflicts = useSpaceConflict.getState().boards;
  const body: SaveBody = {
    writes: [...r.writes].map(([id, doc]) => ({ id, doc, ifMatch: o.force && conflicts.some((c) => c.id === id) ? conflicts.find((c) => c.id === id)!.version : s.stored.get(id)!.version, patch: { updatedAt: Date.now() } })),
    create: r.create.map((c) => ({ record: made.get(c.key)!, doc: c.doc })),
  };
  // Goals whose boards this starts: each works on its board once it's made.
  const goals = r.create.flatMap((c) => (c.goal ? [{ goal: c.goal, board: made.get(c.key)!.id }] : []));
  return { now, after, r, made, body, goals };
}

async function saveOnce(o: { force?: boolean; skip?: ReadonlySet<string>; leaving?: boolean }) {
  if (!open || !unsaved) return;
  if (useSpaceConflict.getState().boards.length && !o.force && !o.skip) return;
  const s = open;
  const { now, after, r, made, body, goals } = planSave(s, o);
  unsaved = false;
  if (!r.writes.size && !r.create.length) {
    s.base = now;
    s.known = { ...s.known, boardOf: realBoards(after) };
    return;
  }
  try {
    // The page going: a small save may outlive it (the rest waits in the outbox).
    const keepalive = !!o.leaving && JSON.stringify(body).length < 60_000;
    const res = await orgJson<{ versions: Record<string, string> }>("/boards/docs", { method: "PUT", json: body, keepalive });
    if (o.force) useSpaceConflict.setState({ boards: [] });
    for (const [id, doc] of r.writes) s.stored.set(id, { ...s.stored.get(id)!, doc, version: res.versions[id] ?? s.stored.get(id)!.version });
    const boards = new Map(after);
    for (const c of r.create) {
      const p = made.get(c.key)!;
      s.stored.set(p.id, { id: p.id, name: p.name, product: p.product ?? null, version: res.versions[p.id] ?? "", doc: c.doc });
      for (const [id, k] of after) if (k === c.key) boards.set(id, p.id);
    }
    if (s === open) {
      s.base = now;
      const virtual = new Set(s.known.virtual);
      const anchors = new Set(s.known.anchors);
      for (const c of r.create) if (c.goal) {
        virtual.delete(c.goal);
        anchors.add(c.goal);
      }
      s.known = { boardOf: realBoards(boards), anchors, virtual };
      const v = useSpaceView.getState();
      useSpaceView.setState({ boardOf: s.known.boardOf, virtual: new Set([...v.virtual].filter((id) => !r.create.some((c) => c.goal === id))), boards: new Map([...s.stored.values()].map((b) => [b.id, { name: b.name, product: b.product }])) });
    }
    void outbox()?.remove(outKey(s.key)).catch(() => {});
    // A goal whose board just started works on it: its card is the board's outcome.
    for (const g of goals) await changeGoal(g.goal, { on: { board: g.board, card: g.goal } }).catch(() => {});
    // The sources its cards rest on list the board (src/discovery/sources.ts: a source lists the boards that use it).
    await linkSources([...r.writes, ...r.create.map((c) => [made.get(c.key)!.id, c.doc] as const)]);
  } catch (e) {
    unsaved = true;
    if (e instanceof ConflictError && Array.isArray(e.current)) {
      const list = e.current as { id: string; version: string; doc: Doc | null }[];
      useSpaceConflict.setState({ boards: list.map((c) => ({ ...c, name: s.stored.get(c.id)?.name ?? "A board" })) });
    }
  }
}

async function linkSources(boards: Iterable<readonly [string, Doc]>) {
  const list = useSources.getState().list;
  for (const [board, doc] of boards) {
    const cited = new Set(allCards(doc).flatMap(({ card }) => card.evidence.flatMap((e) => (e.sourceId ? [e.sourceId] : []))));
    for (const id of cited) {
      const src = list.find((x) => x.id === id);
      if (src && !(src.boards ?? []).includes(board)) await sourcesDb.link(id, board, true).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// The outbox: the page can close before its last save reaches the folder. What it would save is
// kept in the browser as the page goes, and saved the next time this space opens here.

interface Left {
  body: SaveBody;
  goals: { goal: string; board: string }[];
  at: number;
}

// One connection, opened as the space opens: a page that's going has no time to open one.
let box: IdbStore | null = null;
const outbox = () => (typeof indexedDB === "undefined" ? null : (box ??= openStores("qalam-outbox", 1, ["docs"])("docs")));
const outKey = (key: string) => `space:${key}`;

/** The page is going with edits not saved yet: keep what the save would send. */
function keepLeft() {
  if (!open || !unsaved) return;
  const { r, body, goals } = planSave(open, {});
  if (r.writes.size || r.create.length) void outbox()?.put(outKey(open.key), { body, goals, at: Date.now() } satisfies Left);
}

/**
 * Edits kept when the page last went here, saved now. A board changed elsewhere since keeps the
 * other version (unless it already holds these edits: the save had reached it), and says so.
 */
async function sendLeft(key: string): Promise<boolean> {
  const left = await outbox()?.get<Left>(outKey(key)).catch(() => undefined);
  if (!left) return false;
  void outbox()?.remove(outKey(key)).catch(() => {});
  try {
    await orgJson("/boards/docs", { method: "PUT", json: left.body });
    for (const g of left.goals) await changeGoal(g.goal, { on: { board: g.board, card: g.goal } }).catch(() => {});
    return true;
  } catch (e) {
    if (!(e instanceof ConflictError) || !Array.isArray(e.current)) return false;
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const lost = (e.current as { id: string; doc: Doc | null }[]).filter((c) => !same(c.doc, left.body.writes.find((w) => w.id === c.id)?.doc));
    if (lost.length) feedback("Edits from before the page reloaded weren't saved: those boards changed elsewhere since", { kind: "error", id: "space.outbox" });
    return false;
  }
}

/** Real boards only: the new ones' keys are dropped until they're made. */
const realBoards = (m: ReadonlyMap<string, string>) => new Map([...m].filter(([, b]) => !isNewBoard(b)));

/**
 * Boards changed both here and elsewhere: keep this window's (written over theirs), or take
 * theirs (this window's edits to the other boards are saved first, its edits to these dropped).
 */
export async function resolveSpaceConflict(take: "mine" | "theirs") {
  if (!open) return;
  if (take === "mine") return flushSpace({ force: true });
  const { boards } = useSpaceConflict.getState();
  // This window's edits to the other boards go in first; then the other window's boards come in.
  await flushSpace({ skip: new Set(boards.map((b) => b.id)) });
  if (!open) return;
  for (const c of boards) open.stored.set(c.id, { ...open.stored.get(c.id)!, doc: c.doc, version: c.version });
  useSpaceConflict.setState({ boards: [] });
  unsaved = false;
  compose({ fresh: false });
}

/** A board changed elsewhere: once what's waiting here is saved, load the space's boards again and compose what changed in. */
async function reloadBoards(_id: string) {
  if (!open) return;
  const s = open;
  await settled();
  // A save here meanwhile that it changed too stops at a conflict (the person chooses).
  if (unsaved) await flushSpace();
  if (s !== open || useSpaceConflict.getState().boards.length) return;
  const boards = await orgJson<Stored[]>(`/boards/docs${s.space ? `?space=${encodeURIComponent(s.space)}` : ""}`).catch(() => null);
  if (!boards || s !== open) return;
  // Edited again meanwhile: try once that's saved.
  if (unsaved || studio().txBase) return void setTimeout(() => void reloadBoards(_id), 500);
  const changed = boards.filter((b) => s.stored.get(b.id)?.version !== b.version);
  const gone = [...s.stored.keys()].filter((id) => !boards.some((b) => b.id === id));
  if (!changed.length && !gone.length) return;
  for (const b of changed) s.stored.set(b.id, b);
  for (const id of gone) s.stored.delete(id);
  compose({ fresh: false });
}

/**
 * Boards that had another board's card ids (a copy saved before copies got new ids) are saved
 * once with ids of their own, and a goal working on one of those cards moves with it.
 */
async function fixCopies(stored: Map<string, Stored>, inputs: SpaceInputs) {
  const s = composeSpace({ tree: inputs.tree, boards: [...stored.values()], space: null });
  if (!s.fixes.size) return;
  const writes = [...s.fixes].map(([id, f]) => ({ id, doc: f.doc, ifMatch: stored.get(id)!.version }));
  const res = await orgJson<{ versions: Record<string, string> }>("/boards/docs", { method: "PUT", json: { writes, create: [] } }).catch(() => null);
  if (!res) return;
  for (const [id, f] of s.fixes) {
    stored.set(id, { ...stored.get(id)!, doc: f.doc, version: res.versions[id] ?? stored.get(id)!.version });
    for (const g of inputs.tree.goals) if (g.on?.board === id && f.ids.has(g.on.card)) await changeGoal(g.id, { on: { board: id, card: f.ids.get(g.on.card)! } }).catch(() => {});
  }
}

/** For tests and the dev tools: what the canvas would save now. */
export function pendingSpaceSave() {
  if (!open) return null;
  const now = studio().doc;
  return splitSpace({ base: open.base, now, before: assignBoards(open.base, open.known), after: assignBoards(now, open.known), stored: new Map([...open.stored].flatMap(([id, b]) => (b.doc ? [[id, b.doc] as const] : []))), anchors: open.known.anchors, virtual: open.known.virtual });
}

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __space: unknown }).__space = { pending: pendingSpaceSave, unsaved: hasUnsavedSpace, open: spaceOpen, flush: flushSpace, view: () => useSpaceView.getState() };
}
