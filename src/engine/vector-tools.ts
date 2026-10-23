import type { Doc, PathNode } from "@/doc/schema";
import { studio, useStudio, type Camera, type Tool } from "@/doc/store";
import { type Pt, apply, invert, parentWorldMatrix, worldMatrix, IDENTITY } from "@/doc/geometry";
import { insertNodes } from "@/doc/ops";
import { hasAutoLayout } from "@/doc/autolayout";
import { activeTokens, tokensForNode } from "@/design-system/registry";
import { type PointRef, snapAngle } from "@/doc/vector";
import { defaultInk, makeLine, makeShapeVector, setLine, setShapeBox } from "@/doc/vector-shapes";
import { canvasIsDark } from "./chrome";
import { cursorCss } from "./cursors";
import { deepestFrame, hitPath, pickTarget } from "./hit-test";
import { PenSession, pixelEnd } from "./pen";
import { PencilSession } from "./pencil";
import { EditSession, refKey } from "./vector-edit";
import { OVERLAY_MOTION, type VectorOverlay } from "./vector-overlay";
import { canEditVector, useVectorEdit } from "./vector-state";
import { useSurfaces } from "@/commands/surfaces";

/*
 * The vector tools behind one façade the controller calls from its pointer handlers: line (L),
 * arrow (⇧L), polygon and star create-drags, the pen (pen.ts), the pencil (pencil.ts) and vector
 * edit mode (vector-edit.ts). Each returns true when it took the event, so the controller's own
 * move/resize code never sees a vector gesture. Keys they need are caught on window in the capture
 * phase, before the command dispatcher, and only those are stopped. The façade also owns the
 * overlay's micro-interactions (anchors popping in, hover growth, the close ring).
 */

export interface VectorHost {
  toWorld(screen: Pt): Pt;
  camera(): Camera;
  viewport(): { w: number; h: number };
  render(): void;
}

export interface PointerInfo {
  screen: Pt;
  world: Pt;
  button: number;
  shift: boolean;
  alt: boolean;
  /** ⌘ (or Ctrl off the Mac). */
  mod: boolean;
  /** Coalesced pointer positions since the last event, in world space (pencil). */
  samples?: Pt[];
}

type ShapeTool = "line" | "arrow" | "polygon" | "star";
const SHAPE_TOOLS = new Set<Tool>(["line", "arrow", "polygon", "star"]);
export const isVectorTool = (t: Tool) => SHAPE_TOOLS.has(t) || t === "pen" || t === "pencil";

const DRAG_THRESHOLD = 3;
/** What a click (no drag) makes: a 100 px line, a 100 × 100 shape (Figma). */
const CLICK_SIZE = 100;

interface ShapeDrag {
  kind: ShapeTool;
  id: string;
  /**
   * Where the drag started (a whole pixel in the parent's space) and the latest pointer, both in
   * world space: drawn into a group, the group refits as the shape grows, which moves the parent's
   * space under the drag. `inParent` converts them on every frame.
   */
  start: Pt;
  startScreen: Pt;
  cur: Pt;
  moved: boolean;
  /** Selection before the drag, restored if it's cancelled. */
  prevSel: string[];
  /** Space held: the whole shape follows the pointer (Figma's reposition during a drag). */
  reposition: { at: Pt; start: Pt } | null;
}

/** The drag's start and pointer in the shape's parent space, as the doc is now. */
function inParent(doc: Doc, d: ShapeDrag): { start: Pt; cur: Pt } {
  const inv = invert(parentWorldMatrix(doc, d.id));
  const at = (w: Pt) => {
    const p = apply(inv, w);
    return { x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 };
  };
  return { start: at(d.start), cur: at(d.cur) };
}

