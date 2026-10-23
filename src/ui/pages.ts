/**
 * Pages in the studio: showing another page, page edits as undo steps, a camera per page, and
 * bringing a layer on another page into view. The model is in doc/pages.ts; showing a page is
 * not an edit (no history), but undoing an edit made on another page shows that page again.
 */
import { studio, useStudio, type Camera } from "@/doc/store";
import {
  activePage,
  addPage,
  canDeletePage,
  COMPONENTS_PAGE,
  deletePage,
  moveToPage,
  pageName,
  pageOf,
  pagesOf,
  renamePage,
  reorderPage,
  screensPage,
  switchPage,
} from "@/doc/pages";
import { useReservations } from "@/doc/reservations";
import { boxesIntersect, worldBounds } from "@/doc/geometry";
import type { Doc } from "@/doc/schema";
import { useGhosts } from "@/doc/ghosts";
import { useVectorEdit } from "@/engine/vector-state";
import { feedback } from "@/commands/feedback";
import { usePrototypeMode } from "./prototype/store";
import { glideToLayer, onCanvasReady } from "./discovery/canvas";

/** Why the page can't change right now, or null. */
export function pageSwitchBlocked(): string | null {
  const s = studio();
  if (s.txBase) return "Finish what you're doing on the canvas first";
  if (s.editingTextId) return "Finish editing the text first";
  if (useVectorEdit.getState().nodeId) return "Leave vector editing first";
  if (usePrototypeMode.getState().open) return "Close the prototype first";
  // AI work lands on the page showing when it finishes.
  if (useReservations.getState().list.length || useGhosts.getState().list.length) return "Qalam AI is working on this page: wait until it's done";
  return null;
}

/** Show a page. False (with a toast saying why) when it can't change now. */
export function goToPage(id: string): boolean {
  const s = studio();
  if (id === activePage(s.doc)) return true;
  const why = pageSwitchBlocked();
  if (why) {
    feedback(why, { id: "page-switch" });
    return false;
  }
  const next = switchPage(s.doc, id);
  if (next === s.doc) return false;
  useStudio.setState({ doc: next, selection: [], hoverId: null, editingTextId: null });
  return true;
}

/** The next or previous page in the list (the Components page comes last, in Screens projects). */
export function stepPage(dir: 1 | -1, withComponents: boolean) {
  const doc = studio().doc;
  const ids = [...pagesOf(doc).map((p) => p.id), ...(withComponents ? [COMPONENTS_PAGE] : [])];
  const i = ids.indexOf(activePage(doc));
  const next = ids[i + dir];
  if (next) goToPage(next);
}

/** The screens page to go back to from the Components page (or the one showing). */
export const backPage = () => screensPage(studio().doc);

/**
 * Select layers wherever they are: show their page first (the first layer's), then select those
 * on it and bring them into view.
 */
export function revealLayers(ids: string[], opts: { glide?: boolean } = {}): boolean {
  const doc = studio().doc;
  const live = ids.filter((id) => doc.nodes[id]);
  const page = live.length ? pageOf(doc, live[0]) : undefined;
  if (!page || !goToPage(page)) return false;
  const here = live.filter((id) => pageOf(studio().doc, id) === page);
  studio().select(here);
  if (opts.glide !== false) onCanvasReady((c) => (here.length === 1 ? glideToLayer(c, here[0]) : c.glideToFit(here)));
  return true;
}

// ---------------------------------------------------------------------------
// Page edits (undoable)

/** Add a page after the others and show it. */
export function newPage(name?: string): string | null {
  const s = studio();
  const { doc, id } = addPage(s.doc, name);
  if (!id) {
    feedback("A project holds 100 pages at most", { id: "page-add" });
    return null;
  }
  s.mutate(() => doc);
  goToPage(id);
  return id;
}

export function renamePageTo(id: string, name: string) {
  const s = studio();
  s.mutate(() => renamePage(s.doc, id, name));
}

export function movePageTo(id: string, index: number) {
  const s = studio();
  s.mutate(() => reorderPage(s.doc, id, index));
}

export function removePage(id: string) {
  const s = studio();
  const ok = canDeletePage(s.doc, id);
  if (ok !== true) return feedback(ok, { id: "page-delete" });
  if (activePage(s.doc) === id) {
    const why = pageSwitchBlocked();
    if (why) return feedback(why, { id: "page-switch" });
  }
  const name = pageName(s.doc, id);
  s.mutate(() => deletePage(s.doc, id));
  s.select(s.selection);
  feedback(`Deleted ${name}`, { id: "page-delete" });
}

/** Move top-level layers of the page showing to another page (their prototype parts go too). */
export function moveLayersToPage(ids: string[], pageId: string) {
  const s = studio();
  const top = ids.filter((id) => s.doc.nodes[id] && !s.doc.nodes[id].parentId);
  if (!top.length) return feedback("Select top-level layers to move", { id: "page-move" });
  s.mutate(() => moveToPage(s.doc, top, pageId));
  s.select(s.selection);
  feedback(`Moved ${top.length === 1 ? (s.doc.nodes[top[0]]?.name ?? "1 layer") : `${top.length} layers`} to ${pageName(s.doc, pageId)}`, { id: "page-move" });
}

// ---------------------------------------------------------------------------
// A camera per page, whatever shows another page (a click, a key, undo)

const cameras = new Map<string, Camera>();
const DEFAULT_CAMERA: Camera = { x: -80, y: -80, zoom: 1 };
type PageListener = (page: string, prev: string) => void;
const listeners = new Set<PageListener>();

/** Called after another page shows (by any route), with the camera already set. */
export function onPageChange(fn: PageListener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The camera a page had when it was last left, if it was shown before. */
export const pageCamera = (id: string): Camera | undefined => cameras.get(id);

/** Does any top-level layer show in this camera (a viewport about the canvas's size when unknown)? */
function inView(doc: Doc, cam: Camera, vp = { w: 1200, h: 800 }): boolean {
  const view = { x: cam.x, y: cam.y, w: vp.w / cam.zoom, h: vp.h / cam.zoom };
  return doc.roots.some((id) => doc.nodes[id] && boxesIntersect(worldBounds(doc, id), view));
}

let started = false;

/** Start following page changes (idempotent). */
export function startPages() {
  if (started) return;
  started = true;
  // A project opens on the page it was left on: bring its layers into view when none show.
  onCanvasReady((c) => {
    const { doc, camera } = studio();
    if (doc.roots.length && !inView(doc, camera, c.viewport)) c.zoomToFit();
  });
  useStudio.subscribe((s, prev) => {
    const page = activePage(s.doc);
    const was = activePage(prev.doc);
    if (page === was) return;
    cameras.set(was, prev.camera);
    const cam = cameras.get(page);
    const patch: Partial<typeof s> = { hoverId: null };
    if (cam) patch.camera = cam;
    else if (page !== COMPONENTS_PAGE && !s.doc.roots.length) patch.camera = DEFAULT_CAMERA;
    useStudio.setState(patch);
    // A page shown for the first time fits its layers (the Components page fits once it's built),
    // and so does one whose layers all moved out of the view it was left at (moved there meanwhile).
    if (page !== COMPONENTS_PAGE && s.doc.roots.length && (!cam || !inView(s.doc, cam)))
      onCanvasReady((c) => {
        if (!cam || !inView(studio().doc, cam, c.viewport)) c.zoomToFit();
      });
    listeners.forEach((fn) => fn(page, was));
  });
}
