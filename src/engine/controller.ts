import type { Doc, SceneNode, TextNode } from "@/doc/schema";
import { studio, useStudio, type Camera } from "@/doc/store";
import { onComponentsPage } from "@/doc/pages";
import { useGhosts } from "@/doc/ghosts";
import { busyIds } from "@/doc/reservations";
import {
  type Box,
  type Pt,
  apply,
  invert,
  localMatrix,
  normalizeBox,
  boxesIntersect,
  worldBounds,
  worldMatrix,
  parentWorldMatrix,
  selectionBounds,
  isDescendant,
  descendants,
  mul,
  translate,
  topFrameOf,
  type Mat,
} from "@/doc/geometry";
import { makeFrame, makeShape, makeText } from "@/doc/factory";
import { activeTokens, tokensForNode, useSystems } from "@/design-system/registry";
import { duplicate, fitText, insertNodes, reparent, topLevelOf } from "@/doc/ops";
import { pasteClipboard } from "@/doc/clipboard";
import { scaleTree } from "@/doc/transform";
import { setLine } from "@/doc/vector-shapes";
import { imageFiles, placeImages } from "@/ui/images";
import { reducedMotion } from "@/ui/motion";
import { hasAutoLayout, inFlow } from "@/doc/autolayout";
import { flowIndexAt, moveNodes, pinResized } from "@/doc/autolayout-ops";
import { dispatchKeyDown, isMac } from "@/commands";
import { commandCanvas, setCommandCanvas } from "@/commands/canvas";
import { hitPath, pickTarget, deepestFrame } from "./hit-test";
import { type FlowDrag, type Guide, type HandleKind, type LineEnd, type RenderInput, Renderer, HANDLE_SIZE, isLineNode } from "./renderer";
import { type Spacing, guideFor, snapBox } from "./snapping";
import { measureBetween } from "./measure";
import { RULER_SIZE } from "./rulers";
import { angleOf, normalizeDeg, rotateAround, rotationCornerAt, rotationDelta } from "./rotation";
import { resizeCursor, rotateCursor } from "./chrome-cursors";
import "./canvas-commands";
import { type PointerInfo, VectorTools } from "./vector-tools";
import { canvasDelegate } from "./canvas-delegate";
import { hiddenParts } from "./route-layer";
import { fitTargets, marqueeHits } from "@/doc/board";

type Drag =
  | { kind: "pan"; start: Pt; cam: Camera }
  | {
      kind: "move";
      start: Pt;
      ids: string[];
      /** Where each layer's (x, y) sat in world space when the drag got going. */
      at: Map<string, Pt>;
      startBox: Box;
      active: boolean;
      dup: boolean;
      /** Some layers sit in auto layout: nothing moves until the drop; a ghost follows the cursor. */
      flow: boolean;
      /** World matrices at the start of the drag (for the ghost). */
      startWorld: Map<string, Mat>;
      delta: Pt;
      /** Where the layers would land: a frame (or the canvas, null) and, in auto layout, the index. */
      drop: { target: string | null; index?: number; line: [Pt, Pt] | null } | null;
    }
  | {
      kind: "resize";
      handle: HandleKind;
      start: Pt;
      /** `world`: the layer's world matrix at the start (its parent's space can shift mid-drag, see `parentInv`). */
      single: { id: string; world: Mat; x: number; y: number; w: number; h: number; flipH: boolean; flipV: boolean } | null;
      /** `at`: where each layer's (x, y) sat in world space at the start. */
      multi: { box: Box; items: { id: string; at: Pt; w: number; h: number; wb: Box }[] } | null;
      /** Boxes the dragged edges snap to (world); null when the box is turned and can't snap. */
      cands: Box[] | null;
    }
  /** Drag outside a corner: turn the layers around the selection's centre (⇧: 15° steps). */
  | {
      kind: "rotate";
      center: Pt;
      start: Pt;
      items: { id: string; rotation: number; center: Pt; sign: 1 | -1 }[];
      /** One layer: its angle, so ⇧ snaps the angle itself rather than the turn. */
      base: number;
      angle: number;
    }
  /** Drag one end of a line; the other end stays put (world space). */
  | { kind: "line-end"; id: string; end: LineEnd; fixed: Pt }
  | { kind: "marquee"; start: Pt; base: string[] }
  | { kind: "create"; id: string; start: Pt; type: "frame" | "rect" | "ellipse"; moved: boolean; last?: Pt; cands: Box[] }
  /** Hold Z: click zooms in (⌥ out), a drag zooms to the box. Screen space. */
  | { kind: "zoom"; start: Pt; out: boolean };

const DRAG_THRESHOLD = 3;
/** Which way each resize handle pulls, before the box's own turn (degrees, screen, y down). */
const HANDLE_ANGLE: Record<HandleKind, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
const CLIP_MARKER = "qalam:clip:";
const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable || el.tagName === "SELECT");
};
const SNAP_PX = 6;
const NAV_KEYS = new Set(["Enter", " ", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);
/** A button or tab reached with the keyboard keeps Enter, Space, Tab and arrows (clicked ones don't). */
const ownsNavigationKey = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  if (!el || el === document.body || !el.matches?.(":focus-visible")) return false;
  return !e.metaKey && !e.ctrlKey && !e.altKey && NAV_KEYS.has(e.key);
};
/** A matrix that neither turns nor skews (boxes stay boxes, so their edges can snap). */
const axisAligned = (m: Mat) => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;
/** Positions and sizes land on whole pixels while "Snap to pixel grid" is on, else on hundredths. */
const pixel = (v: number) => (studio().view.snapToPixels ? Math.round(v) : Math.round(v * 100) / 100);
/** ⌃ (Mac) held during a drag: no smart guides. */
const ignoreSnapping = (e: PointerEvent) => e.ctrlKey && !e.metaKey && isMac();
/** Axes a vector has no extent on (a horizontal line's height): resizing keeps them at 0. */
const zeroAxes = (n: SceneNode | undefined) => ({ w: n?.type === "path" && n.vw === 0, h: n?.type === "path" && n.vh === 0 });
/**
 * World → a layer's parent space, as the doc is now. Drags keep their start in world space and
 * convert on every frame: a group hugs its children after each edit, so its origin (the space its
 * children's x/y live in) can move under a drag.
 */
const parentInv = (doc: Doc, id: string): Mat => invert(parentWorldMatrix(doc, id));
/** Drops float noise from a round trip through world space (100.00000000001 → 100). */
const tidy = (v: number) => Math.round(v * 1e6) / 1e6;

/** Bumped whenever the designer moves the camera (wheel, drag, zoom keys and menu), never by code. */
let userCamEpoch = 0;
export const userCameraEpoch = () => userCamEpoch;

/** Extra room to keep clear when fitting a box, e.g. under a floating panel. */
export interface Insets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

const normalizeHex = (hex: string) => (/^#[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : hex);

/** ⌘-drag marquee: the deepest layers wholly inside the box (not frames that hold others). */
function deepMarquee(doc: Doc, box: Box, busy: Set<string>): string[] {
  const out: string[] = [];
  const inside = (b: Box) => b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h;
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!n || !n.visible || n.locked || busy.has(id)) return;
    const b = worldBounds(doc, id);
    if (n.children.length) {
      // A clipping frame hides whatever is outside it.
      if (n.type !== "frame" || !n.clip || boxesIntersect(b, box)) n.children.forEach(walk);
      return;
    }
    if (inside(b)) out.push(id);
  };
  doc.roots.forEach(walk);
  return out;
}

export class Controller {
  private drag: Drag | null = null;
  /** Line, arrow, polygon, star, pen, pencil and vector edit mode (they own their gestures). */
  private vector = new VectorTools({ toWorld: (p) => this.toWorld(p), camera: () => studio().camera, viewport: () => this.viewport, render: () => this.render() });
  private marquee: Box | null = null;
  private guides: Guide[] = [];
  /** Distances labelled along the smart guides while dragging. */
  private spacings: Spacing[] = [];
  /** The resize handle or line end under the pointer (drawn filled). */
  private hoverHandle: HandleKind | LineEnd | null = null;
  private spaceDown = false;
  /** The pending frame of the vector overlay's animation loop (0: none). */
  private animFrame = 0;
  private disposed = false;
  private lastPointer: Pt = { x: 0, y: 0 };
  private unsub: () => void;
  private cleanup: (() => void)[] = [];