const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || !!el.isContentEditable);
};
const NAV_KEYS = new Set(["Enter", " ", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);
/**
 * Keys aimed at something other than the canvas: an open menu, dialog, palette or editor, or a
 * button reached with the keyboard (it keeps Enter, Space, Tab and arrows, as in the controller).
 */
function notForCanvas(e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return true;
  const sf = useSurfaces.getState();
  if (sf.palette || sf.contextMenu) return true;
  const el = e.target as HTMLElement | null;
  if (!el || typeof el.closest !== "function" || el === document.body || el === document.documentElement) return false;
  if (el.closest("[role=dialog], [role=alertdialog], [role=menu], [role=listbox], [data-menu-content]")) return true;
  return !!el.matches?.(":focus-visible") && !e.metaKey && !e.ctrlKey && !e.altKey && NAV_KEYS.has(e.key);
}
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const easeOut = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

/** Hover growth of one overlay knob: eases in when it becomes hovered, out when it stops. */
class HoverTween {
  key: string | null = null;
  prev: string | null = null;
  at = 0;
  set(key: string | null, t: number) {
    if (key === this.key) return;
    this.prev = this.key;
    this.key = key;
    this.at = t;
  }
  grow(key: string, t: number): number {
    const d = OVERLAY_MOTION.hover;
    const k = d ? easeOut((t - this.at) / d) : 1;
    if (key === this.key) return k;
    if (key === this.prev) return 1 - k;
    return 0;
  }
  running(t: number) {
    return t - this.at < OVERLAY_MOTION.hover;
  }
}

export class VectorTools {
  private drag: ShapeDrag | null = null;
  private mods = { shift: false, alt: false, mod: false };
  private cleanup: (() => void)[] = [];
  private pen: PenSession;
  private pencil: PencilSession;
  private edit: EditSession;
  /** When anchors were placed, by `${node}:${path}:${point}` (they pop in). */
  private born = new Map<string, number>();
  /** Edit mode opened at (its anchors pop in, staggered). */
  private enteredAt = -Infinity;
  private anchorHover = new HoverTween();
  private handleHover = new HoverTween();
  private animUntil = 0;

  constructor(private host: VectorHost) {
    const camera = () => host.camera();
    this.pen = new PenSession({
      camera,
      mods: () => this.mods,
      born: (id, r) => this.markBorn(id, r),
      bornAt: (id, r) => this.bornAt(id, r),
    });
    this.pencil = new PencilSession(camera);
    this.edit = new EditSession(camera);
    // Edit mode and the document change under the sessions (undo, panels, other tools).
    this.cleanup.push(
      useVectorEdit.subscribe((v, prev) => {
        if (v.nodeId !== prev.nodeId) {
          if (v.nodeId) this.enteredAt = now();
          this.edit.cancel();
          this.edit.hover = null;
          if (!v.nodeId && !this.pen.pressing) this.pen.sync();
        }
        if (v.nodeId !== prev.nodeId || v.points !== prev.points || v.handle !== prev.handle || v.tool !== prev.tool) host.render();
      }),
      useStudio.subscribe((s, prev) => {
        if (s.tool !== prev.tool) {
          if (prev.tool === "pen" && s.tool !== "pen") this.pen.reset();
          if (prev.tool === "pencil") this.pencil.cancel();
          // Picking the pen while editing makes it the edit sub-tool too.
          const v = useVectorEdit.getState();
          if (v.nodeId && s.tool === "pen" && v.tool !== "pen") v.setTool("pen");
          if (v.nodeId && s.tool === "select" && v.tool === "pen") v.setTool("move");
        }
        if (s.doc !== prev.doc) this.pen.sync();
      }),
    );
    if (typeof window === "undefined") return;
    const kd = (e: KeyboardEvent) => {
      if (this.keyDown(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    const ku = (e: KeyboardEvent) => this.keyUp(e);
    const blur = () => (this.mods = { shift: false, alt: false, mod: false });
    // Bubble phase, registered before the controller's: menus, dialogs, the palette and full-screen
    // editors see their keys first (and stop them), and nothing reaches the controller twice.
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku, true);
    window.addEventListener("blur", blur);
    this.cleanup.push(
      () => window.removeEventListener("keydown", kd),
      () => window.removeEventListener("keyup", ku, true),
      () => window.removeEventListener("blur", blur),
    );
  }

  dispose() {
    if (this.drag) this.cancel();
    this.pen.reset();
    this.edit.cancel();
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
  }

  private markBorn(id: string, r: PointRef) {
    if (this.born.size > 200) this.born.clear();
    this.born.set(`${id}:${refKey(r)}`, now());
    this.animUntil = Math.max(this.animUntil, now() + OVERLAY_MOTION.pop);
  }

  private bornAt(id: string, r: PointRef): number | undefined {
    const b = this.born.get(`${id}:${refKey(r)}`);
    if (b !== undefined && now() - b < OVERLAY_MOTION.pop) return b;
    return undefined;
  }

  /** Edit mode is on (the pen draws into it, the select tool edits points). */
  private editing() {
    return !!useVectorEdit.getState().nodeId;
  }

  /** Which session takes pointer events now. */
  private route(): "shape" | "pen" | "pencil" | "edit" | null {
    const tool = studio().tool;
    if (SHAPE_TOOLS.has(tool)) return "shape";
    if (tool === "pencil") return "pencil";
    // ⌘ held with the pen in edit mode is a temporary Bend (no anchor is placed).
    if (tool === "pen") return this.editing() && this.mods.mod && !this.pen.pressing ? "edit" : "pen";
    if (this.editing()) return "edit";
    return null;
  }

  // ---------------------------------------------------------------------------
  // pointer

  pointerDown(p: PointerInfo): boolean {
    this.mods = { shift: p.shift, alt: p.alt, mod: p.mod };
    const r = this.route();
    if (!r) return false;
    if (p.button !== 0) return r !== "edit";
    const tool = studio().tool;
    if (r === "shape") this.startShape(tool as ShapeTool, p);
    else if (r === "pen") this.pen.down(p);
    else if (r === "pencil") this.pencil.down(p);
    else this.edit.down(p);
    return true;
  }

  pointerMove(p: PointerInfo): boolean {
    this.mods = { shift: p.shift, alt: p.alt, mod: p.mod };
    const d = this.drag;
    if (!d) {
      const r = this.route();
      if (r === "pen") this.pen.move(p);
      else if (r === "pencil") this.pencil.move(p);
      else if (r === "edit") this.edit.move(p);
      else return false;
      this.trackHover();
      return true;
    }
    d.cur = p.world;
    if (!d.moved && Math.hypot(p.screen.x - d.startScreen.x, p.screen.y - d.startScreen.y) >= DRAG_THRESHOLD) d.moved = true;
    this.applyShape();
    return true;
  }

  pointerUp(p: PointerInfo): boolean {
    const d = this.drag;
    if (!d) {
      if (this.pen.pressing) this.pen.up(p);
      else if (this.pencil.active) this.pencil.up(p);
      else if (this.edit.active) this.edit.up(p);
      else return false;
      return true;
    }
    this.drag = null;
    const s = studio();
    const n = s.doc.nodes[d.id] as PathNode | undefined;
    if (n && (!d.moved || (d.kind === "line" || d.kind === "arrow" ? n.w < 0.5 : false))) {
      const a = inParent(s.doc, d).start;
      s.mutate((draft) => {
        const m = draft.nodes[d.id] as PathNode;
        if (d.kind === "line" || d.kind === "arrow") setLine(m, a, { x: a.x + CLICK_SIZE, y: a.y });
        else setShapeBox(m, { x: a.x, y: a.y, w: CLICK_SIZE, h: CLICK_SIZE });
      });
    }
    s.commitTx();
    s.setTool("select");
    if (n) s.select([d.id]);
    return true;
  }

  /**
   * In edit mode: add a point on a segment, or toggle an anchor smooth. With the Move tool on a
   * path that is (or whose parent is) the selection: enter edit mode, like double-clicking text.
   */
  doubleClick(p: PointerInfo): boolean {
    const s = studio();
    if (this.editing()) {
      if (this.edit.doubleClick(p)) return true;
      return s.tool === "select" || s.tool === "pen";
    }
    if (s.tool !== "select") return false;
    const path = hitPath(s.doc, p.world, undefined, { tol: 4 / s.camera.zoom });
    if (!path) return false;
    const leaf = s.doc.nodes[path[path.length - 1]];
    if (leaf.type !== "path") return false;
    const sel = s.selection[0];
    const target = pickTarget(s.doc, path, s.selection, false);
    if (!(sel === leaf.id || sel === leaf.parentId || target === leaf.id || path.indexOf(sel) === path.length - 2)) return false;
    if (!canEditVector(leaf.id)) return false;
    s.select([leaf.id]);
    return useVectorEdit.getState().enter(leaf.id);
  }

  // ---------------------------------------------------------------------------
  // keys (window, bubble phase, ahead of the controller): returns true for keys it consumed

  keyDown(e: KeyboardEvent): boolean {
    if (isEditable(e.target) || studio().editingTextId || notForCanvas(e)) return false;
    if (e.key === "Shift" || e.key === "Alt" || e.key === "Meta" || e.key === "Control") {
      this.mods = { shift: e.shiftKey, alt: e.altKey, mod: e.metaKey || e.ctrlKey };
    }
    const d = this.drag;
    if (!d) {
      const consumed = this.sessionKey(e);
      this.host.render();
      return consumed;
    }
    if (e.key === "Shift" || e.key === "Alt") {
      this.applyShape();
      this.host.render();
      return false;
    }
    if (e.key === "Escape") {
      this.cancel();
      this.host.render();
      return true;
    }
    if (e.code === "Space") {
      if (!e.repeat && !d.reposition) d.reposition = { at: d.cur, start: d.start };
      return true;
    }
    return false;
  }

  /** Keys for the pen, pencil and edit mode (no shape drag running). */
  private sessionKey(e: KeyboardEvent): boolean {
    const r = studio().tool === "pencil" ? "pencil" : studio().tool === "pen" ? "pen" : this.editing() ? "edit" : null;
    if (r === "pencil") return this.pencil.keyDown(e);
    if (r === "pen") {
      if (this.pen.keyDown(e)) return true;
      // Idle pen in edit mode: the edit keys (delete points, nudge, sub-tools) still apply.
      return !this.pen.drawing && this.editing() && e.key !== "Escape" && e.key !== "Enter" ? this.edit.keyDown(e) : false;
    }
    if (r === "edit") return this.edit.keyDown(e);
    return false;
  }

  keyUp(e: KeyboardEvent): void {
    if (e.key === "Shift" || e.key === "Alt" || e.key === "Meta" || e.key === "Control") {
      this.mods = { shift: e.shiftKey, alt: e.altKey, mod: e.metaKey || e.ctrlKey };
    }
    this.pencil.keyUp(e);
    const d = this.drag;
    if (!d) {
      if (e.code === "Space" || e.key === "Shift" || e.key === "Alt") this.pen.keyUp(e);
      if (this.editing() || studio().tool === "pen") this.host.render();
      return;
    }
    if (e.key === "Shift" || e.key === "Alt") {
      this.applyShape();
      this.host.render();
    }
    if (e.code === "Space") d.reposition = null;
  }

  // ---------------------------------------------------------------------------
  // render hooks

  /**
   * The bbox and resize handles step aside while a line is drawn (its degenerate box is noise),
   * in edit mode (anchors replace them), and while the pen or pencil draw.
   */
  hidesSelection(): boolean {
    return this.drag?.kind === "line" || this.drag?.kind === "arrow" || this.editing() || this.pen.drawing || this.pencil.active;
  }

  /** Feed the hover tweens from what the sessions report as hovered. */
  private trackHover() {
    const o = this.rawOverlay();
    const t = now();
    const a = o?.anchors.findIndex((x) => x.hover) ?? -1;
    const h = o?.handles.findIndex((x) => x.hover) ?? -1;
    this.anchorHover.set(a >= 0 ? `a${a}` : null, t);
    this.handleHover.set(h >= 0 ? `h${h}` : null, t);
  }

  private rawOverlay(): VectorOverlay | null {
    const tool = studio().tool;
    if (this.pencil.active) return this.pencil.overlay();
    if (tool === "pen") return this.pen.overlay(useVectorEdit.getState().points);
    if (this.editing()) return this.edit.overlay({ born: (r) => this.bornAt(useVectorEdit.getState().nodeId!, r) });
    return null;
  }

  overlay(): VectorOverlay | null {
    const o = this.rawOverlay();
    if (!o) return null;
    const t = now();
    // Entering edit mode: anchors pop in with a short stagger.
    const sinceEnter = t - this.enteredAt;
    const staggering = this.editing() && sinceEnter < OVERLAY_MOTION.staggerCap + OVERLAY_MOTION.pop;
    o.anchors.forEach((a, i) => {
      a.grow = this.anchorHover.grow(`a${i}`, t);
      if (staggering && a.born === undefined) a.born = this.enteredAt + Math.min(i * OVERLAY_MOTION.stagger, OVERLAY_MOTION.staggerCap);
    });
    o.handles.forEach((h, i) => (h.grow = this.handleHover.grow(`h${i}`, t)));
    return o;
  }

  cursor(screen: Pt): string | null {
    void screen;
    const tool = studio().tool;
    if (tool === "pencil") return cursorCss("pencil");
    if (tool === "pen") return cursorCss(this.pen.cursorKind());
    if (this.editing() && tool === "select") {
      const k = this.edit.cursorKind(this.mods.mod);
      return k ? cursorCss(k) : "default";
    }
    return null;
  }

  animating(): boolean {
    const t = now();
    if (t < this.animUntil) return true;
    if (this.anchorHover.running(t) || this.handleHover.running(t)) return true;
    if (this.editing() && t - this.enteredAt < OVERLAY_MOTION.staggerCap + OVERLAY_MOTION.pop) return true;
    return studio().tool === "pen" && this.pen.closeHover && t - this.pen.closeAt < OVERLAY_MOTION.ring;
  }

  /** The vector tools own the canvas (the controller keeps hover and other chrome quiet). */
  busy(): boolean {
    return this.drag !== null || this.editing() || this.pen.drawing || this.pencil.active;
  }

  // ---------------------------------------------------------------------------
  // line, arrow, polygon, star

  private startShape(kind: ShapeTool, p: PointerInfo) {
    const s = studio();
    const doc = s.doc;
    const parent = deepestFrame(doc, hitPath(doc, p.world));
    const toWorld = parent ? worldMatrix(doc, parent) : IDENTITY;
    const local = apply(invert(toWorld), p.world);
    const start = { x: Math.round(local.x), y: Math.round(local.y) };
    const ts = parent ? tokensForNode(doc, parent) : activeTokens();
    const node =
      kind === "line" || kind === "arrow"
        ? makeLine(start, start, kind === "arrow", ts, defaultInk(doc, parent, canvasIsDark(), ts))
        : makeShapeVector(kind, { x: start.x, y: start.y, w: 0, h: 0 }, ts);
    // Drawn into auto layout, it stays where it's drawn rather than joining the flow.
    if (hasAutoLayout(parent ? doc.nodes[parent] : null)) node.absolute = true;
    const prevSel = s.selection;
    s.beginTx();
    insertNodes([node], parent);
    this.drag = { kind, id: node.id, start: apply(toWorld, start), startScreen: p.screen, cur: p.world, moved: false, prevSel, reposition: null };
  }

  /** Lay the shape out from the drag (⇧ constrains, ⌥ draws from the centre, Space repositions). */
  private applyShape() {
    const d = this.drag;
    if (!d) return;
    const { shift, alt } = this.mods;
    if (d.reposition) d.start = { x: d.reposition.start.x + d.cur.x - d.reposition.at.x, y: d.reposition.start.y + d.cur.y - d.reposition.at.y };
    const { start, cur } = inParent(studio().doc, d);
    const a = d.reposition ? { x: Math.round(start.x), y: Math.round(start.y) } : start;
    const id = d.id;
    if (d.kind === "line" || d.kind === "arrow") {
      const b = pixelEnd(a, shift ? snapAngle(a, cur) : cur, shift);
      const from = alt ? { x: 2 * a.x - b.x, y: 2 * a.y - b.y } : a;
      studio().mutate((draft: Doc) => setLine(draft.nodes[id] as PathNode, from, b));
      return;
    }
    let dx = cur.x - a.x,
      dy = cur.y - a.y;
    if (shift) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * m;
      dy = Math.sign(dy || 1) * m;
    }
    const x0 = alt ? a.x - Math.abs(dx) : Math.min(a.x, a.x + dx),
      y0 = alt ? a.y - Math.abs(dy) : Math.min(a.y, a.y + dy);
    const w = alt ? 2 * Math.abs(dx) : Math.abs(dx),
      h = alt ? 2 * Math.abs(dy) : Math.abs(dy);
    const box = { x: Math.round(x0), y: Math.round(y0), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
    studio().mutate((draft: Doc) => setShapeBox(draft.nodes[id] as PathNode, box));
  }

  private cancel() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const s = studio();
    s.cancelTx();
    s.select(d.prevSel.filter((id) => s.doc.nodes[id]));
  }
}