  constructor(
    private el: HTMLCanvasElement,
    private renderer: Renderer,
  ) {
    const unsubDoc = useStudio.subscribe(() => this.render());
    const unsubGhosts = useGhosts.subscribe(() => this.render());
    this.unsub = () => (unsubDoc(), unsubGhosts());
    renderer.onImageLoaded = () => this.render();

    const on = <K extends keyof HTMLElementEventMap>(t: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(t, fn as EventListener, opts);
      this.cleanup.push(() => el.removeEventListener(t, fn as EventListener));
    };
    on("pointerdown", (e) => this.onPointerDown(e));
    on("pointermove", (e) => this.onPointerMove(e));
    on("pointerup", (e) => this.onPointerUp(e));
    on("pointercancel", (e) => this.onPointerUp(e));
    on("dblclick", (e) => this.onDoubleClick(e));
    on("wheel", (e) => this.onWheel(e), { passive: false });
    on("pointerleave", () => studio().setHover(null));
    const kd = (e: KeyboardEvent) => this.onKeyDown(e);
    const ku = (e: KeyboardEvent) => this.onKeyUp(e);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    this.cleanup.push(() => window.removeEventListener("keydown", kd), () => window.removeEventListener("keyup", ku));
    // A key released while the window is in the background never sends keyup (⌘Tab mid-pan).
    const blur = () => this.releaseHeldKeys();
    const hidden = () => document.hidden && this.releaseHeldKeys();
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", hidden);
    this.cleanup.push(() => window.removeEventListener("blur", blur), () => document.removeEventListener("visibilitychange", hidden));
    // Native clipboard events: internal copies leave a marker, so pasting an OS screenshot after a
    // canvas copy places the image, and pasting after a canvas copy still duplicates nodes.
    // ⌘X deletes the layers on keydown, before its cut event, so the marker can't wait for a selection.
    const copy = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      const justCut = e.type === "cut" && performance.now() - this.cutAt < 1000;
      if (!justCut && !studio().selection.length) return;
      e.clipboardData?.setData("text/plain", `${CLIP_MARKER}${Date.now()}`);
      e.preventDefault();
    };
    const paste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      // The Components page is read-only (its guard blocks ⌘V; this catches the browser's own paste).
      if (onComponentsPage(studio().doc)) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const files = imageFiles(e.clipboardData?.files);
      // ⇧⌘V (paste over selection) still arrives as a plain paste event: the keydown noted the ⇧.
      const over = performance.now() - this.pasteOverAt < 1000;
      this.pasteOverAt = -Infinity;
      e.preventDefault();
      if (files.length && !text.startsWith(CLIP_MARKER)) void placeImages(files).then((ids) => this.zoomToFit(ids));
      // Someone's own text (a Discovery board takes a brain dump): the mode's to decide.
      else if (text.trim() && !text.startsWith(CLIP_MARKER) && canvasDelegate()?.pasteText?.(text)) return;
      else pasteClipboard({ over });
    };
    window.addEventListener("copy", copy);
    window.addEventListener("cut", copy);
    window.addEventListener("paste", paste);
    this.cleanup.push(
      () => window.removeEventListener("copy", copy),
      () => window.removeEventListener("cut", copy),
      () => window.removeEventListener("paste", paste),
    );
    setCommandCanvas(this);
    this.cleanup.push(() => commandCanvas() === this && setCommandCanvas(null));
  }

  dispose() {
    this.unsub();
    this.vector.dispose();
    this.cleanup.forEach((f) => f());
    cancelAnimationFrame(this.panAnim);
    cancelAnimationFrame(this.animFrame);
    this.animFrame = 0;
    this.disposed = true;
  }

  render() {
    if (this.disposed) return;
    const s = studio();
    const d = this.drag;
    const selection = this.vector.hidesSelection() ? [] : s.selection;
    const { rulers, outlines, pixelGrid, pixelPreview, layoutGrids, routeParts } = s.view;
    this.renderer.schedule({
      doc: s.doc,
      camera: s.camera,
      selection,
      hoverId: d || this.vector.busy() ? null : s.hoverId,
      editingTextId: s.editingTextId,
      marquee: this.marquee,
      guides: this.guides,
      spacings: this.spacings,
      showFlags: true,
      // The Components page's drawings are picked, never resized or turned.
      hideHandles: (d?.kind === "move" && d.active) || d?.kind === "rotate" || this.vector.hidesSelection() || onComponentsPage(s.doc),
      flow: this.flowRender(s.doc),
      aiGhosts: useGhosts.getState().list.map((g) => g.doc),
      // Screens a ghost stands in for, and routes' parts while Prototype parts are hidden.
      coveredRoots: new Set([...useGhosts.getState().list.flatMap((g) => (g.covers ? [g.covers] : [])), ...hiddenParts(s.doc)]),
      vector: this.vector.overlay(),
      ost: canvasDelegate()?.render() ?? null,
      view: { rulers, outlines, pixelGrid, pixelPreview, layoutGrids, routeParts },
      measure: d || this.vector.busy() ? null : this.measurement(selection),
      rotating: d?.kind === "rotate" ? { angle: d.angle, at: this.lastPointer } : null,
      hoverHandle: d ? null : this.hoverHandle,
      rulerOrigin: rulers ? this.rulerOrigin(selection) : undefined,
    });
    this.updateCursor();
    // One frame loop while the vector overlay animates, however many events call render().
    if (this.vector.animating() && !this.animFrame) {
      this.animFrame = requestAnimationFrame(() => {
        this.animFrame = 0;
        this.render();
      });
    }
  }

  /**
   * ⌥ measure: holding ⌥ with a selection shows how far it is from the hovered layer, or from its
   * parent when the pointer is over the selection itself or nothing (Figma).
   */
  private measurement(selection: string[]): RenderInput["measure"] {
    const s = studio();
    if (!this.altDown || this.zoomDown || this.spaceDown || this.pickingColor || (s.tool !== "select" && s.tool !== "scale")) return null;
    const doc = s.doc;
    const ids = selection.filter((id) => doc.nodes[id]);
    const source = selectionBounds(doc, ids);
    if (!source) return null;
    const hover = s.hoverId && doc.nodes[s.hoverId] ? s.hoverId : null;
    const inside = hover && ids.some((id) => id === hover || isDescendant(doc, hover, id));
    const target = hover && !inside ? hover : doc.nodes[ids[0]].parentId;
    if (!target) return null;
    const box = worldBounds(doc, target);
    return { source, target: box, ...measureBetween(source, box) };
  }

  /** Rulers count from the top-level frame around the selection, else from the canvas origin. */
  private rulerOrigin(selection: string[]): Pt {
    const doc = studio().doc;
    const id = selection.find((i) => doc.nodes[i]?.parentId);
    if (!id) return { x: 0, y: 0 };
    const b = worldBounds(doc, topFrameOf(doc, id));
    return { x: b.x, y: b.y };
  }

  /** What the vector tools need to know about a pointer event. */
  private info(e: PointerEvent | MouseEvent, screen: Pt, world: Pt): PointerInfo {
    const coalesced = "getCoalescedEvents" in e ? e.getCoalescedEvents?.() : undefined;
    return {
      screen,
      world,
      button: e.button,
      shift: e.shiftKey,
      alt: e.altKey,
      mod: e.metaKey || e.ctrlKey,
      samples: coalesced?.length ? coalesced.map((c) => this.toWorld(this.local(c))) : undefined,
    };
  }

  /** Ghost, dimmed slot and insertion line while dragging layers around auto layout. */
  private flowRender(doc: Doc): FlowDrag | null {
    const d = this.drag;
    if (d?.kind !== "move" || !d.active) return null;
    const line = d.drop?.line ?? null;
    const target = d.drop?.index !== undefined ? d.drop.target : null;
    if (!d.flow) return line ? { dimmed: new Set(), ghosts: [], line, target } : null;
    const offset = translate(d.delta.x, d.delta.y);
    const ghosts = d.ids
      .filter((id) => doc.nodes[id])
      .map((id) => ({ id, m: mul(offset, mul(d.startWorld.get(id)!, invert(localMatrix(doc.nodes[id])))) }));
    return { dimmed: new Set(d.ids), ghosts, line, target };
  }

  // ---------------------------------------------------------------------------
  // coordinates

  private local(e: { clientX: number; clientY: number }): Pt {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  toWorld(p: Pt, cam = studio().camera): Pt {
    return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
  }

  toScreen(p: Pt, cam = studio().camera): Pt {
    return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
  }

  private toParentSpace(doc: Doc, parentId: string | null, world: Pt): Pt {
    return parentId ? apply(invert(worldMatrix(doc, parentId)), world) : world;
  }

  // ---------------------------------------------------------------------------
  // hit helpers

  private hitHandle(screen: Pt): HandleKind | null {
    const s = studio();
    const hp = this.renderer.handlePoints(s.doc, s.camera, s.selection);
    if (!hp) return null;
    const r = HANDLE_SIZE / 2 + 3;
    for (const h of hp.points) if (Math.abs(h.p.x - screen.x) <= r && Math.abs(h.p.y - screen.y) <= r) return h.h;
    return null;
  }

  /** A line's end knob under the pointer. */
  private hitLineEnd(screen: Pt): LineEnd | null {
    const s = studio();
    if (this.vector.hidesSelection()) return null;
    const ends = this.renderer.lineEnds(s.doc, s.camera, s.selection);
    if (!ends || s.doc.nodes[s.selection[0]]?.locked) return null;
    const r = HANDLE_SIZE / 2 + 3;
    for (const end of ["p1", "p0"] as const) if (Math.hypot(ends[end].x - screen.x, ends[end].y - screen.y) <= r) return end;
    return null;
  }

  /** Just outside a corner of the selection box: the rotation zone (its corner's outward angle). */
  private hitRotate(screen: Pt): number | null {
    const s = studio();
    if (this.vector.hidesSelection() || s.editingTextId || topLevelOf(s.doc, s.selection).every((id) => s.doc.nodes[id]?.locked)) return null;
    const hp = this.renderer.handlePoints(s.doc, s.camera, s.selection);
    if (!hp) return null;
    const i = rotationCornerAt(hp.corners, screen);
    if (i === null) return null;
    const c = hp.corners.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 });
    return angleOf(c, hp.corners[i]);
  }

  /** A frame's name label, by where the renderer last drew it. */
  private hitFrameLabel(screen: Pt): string | null {
    const { doc } = studio();
    const busy = busyIds();
    const rects = this.renderer.labelRects;
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i];
      const n = doc.nodes[r.id];
      if (!n || n.locked || busy.has(n.id)) continue;
      if (screen.x >= r.x && screen.x <= r.x + r.w && screen.y >= r.y && screen.y <= r.y + r.h) return n.id;
    }
    return null;
  }

  /** The rulers' strips take no canvas clicks (nor right-clicks: the context menu asks too). */
  onRulers(screen: Pt): boolean {
    return studio().view.rulers && (screen.x < RULER_SIZE || screen.y < RULER_SIZE);
  }

  /**
   * Boxes a layer's edges can snap to (world): its siblings and its parent (top-level layers: the
   * other top-level layers), without the layers in `skip`.
   */
  private snapCandidates(parentId: string | null, skip: Set<string>): Box[] {
    const doc = studio().doc;
    const out: Box[] = [];
    const sibs = parentId ? doc.nodes[parentId]?.children ?? [] : doc.roots;
    for (const id of sibs) if (!skip.has(id) && doc.nodes[id]?.visible) out.push(worldBounds(doc, id));
    if (parentId && doc.nodes[parentId]) out.push(worldBounds(doc, parentId));
    return out;
  }

  private targetAt(screen: Pt, deep: boolean): string | null {
    const label = this.hitFrameLabel(screen);
    if (label) return label;
    const s = studio();
    // Vectors are hit by their outline, give or take a few screen px.
    return pickTarget(s.doc, hitPath(s.doc, this.toWorld(screen), undefined, { tol: 4 / s.camera.zoom }), s.selection, deep);
  }

  // ---------------------------------------------------------------------------
  // pointer

  private onPointerDown(e: PointerEvent) {
    // ⌃-click on a Mac is a secondary click: the context menu opens, the canvas does nothing.
    if (e.button === 2 || (e.button === 0 && e.ctrlKey && !e.metaKey && isMac()) || this.onRulers(this.local(e))) return;
    // Keep focus where it is (e.g. the text editor we are about to open); the canvas is not focusable.
    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    const screen = this.local(e);
    const world = this.toWorld(screen);
    const s = studio();
    // Commit any focused panel input / text edit before interacting with the canvas.
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body) active.blur();

    if (this.pickingColor) return this.pickColorAt(screen);
    if (this.zoomDown && e.button === 0) {
      this.drag = { kind: "zoom", start: screen, out: e.altKey };
      return this.render();
    }
    if (e.button === 1 || s.tool === "hand" || this.spaceDown) {
      this.drag = { kind: "pan", start: screen, cam: s.camera };
      return this.render();
    }
    if (this.vector.pointerDown(this.info(e, screen, world))) return this.render();
    // A project mode's own gestures (Discovery: tree cards, stickies) come next.
    if (canvasDelegate()?.pointerDown(this.info(e, screen, world))) return this.render();

    if (s.tool === "text") {
      const path = hitPath(s.doc, world);
      const parent = deepestFrame(s.doc, path);
      const p = this.toParentSpace(s.doc, parent, world);
      const dir = parent && s.doc.nodes[parent].type === "frame" ? (s.doc.nodes[parent] as { dir: "ltr" | "rtl" }).dir : "ltr";
      const t = makeText({ x: Math.round(p.x), y: Math.round(p.y - 11), text: { content: "", direction: dir === "rtl" ? "rtl" : "auto" } }, parent ? tokensForNode(s.doc, parent) : activeTokens());
      fitText(t);
      insertNodes([t], parent, parent ? flowIndexAt(s.doc, parent, world)?.index : undefined);
      s.setTool("select");
      s.setEditingText(t.id);
      return;
    }

    if (s.tool === "frame" || s.tool === "rect" || s.tool === "ellipse") {
      const path = hitPath(s.doc, world);
      const parent = deepestFrame(s.doc, path);
      const toParent = parent ? invert(worldMatrix(s.doc, parent)) : invert([1, 0, 0, 1, 0, 0]);
      // The first corner snaps to what's around it, like the corner being dragged.
      const cands = parent && !axisAligned(worldMatrix(s.doc, parent)) ? [] : this.snapCandidates(parent, new Set());
      if (!ignoreSnapping(e)) {
        const snap = snapBox({ ...world, w: 0, h: 0 }, cands, SNAP_PX / s.camera.zoom, { x: [0], y: [0] });
        world.x += snap.dx;
        world.y += snap.dy;
      }
      const p = apply(toParent, world);
      // New nodes take their screen's design system; new top-level frames bind to the active one.
      const ts = parent ? tokensForNode(s.doc, parent) : activeTokens();
      const meta = parent ? undefined : { source: "user" as const, designSystem: useSystems.getState().activeId };
      const node =
        s.tool === "frame"
          ? makeFrame({ x: p.x, y: p.y, w: 1, h: 1, name: `Frame ${Object.values(s.doc.nodes).filter((n) => n.type === "frame").length + 1}`, ...(meta ? { meta } : {}) }, ts)
          : makeShape(s.tool, { x: p.x, y: p.y, w: 1, h: 1 }, ts);
      s.beginTx();
      insertNodes([node], parent, parent ? flowIndexAt(s.doc, parent, world)?.index : undefined);
      this.drag = { kind: "create", id: node.id, start: world, type: s.tool, moved: false, cands };
      return;
    }

    // select tool
    const end = this.hitLineEnd(screen);
    if (end) return this.startLineEnd(end);
    const handle = this.hitHandle(screen);
    if (handle) {
      this.startResize(handle, world);
      return;
    }
    if (this.hitRotate(screen) !== null) return this.startRotate(world);
    const target = this.targetAt(screen, e.metaKey || e.ctrlKey);
    if (target) {
      let sel = s.selection;
      if (e.shiftKey) {
        sel = sel.includes(target) ? sel.filter((id) => id !== target) : [...sel, target];
        s.select(sel);
        if (!sel.includes(target)) return;
      } else if (!sel.includes(target)) {
        sel = [target];
        s.select(sel);
      }
      const ids = topLevelOf(s.doc, sel).filter((id) => !s.doc.nodes[id].locked);
      this.drag = { kind: "move", start: world, ids, at: new Map(), startBox: selectionBounds(s.doc, ids)!, active: false, dup: e.altKey, flow: false, startWorld: new Map(), delta: { x: 0, y: 0 }, drop: null };
    } else {
      const base = e.shiftKey ? s.selection : [];
      if (!e.shiftKey) s.select([]);
      this.drag = { kind: "marquee", start: world, base };
    }
    this.render();
  }

  private startResize(handle: HandleKind, world: Pt) {
    const s = studio();
    const ids = topLevelOf(s.doc, s.selection);
    s.beginTx();
    // Edges snap while the box stays a box on screen (no turn on the layer or its frames).
    const skip = new Set(ids);
    const parents = [...new Set(ids.map((id) => s.doc.nodes[id].parentId))];
    const cands = parents.flatMap((p) => this.snapCandidates(p, skip));
    if (ids.length === 1) {
      const n = s.doc.nodes[ids[0]];
      const m = worldMatrix(s.doc, n.id);
      this.drag = { kind: "resize", handle, start: world, single: { id: n.id, world: m, x: n.x, y: n.y, w: n.w, h: n.h, flipH: !!n.flipH, flipV: !!n.flipV }, multi: null, cands: axisAligned(m) ? cands : null };
    } else {
      const box = selectionBounds(s.doc, ids)!;
      const items = ids.map((id) => {
        const n = s.doc.nodes[id];
        return { id, at: apply(parentWorldMatrix(s.doc, id), n), w: n.w, h: n.h, wb: worldBounds(s.doc, id) };
      });
      this.drag = { kind: "resize", handle, start: world, single: null, multi: { box, items }, cands };
    }
  }

  /** Rotate drag: every top-level selected layer turns around the selection's centre. */
  private startRotate(world: Pt) {
    const s = studio();
    const doc = s.doc;
    const ids = topLevelOf(doc, s.selection).filter((id) => !doc.nodes[id].locked);
    const b = selectionBounds(doc, ids);
    if (!b) return;
    s.beginTx();
    const items = ids.map((id) => {
      const n = doc.nodes[id];
      const pm = n.parentId ? worldMatrix(doc, n.parentId) : ([1, 0, 0, 1, 0, 0] as Mat);
      // In a mirrored frame a clockwise turn on screen is anticlockwise for the layer.
      const sign: 1 | -1 = pm[0] * pm[3] - pm[1] * pm[2] < 0 ? -1 : 1;
      return { id, rotation: n.rotation, center: apply(worldMatrix(doc, id), { x: n.w / 2, y: n.h / 2 }), sign };
    });
    const center = ids.length === 1 ? items[0].center : { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const base = ids.length === 1 ? doc.nodes[ids[0]].rotation : 0;
    this.drag = { kind: "rotate", center, start: world, items, base, angle: base };
    this.render();
  }

  private doRotate(d: Extract<Drag, { kind: "rotate" }>, world: Pt, snap: boolean) {
    const delta = rotationDelta(d.center, d.start, world, d.base, snap);
    d.angle = normalizeDeg(d.base + delta);
    studio().mutate((draft) => {
      for (const it of d.items) {
        const n = draft.nodes[it.id];
        if (!n) continue;
        const c = apply(parentInv(draft, it.id), rotateAround(it.center, d.center, delta));
        n.rotation = normalizeDeg(it.rotation + it.sign * delta);
        n.x = Math.round((c.x - n.w / 2) * 100) / 100;
        n.y = Math.round((c.y - n.h / 2) * 100) / 100;
      }
    });
  }

  /** Drag a line's end: the other end stays where it is. */
  private startLineEnd(end: LineEnd) {
    const s = studio();
    const n = s.doc.nodes[s.selection[0]];
    if (!isLineNode(n)) return;
    s.beginTx();
    this.drag = { kind: "line-end", id: n.id, end, fixed: apply(worldMatrix(s.doc, n.id), end === "p0" ? { x: n.w, y: 0 } : { x: 0, y: 0 }) };
    this.render();
  }

  private doLineEnd(d: Extract<Drag, { kind: "line-end" }>, world: Pt, shift: boolean) {
    const inv = parentInv(studio().doc, d.id);
    const fixed = apply(inv, d.fixed);
    let p = apply(inv, world);
    if (shift) {
      // ⇧: the line turns in 45° steps around its fixed end.
      const len = Math.hypot(p.x - fixed.x, p.y - fixed.y);
      const a = (Math.round(Math.atan2(p.y - fixed.y, p.x - fixed.x) / (Math.PI / 4)) * Math.PI) / 4;
      p = { x: fixed.x + Math.cos(a) * len, y: fixed.y + Math.sin(a) * len };
    }
    p = { x: pixel(p.x), y: pixel(p.y) };
    studio().mutate((draft) => {
      const n = draft.nodes[d.id];
      if (n?.type !== "path") return;
      delete n.flipH;
      delete n.flipV;
      if (d.end === "p0") setLine(n, p, fixed);
      else setLine(n, fixed, p);
    });
  }

  private onPointerMove(e: PointerEvent) {
    const screen = this.local(e);
    this.lastPointer = screen;
    const world = this.toWorld(screen);
    const s = studio();
    const d = this.drag;

    if (!d && (this.vector.pointerMove(this.info(e, screen, world)) || canvasDelegate()?.pointerMove(this.info(e, screen, world)))) {
      this.updateCursor(screen);
      return this.render();
    }
    if (!d) {
      const picking = (s.tool === "select" || s.tool === "scale") && !this.spaceDown && !this.zoomDown && !this.pickingColor;
      const handle = picking ? (this.hitLineEnd(screen) ?? this.hitHandle(screen)) : null;
      if (picking) s.setHover(handle || this.onRulers(screen) ? null : this.targetAt(screen, e.metaKey || e.ctrlKey));
      // ⌥ can go down while the window is in the background: trust the pointer's modifiers.
      const alt = e.altKey && !this.zoomDown;
      if (handle !== this.hoverHandle || (alt !== this.altDown && !this.zoomDown)) {
        this.hoverHandle = handle;
        if (!this.zoomDown) this.altDown = alt;
        this.render();
      }
      this.updateCursor(screen);
      return;
    }

    switch (d.kind) {
      case "pan": {
        userCamEpoch++;
        cancelAnimationFrame(this.panAnim);
        s.setCamera({ ...d.cam, x: d.cam.x - (screen.x - (d.start.x)) / d.cam.zoom, y: d.cam.y - (screen.y - d.start.y) / d.cam.zoom });
        break;
      }
      case "move": {
        let dx = world.x - d.start.x;
        let dy = world.y - d.start.y;
        if (!d.active) {
          if (Math.hypot(dx, dy) * s.camera.zoom < DRAG_THRESHOLD) return;
          d.active = true;
          s.beginTx();
          if (d.dup) {
            duplicate(d.ids);
            const dupIds = studio().selection;
            const doc = studio().doc;
            // Duplicates were offset; put them back on top of the originals before moving.
            studio().mutate((draft) => {
              dupIds.forEach((id, i) => {
                const src = doc.nodes[d.ids[i]];
                draft.nodes[id].x = src.x;
                draft.nodes[id].y = src.y;
              });
            });
            d.ids = dupIds;
          }
          const doc = studio().doc;
          d.flow = d.ids.some((id) => doc.nodes[id] && inFlow(doc, doc.nodes[id]));
          d.startWorld = new Map(d.ids.map((id) => [id, worldMatrix(doc, id)]));
          d.at = new Map(d.ids.map((id) => [id, apply(parentWorldMatrix(doc, id), doc.nodes[id])]));
        }
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (d.flow) {
          d.delta = { x: Math.round(dx), y: Math.round(dy) };
          this.guides = [];
          this.spacings = [];
          this.flowDrop(d, world, e.metaKey || e.ctrlKey);
          break;
        }
        this.flowDrop(d, world, e.metaKey || e.ctrlKey);
        // ⌃ (Mac) ignores smart guides while it is held.
        const snapped = ignoreSnapping(e) ? { dx: pixel(dx), dy: pixel(dy), guides: [], spacings: [] } : this.snapMove(d, dx, dy, e.shiftKey);
        dx = snapped.dx;
        dy = snapped.dy;
        this.guides = snapped.guides;
        this.spacings = snapped.spacings;
        studio().mutate((draft) => {
          for (const id of d.ids) {
            const n = draft.nodes[id];
            // Where the layer's (x, y) started in world space, moved, then back into the parent's
            // space as it is now (handles rotated parents, and groups that refit under the drag).
            const at = d.at.get(id)!;
            const p = apply(parentInv(draft, id), { x: at.x + dx, y: at.y + dy });
            n.x = tidy(p.x);
            n.y = tidy(p.y);
          }
        });
        break;
      }
      case "resize": {
        // Dragged edges snap to the layers around (the handle sits on the edge, so snap the pointer).
        const th = SNAP_PX / s.camera.zoom;
        const h = d.handle;
        const snap = d.cands && !ignoreSnapping(e) ? snapBox({ ...world, w: 0, h: 0 }, d.cands, th, { x: /[ew]/.test(h) ? [0] : [], y: /[ns]/.test(h) ? [0] : [] }) : null;
        const at = { x: world.x + (snap?.dx ?? 0), y: world.y + (snap?.dy ?? 0) };
        // The Scale tool (K) always keeps proportions: it scales the whole layer.
        this.doResize(d, at, e.shiftKey || s.tool === "scale", e.altKey);
        this.snapLines(snap, at, d.single ? [d.single.id] : d.multi!.items.map((i) => i.id), d.cands ?? []);
        break;
      }
      case "rotate":
        this.doRotate(d, world, e.shiftKey);
        break;
      case "line-end":
        this.doLineEnd(d, world, e.shiftKey);
        break;
      case "marquee": {
        this.marquee = normalizeBox(d.start, world);
        const doc = s.doc;
        const busy = busyIds();
        // ⌘ reaches inside frames: the deepest layers that sit wholly in the box.
        const hits = e.metaKey || e.ctrlKey ? deepMarquee(doc, this.marquee, busy) : marqueeHits(doc, this.marquee, busy);
        s.select(Array.from(new Set([...d.base, ...hits])));
        break;
      }
      case "zoom":
        this.marquee = normalizeBox(this.toWorld(d.start), world);
        break;
      case "create": {
        // Hold Space to move the shape being drawn instead of resizing it.
        if (this.spaceDown && d.last) d.start = { x: d.start.x + world.x - d.last.x, y: d.start.y + world.y - d.last.y };
        d.last = world;
        const snap = ignoreSnapping(e) || this.spaceDown ? null : snapBox({ ...world, w: 0, h: 0 }, d.cands, SNAP_PX / s.camera.zoom, { x: [0], y: [0] });
        const at = { x: world.x + (snap?.dx ?? 0), y: world.y + (snap?.dy ?? 0) };
        let dx = at.x - d.start.x;
        let dy = at.y - d.start.y;
        if (Math.hypot(dx, dy) * s.camera.zoom > DRAG_THRESHOLD) d.moved = true;
        if (e.shiftKey) {
          const m = Math.max(Math.abs(dx), Math.abs(dy));
          dx = Math.sign(dx || 1) * m;
          dy = Math.sign(dy || 1) * m;
        }
        // ⌥ draws from the centre.
        const inv = parentInv(s.doc, d.id);
        const a = apply(inv, e.altKey ? { x: d.start.x - dx, y: d.start.y - dy } : d.start);
        const b = apply(inv, { x: d.start.x + dx, y: d.start.y + dy });
        const box = normalizeBox(a, b);
        s.mutate((draft) => {
          const n = draft.nodes[d.id];
          n.x = pixel(box.x);
          n.y = pixel(box.y);
          n.w = Math.max(1, pixel(box.w));
          n.h = Math.max(1, pixel(box.h));
        });
        this.snapLines(e.shiftKey || e.altKey ? null : snap, at, [d.id], d.cands);
        break;
      }
    }
    this.render();
  }

  private onPointerUp(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    const s = studio();
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    if (!d) {
      const screen = this.local(e);
      const p = this.info(e, screen, this.toWorld(screen));
      if (this.vector.pointerUp(p) || canvasDelegate()?.pointerUp(p)) this.render();
      return;
    }
    if (d.kind === "move" && d.active) {
      if (d.flow) this.dropFlow(d);
      // Space held at the drop: don't nest into the frame underneath (Figma).
      else if (!this.spaceDown) this.maybeReparent(d.ids, this.toWorld(this.local(e)));
      s.commitTx();
    } else if (d.kind === "zoom") {
      this.zoomToolUp(d, this.local(e));
    } else if (d.kind === "resize" || d.kind === "rotate" || d.kind === "line-end") {
      s.commitTx();
    } else if (d.kind === "create") {
      if (!d.moved) {
        s.mutate((draft) => {
          const n = draft.nodes[d.id];
          if (d.type === "frame") {
            n.w = 390;
            n.h = 844;
          } else {
            n.w = 100;
            n.h = 100;
          }
        });
      }
      s.commitTx();
      s.setTool("select");
      s.select([d.id]);
    }
    this.marquee = null;
    this.guides = [];
    this.spacings = [];
    this.render();
  }

  /**
   * Guides for edges that snapped while resizing or drawing: through the snapped pointer, as long
   * as the layers' new box and everything lined up there.
   */
  private snapLines(snap: { guides: Guide[] } | null, at: Pt, ids: string[], cands: Box[]) {
    this.guides = [];
    this.spacings = [];
    const box = snap?.guides.length ? selectionBounds(studio().doc, ids) : null;
    if (!box) return;
    for (const g of snap!.guides) {
      const r = guideFor(g.axis, g.axis === "x" ? at.x : at.y, box, cands);
      this.guides.push(r.guide);
      if (r.spacing) this.spacings.push(r.spacing);
    }
  }

  private maybeReparent(ids: string[], world: Pt) {
    const s = studio();
    const doc = s.doc;
    const moving = new Set<string>();
    for (const id of ids) {
      moving.add(id);
      descendants(doc, id).forEach((c) => moving.add(c));
    }
    const target = deepestFrame(doc, hitPath(doc, world, moving));
    const toMove = ids.filter((id) => {
      const n = doc.nodes[id];
      if (!n) return false;
      // Top-level frames stay top-level (artboards).
      if (!n.parentId && n.type === "frame") return false;
      if (target && (target === id || isDescendant(doc, target, id))) return false;
      // Like Figma, a layer dragged around inside its group stays in it (the group grows).
      const group = n.parentId ? doc.nodes[n.parentId] : null;
      if (group?.meta.group && (!target || isDescendant(doc, group.id, target))) return false;
      return n.parentId !== target;
    });
    if (toMove.length) reparent(toMove, target, target ? flowIndexAt(doc, target, world)?.index : undefined);
  }

  /**
   * The layers' drop target under the pointer; reorders live when they stay in their own flow.
   * Over their own auto-layout parent they keep reordering there (⌘ reaches into nested frames).
   */
  private flowDrop(d: Extract<Drag, { kind: "move" }>, world: Pt, deep: boolean) {
    const doc = studio().doc;
    const moving = new Set<string>();
    for (const id of d.ids) {
      moving.add(id);
      descendants(doc, id).forEach((c) => moving.add(c));
    }
    let target = deepestFrame(doc, hitPath(doc, world, moving));
    const home = doc.nodes[d.ids[0]]?.parentId;
    if (d.flow && !deep && home && target !== home && d.ids.every((id) => doc.nodes[id]?.parentId === home)) {
      const b = worldBounds(doc, home);
      if (world.x >= b.x && world.x <= b.x + b.w && world.y >= b.y && world.y <= b.y + b.h) target = home;
    }
    const f = target ? doc.nodes[target] : null;
    // Top-level frames (artboards) never drop into anything.
    if (d.ids.some((id) => !doc.nodes[id]?.parentId && doc.nodes[id]?.type === "frame")) {
      d.drop = null;
      return;
    }
    if (!hasAutoLayout(f)) {
      d.drop = { target, line: null };
      return;
    }
    const exclude = new Set(d.ids);
    const slot = flowIndexAt(doc, f.id, world, exclude)!;
    const sameFlow = d.flow && d.ids.every((id) => doc.nodes[id]?.parentId === f.id);
    if (!sameFlow) {
      d.drop = { target: f.id, index: slot.index, line: slot.line };
      return;
    }
    // Live reorder: siblings slide out of the way.
    const kids = f.children;
    const rest = kids.filter((id) => !exclude.has(id));
    const order = [...rest.slice(0, slot.index), ...kids.filter((id) => exclude.has(id)), ...rest.slice(slot.index)];
    if (order.some((id, i) => id !== kids[i])) studio().mutate((dr) => void (dr.nodes[f.id].children = order));
    d.drop = { target: f.id, line: null };
  }

  /** Drop layers dragged out of (or across) auto layout. */
  private dropFlow(d: Extract<Drag, { kind: "move" }>) {
    const drop = d.drop;
    const doc = studio().doc;
    if (!drop || !d.ids.length) return;
    if (drop.index !== undefined) {
      moveNodes(d.ids, drop.target, drop.index);
      return;
    }
    if (drop.target && d.ids.every((id) => doc.nodes[id]?.parentId === drop.target)) return; // reordered in place
    // Out of the flow: land where the ghost is.
    const first = d.ids[0];
    const was = apply(d.startWorld.get(first)!, { x: 0, y: 0 });
    const now = apply(worldMatrix(doc, first), { x: 0, y: 0 });
    moveNodes(d.ids, drop.target, undefined, { x: was.x + d.delta.x - now.x, y: was.y + d.delta.y - now.y });
  }

  private doResize(d: Extract<Drag, { kind: "resize" }>, world: Pt, keepRatio: boolean, fromCenter: boolean) {
    const h = d.handle;
    const hasW = h.includes("w"), hasE = h.includes("e"), hasN = h.includes("n"), hasS = h.includes("s");
    if (d.single) {
      const sgl = d.single;
      const l = apply(invert(sgl.world), world); // in the node's original local space
      let x0 = 0, y0 = 0, x1 = sgl.w, y1 = sgl.h;
      if (hasW) x0 = l.x;
      if (hasE) x1 = l.x;
      if (hasN) y0 = l.y;
      if (hasS) y1 = l.y;
      if (fromCenter) {
        if (hasW) x1 = sgl.w - x0;
        if (hasE) x0 = sgl.w - x1;
        if (hasN) y1 = sgl.h - y0;
        if (hasS) y0 = sgl.h - y1;
      }
      if (keepRatio && sgl.w > 0 && sgl.h > 0) {
        const ratio = sgl.w / sgl.h;
        let w = Math.abs(x1 - x0), hh = Math.abs(y1 - y0);
        if ((hasE || hasW) && (hasN || hasS)) {
          if (w / ratio > hh) hh = w / ratio;
          else w = hh * ratio;
        } else if (hasE || hasW) hh = w / ratio;
        else w = hh * ratio;
        if (hasW) x0 = x1 - w; else x1 = x0 + w;
        if (hasN) y0 = y1 - hh; else if (hasS) y1 = y0 + hh; else { const cy = sgl.h / 2; y0 = cy - hh / 2; y1 = cy + hh / 2; }
        if (!hasE && !hasW) { const cx = sgl.w / 2; x0 = cx - w / 2; x1 = cx + w / 2; }
      }
      let nx0 = Math.min(x0, x1), nx1 = Math.max(x0, x1), ny0 = Math.min(y0, y1), ny1 = Math.max(y0, y1);
      // A straight line keeps its zero axis (Figma's line: h = 0, rotated).
      const zero = zeroAxes(studio().doc.nodes[sgl.id]);
      // Dragged past the opposite edge, the layer mirrors on that axis (Figma).
      const flipH = sgl.flipH !== (!zero.w && x1 < x0);
      const flipV = sgl.flipV !== (!zero.h && y1 < y0);
      if (zero.h) ny0 = ny1 = 0;
      if (zero.w) nx0 = nx1 = 0;
      const w = zero.w ? 0 : Math.max(1, pixel(nx1 - nx0));
      const hh = zero.h ? 0 : Math.max(1, pixel(ny1 - ny0));
      const c = apply(parentInv(studio().doc, sgl.id), apply(sgl.world, { x: (nx0 + nx1) / 2, y: (ny0 + ny1) / 2 }));
      // Scale tool: everything about the layer grows with its box (from the drag's start).
      const scaling = studio().tool === "scale" ? studio().txBase : null;
      studio().mutate((draft) => {
        const n = draft.nodes[sgl.id];
        n.w = w;
        n.h = hh;
        n.x = pixel(c.x - w / 2);
        n.y = pixel(c.y - hh / 2);
        if (flipH) n.flipH = true;
        else delete n.flipH;
        if (flipV) n.flipV = true;
        else delete n.flipV;
        if (scaling) scaleTree(draft, scaling, sgl.id, sgl.w ? w / sgl.w : sgl.h ? hh / sgl.h : 1);
        else if (n.type === "text") {
          const t = n as TextNode;
          if (hasN || hasS) t.text.autoSize = "fixed";
          else if (t.text.autoSize === "width") t.text.autoSize = "height";
          if (t.text.autoSize === "height") fitText(t);
        }
        pinResized(draft, n, keepRatio ? ["h", "v"] : [...(hasE || hasW ? (["h"] as const) : []), ...(hasN || hasS ? (["v"] as const) : [])]);
      });
    } else if (d.multi) {
      const b = d.multi.box;
      let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
      if (hasW) x0 = Math.min(world.x, x1 - 1);
      if (hasE) x1 = Math.max(world.x, x0 + 1);
      if (hasN) y0 = Math.min(world.y, y1 - 1);
      if (hasS) y1 = Math.max(world.y, y0 + 1);
      let sx = (x1 - x0) / b.w, sy = (y1 - y0) / b.h;
      if (keepRatio) {
        const k = Math.max(sx, sy);
        sx = sy = k;
        if (hasW) x0 = x1 - b.w * k; else x1 = x0 + b.w * k;
        if (hasN) y0 = y1 - b.h * k; else y1 = y0 + b.h * k;
      }
      const scaling = studio().tool === "scale" ? studio().txBase : null;
      studio().mutate((draft) => {
        for (const it of d.multi!.items) {
          const n = draft.nodes[it.id];
          const nwx = x0 + (it.wb.x - b.x) * sx;
          const nwy = y0 + (it.wb.y - b.y) * sy;
          const p = apply(parentInv(draft, it.id), { x: it.at.x + (nwx - it.wb.x), y: it.at.y + (nwy - it.wb.y) });
          n.x = pixel(p.x);
          n.y = pixel(p.y);
          const zero = zeroAxes(n);
          n.w = zero.w ? 0 : Math.max(1, pixel(it.w * sx));
          n.h = zero.h ? 0 : Math.max(1, pixel(it.h * sy));
          if (scaling) scaleTree(draft, scaling, it.id, sx);
          else if (n.type === "text") (n as TextNode).text.autoSize = "fixed";
          pinResized(draft, n, ["h", "v"]);
        }
      });
    }
  }

  /**
   * Smart guides while moving: edges and centres line up with the siblings and the parent, and
   * gaps repeat the spacing between neighbours. ⇧ (one axis) snaps only along the free axis.
   */
  private snapMove(d: Extract<Drag, { kind: "move" }>, dx: number, dy: number, axisLock: boolean): { dx: number; dy: number; guides: Guide[]; spacings: Spacing[] } {
    const s = studio();
    const doc = s.doc;
    const first = doc.nodes[d.ids[0]];
    if (!first) return { dx, dy, guides: [], spacings: [] };
    const cands = this.snapCandidates(first.parentId, new Set(d.ids));
    const b = { ...d.startBox, x: d.startBox.x + dx, y: d.startBox.y + dy };
    const lockX = axisLock && dx === 0, lockY = axisLock && dy === 0;
    const r = snapBox(b, cands, SNAP_PX / s.camera.zoom, { x: lockX ? [] : undefined, y: lockY ? [] : undefined, spacing: true });
    return { dx: pixel(dx + r.dx), dy: pixel(dy + r.dy), guides: r.guides, spacings: r.spacings };
  }

  private onDoubleClick(e: MouseEvent) {
    const s = studio();
    if (this.vector.doubleClick(this.info(e, this.local(e), this.toWorld(this.local(e))))) return;
    if (canvasDelegate()?.doubleClick(this.info(e, this.local(e), this.toWorld(this.local(e))))) return;
    if (s.tool !== "select") return;
    const screen = this.local(e);
    const path = hitPath(s.doc, this.toWorld(screen));
    if (!path) return;
    const leaf = s.doc.nodes[path[path.length - 1]];
    const sel = s.selection[0];
    // Editing text directly when it (or its parent) is the current context.
    if (leaf.type === "text" && (sel === leaf.id || sel === leaf.parentId || path.indexOf(sel) === path.length - 2)) {
      s.select([leaf.id]);
      s.setEditingText(leaf.id);
      return;
    }
    const i = sel ? path.indexOf(sel) : -1;
    if (i >= 0 && i + 1 < path.length) {
      const next = s.doc.nodes[path[i + 1]];
      s.select([next.id]);
      if (next.type === "text" && i + 2 === path.length) s.setEditingText(next.id);
    } else if (leaf.type === "text") {
      s.select([leaf.id]);
      s.setEditingText(leaf.id);
    }
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    userCamEpoch++;
    cancelAnimationFrame(this.panAnim);
    const s = studio();
    const cam = s.camera;
    if (e.ctrlKey || e.metaKey) {
      const screen = this.local(e);
      const factor = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002));
      this.zoomAt(screen, cam.zoom * factor);
    } else {
      const k = e.deltaMode === 1 ? 16 : 1;
      s.setCamera({ ...cam, x: cam.x + (e.shiftKey ? e.deltaY : e.deltaX) * k / cam.zoom, y: cam.y + (e.shiftKey ? 0 : e.deltaY) * k / cam.zoom });
    }
  }

  zoomAt(screen: Pt, zoom: number) {
    userCamEpoch++;
    const s = studio();
    const cam = s.camera;
    const z = Math.min(64, Math.max(0.05, zoom));
    const w = this.toWorld(screen, cam);
    s.setCamera({ x: w.x - screen.x / z, y: w.y - screen.y / z, zoom: z });
  }

  zoomBy(factor: number) {
    this.zoomAt({ x: this.renderer.width / 2, y: this.renderer.height / 2 }, studio().camera.zoom * factor);
  }

  /** `user`: the designer asked for it (keys, menu), which stops the AI's camera follow. */
  zoomToFit(ids?: string[], user = false) {
    if (user) userCamEpoch++;
    const s = studio();
    // Everything: top-level layers, and every card showing in a Discovery tree (a tree's root box isn't its extent).
    const list = ids?.length ? ids : fitTargets(s.doc);
    const b = withExtras(selectionBounds(s.doc, list), ids?.length ? [] : (canvasDelegate()?.fitBoxes?.() ?? []));
    if (b) this.zoomToBox(b);
  }

  /** The camera that fits a world-space box in the viewport, keeping `insets` clear. */
  fitCamera(b: Box, insets: Insets = {}, maxZoom = 4, pad = 80): Camera {
    const l = pad + (insets.left ?? 0), r = pad + (insets.right ?? 0), t = pad + (insets.top ?? 0), btm = pad + (insets.bottom ?? 0);
    const W = this.renderer.width, H = this.renderer.height;
    const zoom = Math.min(maxZoom, Math.max(0.05, Math.min((W - l - r) / Math.max(1, b.w), (H - t - btm) / Math.max(1, b.h))));
    return { x: b.x + b.w / 2 - (l + (W - l - r) / 2) / zoom, y: b.y + b.h / 2 - (t + (H - t - btm) / 2) / zoom, zoom };
  }

  /** Fit a world-space box (e.g. space reserved for AI work) in the viewport. */
  zoomToBox(b: Box, insets?: Insets) {
    cancelAnimationFrame(this.panAnim);
    studio().setCamera(this.fitCamera(b, insets));
  }

  /** The viewport size in CSS px. */
  get viewport() {
    return { w: this.renderer.width, h: this.renderer.height };
  }

  private panAnim = 0;
  /** The glide's destination and the last camera it set (anything else moving the camera ends it). */
  private panGoal: Camera | null = null;
  private panLast: Camera | null = null;

  /** Glide the camera to a camera (e.g. from fitCamera) over `ms`, eased. */
  panTo(to: Camera, ms = 280) {
    cancelAnimationFrame(this.panAnim);
    // Reduced motion (the OS setting or the in-app override) jumps straight there.
    if (reducedMotion()) {
      this.panAnim = 0;
      studio().setCamera(to);
      return;
    }
    const from = studio().camera;
    const t0 = performance.now();
    this.panGoal = to;
    this.panLast = from;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = k >= 1 ? 1 : 1 - Math.pow(2, -10 * k); // ease-out-expo
      // Zoom in log space so it feels even whether zooming in or out.
      const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e);
      studio().setCamera({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, zoom });
      this.panLast = studio().camera;
      this.panAnim = k < 1 ? requestAnimationFrame(step) : 0;
    };
    this.panAnim = requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------------------
  // keyboard

  /** Hold Z: the zoom tool, until it is let go. */
  private zoomDown = false;
  /** ⌥ is down (zoom tool zooms out). */
  private altDown = false;
  /** ⌘ (Ctrl) is down: hover shows the deepest layer, like a ⌘-click would pick. */
  private deepDown = false;
  /** The eyedropper is waiting for a click on the canvas (no EyeDropper API). */
  private pickingColor: ((hex: string | null) => void) | null = null;

  /**
   * Shortcuts come from the command registry (src/commands); the controller only keeps keys that
   * are held rather than pressed: Space pans, Z zooms, ⌘ deep-hovers while they are down.
   */
  private onKeyDown(e: KeyboardEvent) {
    if (isEditable(e.target)) {
      // Panel fields keep their keys; only app-wide commands (⌘K, ⌘\, ⌘S…) run from there.
      dispatchKeyDown(e, "field");
      return;
    }
    if (ownsNavigationKey(e)) return;
    // A bare Space holds the hand; ⇧Space and ⌥Space are shortcuts of their own (dispatched below).
    if (e.code === "Space" && !e.metaKey && !e.ctrlKey && (this.spaceDown || (!e.shiftKey && !e.altKey))) {
      e.preventDefault();
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.updateCursor();
      }
      return;
    }
    if (e.key === "Alt" || e.key === "Meta" || e.key === "Control") return this.heldModifiers(e);
    if (this.pickingColor && e.key === "Escape") {
      e.preventDefault();
      return this.finishPick(null);
    }
    // Z (⌥Z too) is held, never pressed: Figma's zoom tool. A letter by layout, else by position.
    const z = /^z$/i.test(e.key) || (!/^[a-z]$/i.test(e.key) && e.code === "KeyZ");
    if (z && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      if (!this.zoomDown) {
        this.zoomDown = true;
        this.altDown = e.altKey;
        studio().setHover(null);
        this.updateCursor();
      }
      return;
    }
    dispatchKeyDown(e, "canvas");
  }

  private onKeyUp(e: KeyboardEvent) {
    if (e.code === "Space") {
      this.spaceDown = false;
      this.updateCursor();
    }
    if (e.code === "KeyZ" || /^z$/i.test(e.key)) {
      this.zoomDown = false;
      this.updateCursor();
    }
    if (e.key === "Alt" || e.key === "Meta" || e.key === "Control") this.heldModifiers(e);
    // A lone ⌥ (measuring) must not focus the Windows menu bar.
    if (e.key === "Alt") e.preventDefault();
  }

  /** ⌥ flips the zoom tool to zoom out (or measures, see `measurement`); ⌘ shows the deepest layer under the pointer. */
  private heldModifiers(e: KeyboardEvent) {
    if (e.altKey !== this.altDown && studio().selection.length) requestAnimationFrame(() => this.render());
    this.altDown = e.altKey;
    const deep = e.metaKey || e.ctrlKey;
    if (deep !== this.deepDown) {
      this.deepDown = deep;
      const s = studio();
      if (!this.drag && (s.tool === "select" || s.tool === "scale") && !this.zoomDown && !this.spaceDown && this.el.matches(":hover")) {
        s.setHover(this.hitHandle(this.lastPointer) ? null : this.targetAt(this.lastPointer, deep));
      }
    }
    this.updateCursor();
  }

  /** Forget held keys (the window lost focus, so their keyup will never come). */
  private releaseHeldKeys() {
    if (!this.spaceDown && !this.zoomDown && !this.altDown && !this.deepDown) return;
    this.spaceDown = false;
    this.zoomDown = false;
    this.altDown = false;
    this.deepDown = false;
    this.render();
  }

  /** Hold Z and click: zoom in around the point (⌥: out); drag: zoom to the box. */
  private zoomToolUp(d: Extract<Drag, { kind: "zoom" }>, screen: Pt) {
    const box = this.marquee;
    const z = studio().camera.zoom;
    if (box && box.w * z > DRAG_THRESHOLD * 2 && box.h * z > DRAG_THRESHOLD * 2) this.glideTo(this.fitCamera(box, {}, 64, 0), 200);
    else this.zoomKeyTo(this.cameraGoal.zoom * (d.out || this.altDown ? 0.5 : 2), screen);
  }

  // ---------------------------------------------------------------------------
  // colour picking

  /**
   * I / ⌃C: pick a colour. The browser's EyeDropper reads anywhere on screen; without it the next
   * click on the canvas samples the drawn pixel (Esc cancels). Resolves to #RRGGBB, or null.
   */
  async pickColor(): Promise<string | null> {
    const Dropper = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    this.finishPick(null);
    if (Dropper) {
      try {
        return normalizeHex((await new Dropper().open()).sRGBHex);
      } catch {
        return null; // cancelled
      }
    }
    return new Promise((resolve) => {
      this.pickingColor = resolve;
      studio().setHover(null);
      this.updateCursor();
    });
  }

  private finishPick(hex: string | null) {
    const done = this.pickingColor;
    this.pickingColor = null;
    this.updateCursor();
    done?.(hex);
  }

  /** The colour drawn at a canvas point (CSS px), read from a snapshot of the surface. */
  private async pickColorAt(screen: Pt) {
    // WebGL clears the drawing buffer once a frame is shown: draw the design (no selection
    // chrome) and read it back in the same task.
    const s = studio();
    const ghosts = useGhosts.getState().list;
    this.renderer.draw({
      doc: s.doc,
      camera: s.camera,
      selection: [],
      hoverId: null,
      editingTextId: s.editingTextId,
      marquee: null,
      guides: [],
      showFlags: false,
      hideHandles: true,
      aiGhosts: ghosts.map((g) => g.doc),
      coveredRoots: new Set(ghosts.flatMap((g) => (g.covers ? [g.covers] : []))),
    });
    const bytes = this.renderer.snapshotPNG();
    this.render();
    if (!bytes) return this.finishPick(null);
    try {
      const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
      const k = bmp.width / Math.max(1, this.renderer.width);
      const c = new OffscreenCanvas(1, 1).getContext("2d")!;
      c.drawImage(bmp, Math.floor(screen.x * k), Math.floor(screen.y * k), 1, 1, 0, 0, 1, 1);
      const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
      bmp.close();
      this.finishPick(normalizeHex(`#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`));
    } catch {
      this.finishPick(null);
    }
  }

  // ---------------------------------------------------------------------------
  // context menu

  /**
   * Right-click at a client point (e.clientX/Y): select what's there unless it's already part of
   * the selection, like Figma. Returns every layer under the point, top-most first (for a
   * "Select layer" submenu).
   */
  selectAt(client: { x: number; y: number }): string[] {
    const s = studio();
    const screen = this.local({ clientX: client.x, clientY: client.y });
    const target = this.targetAt(screen, false);
    if (!target) s.select([]);
    else if (!s.selection.includes(target)) s.select([target]);
    return this.layersAt(screen);
  }

  /** Every layer under a canvas point, top-most first (leaves before the frames holding them). */
  layersAt(screen: Pt): string[] {
    const { doc, camera } = studio();
    const world = this.toWorld(screen);
    const skip = new Set<string>();
    const out: string[] = [];
    for (let guard = 0; guard < 40; guard++) {
      const path = hitPath(doc, world, skip, { tol: 4 / camera.zoom });
      if (!path) break;
      const leaf = path[path.length - 1];
      for (const id of [...path].reverse()) if (!out.includes(id)) out.push(id);
      skip.add(leaf);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // commands (keyboard, menus and the palette call these through src/commands)

  private cutAt = -Infinity;
  private pasteOverAt = -Infinity;

  /** ⌘X ran on keydown: its cut event must still mark the system clipboard as ours. */
  noteCut() {
    this.cutAt = performance.now();
  }

  /** ⇧⌘V: the paste event that follows pastes over the selection. */
  notePasteOver() {
    this.pasteOverAt = performance.now();
  }

  /** Move the camera like a person would: eased, unless the designer prefers reduced motion. */
  glideTo(to: Camera, ms = 200) {
    userCamEpoch++;
    this.panTo(to, ms);
  }

  /** Where the camera is heading (mid-glide) or is: repeated zoom keys build on the target, not the frame in flight. */
  private get cameraGoal(): Camera {
    const cam = studio().camera;
    return this.panAnim && this.panGoal && cam === this.panLast ? this.panGoal : cam;
  }

  /** The point zoom keys zoom around: the pointer when it is over the canvas, else the viewport centre. */
  private zoomAnchor(): Pt {
    const p = this.lastPointer;
    const over = this.el.matches(":hover") && p.x >= 0 && p.y >= 0 && p.x <= this.renderer.width && p.y <= this.renderer.height;
    return over ? p : { x: this.renderer.width / 2, y: this.renderer.height / 2 };
  }

  /** Zoom keys (+ / - / ⌘= / ⌘-): Figma doubles or halves the zoom per press. */
  zoomStep(factor: number) {
    this.zoomKeyTo(this.cameraGoal.zoom * factor);
  }

  /** ⇧0 / ⌘0: a set zoom level around the pointer (or the centre), or around `at` (screen px). */
  zoomKeyTo(zoom: number, at: Pt = this.zoomAnchor()) {
    const from = this.cameraGoal;
    const z = Math.min(64, Math.max(0.05, zoom));
    const w = { x: at.x / from.zoom + from.x, y: at.y / from.zoom + from.y };
    this.glideTo({ x: w.x - at.x / z, y: w.y - at.y / z, zoom: z }, 160);
  }

  /** ⇧1 / ⇧2 / N: glide to fit layers (all top-level layers when none are given). */
  glideToFit(ids?: string[]) {
    const s = studio();
    const b = withExtras(selectionBounds(s.doc, ids?.length ? ids : fitTargets(s.doc)), ids?.length ? [] : (canvasDelegate()?.fitBoxes?.() ?? []));
    if (b) this.glideTo(this.fitCamera(b));
  }

  private updateCursor(screen: Pt = this.lastPointer) {
    const vc = this.drag || this.spaceDown || this.zoomDown || this.pickingColor ? null : (this.vector.cursor(screen) ?? canvasDelegate()?.cursor(screen) ?? null);
    if (vc) {
      if (this.el.style.cursor !== vc) this.el.style.cursor = vc;
      return;
    }
    const s = studio();
    let c = "default";
    if (this.drag?.kind === "pan") c = "grabbing";
    else if (this.zoomDown || this.drag?.kind === "zoom") c = this.altDown ? "zoom-out" : "zoom-in";
    else if (this.pickingColor) c = "crosshair";
    else if (s.tool === "hand" || this.spaceDown) c = "grab";
    else if (s.tool === "text") c = "text";
    else if (s.tool !== "select" && s.tool !== "scale") c = "crosshair";
    else if (this.drag?.kind === "rotate") c = rotateCursor(angleOf(this.toScreen(this.drag.center), screen));
    else if (this.drag?.kind === "line-end" || (!this.drag && this.hitLineEnd(screen))) c = "move";
    else if (!this.drag || this.drag.kind === "resize") {
      const h = this.drag?.kind === "resize" ? this.drag.handle : this.hitHandle(screen);
      const hp = h ? this.renderer.handlePoints(s.doc, s.camera, s.selection) : null;
      const at = hp?.points.find((p) => p.h === h);
      if (hp && at && h) {
        // Square to its edge (corners: on the diagonal), turned with the layer.
        c = resizeCursor(hp.angle + HANDLE_ANGLE[h]);
      } else if (!this.drag) {
        const corner = this.hitRotate(screen);
        if (corner !== null) c = rotateCursor(corner);
      }
    }
    if (this.el.style.cursor !== c) this.el.style.cursor = c;
  }
}

export type { SceneNode };

/** A box grown to take in others too (what a mode paints outside the document, like a board's sources lane). */
function withExtras(b: Box | null, extras: readonly Box[]): Box | null {
  if (!extras.length) return b;
  const all = b ? [b, ...extras] : [...extras];
  const x0 = Math.min(...all.map((x) => x.x));
  const y0 = Math.min(...all.map((x) => x.y));
  const x1 = Math.max(...all.map((x) => x.x + x.w));
  const y1 = Math.max(...all.map((x) => x.y + x.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
