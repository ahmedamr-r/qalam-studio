import { studio } from "@/doc/store";
import type { Doc } from "@/doc/schema";
import { type Pt, apply, worldBounds, worldMatrix } from "@/doc/geometry";
import { isNote, isOstCard, treeBounds, visibleCards } from "@/doc/board";
import { useGhosts } from "@/doc/ghosts";
import { reparentIn, topLevelOf } from "@/doc/ops";
import { feedback } from "@/commands/feedback";
import { addCardIn, addChild, cardOf, dropProblem, makeCardNode, moveCardsIn, newCard, toggleCollapsed } from "@/discovery/ops";
import { foldToggle, orientationOf } from "@/discovery/tree";
import { GAPS } from "@/discovery/layout";
import { makeSticky } from "@/discovery/sticky";
import { discovery, useDiscovery } from "@/ui/discovery/store";
import { startTitleEdit } from "@/ui/discovery/editing";
import { openSource } from "@/ui/discovery/sources";
import { hitPath, pickTarget } from "./hit-test";
import type { CanvasDelegate } from "./canvas-delegate";
import type { OstRenderInput } from "./ost-painter";
import type { PointerInfo } from "./vector-tools";

/*
 * The Discovery board's own gestures (installed by the Discovery boot as the canvas delegate):
 *   - Card tool: click a card for a new child, the empty board for the outcome (or a loose card)
 *   - Sticky tool: click to put a sticky down and type
 *   - drag a card (not the outcome: that moves the whole tree, the canvas's own move) to give it a
 *     new parent, or between two cards to change its order; dropped on the empty board it becomes
 *     a branch of its own there. Drops the tree's rules don't allow are refused, with the reason.
 *   - click a card's fold toggle; double-click a card to type its title
 */

const DRAG_THRESHOLD = 3;
/** The fold toggle takes clicks this close (screen px), however small it's drawn. */
const TOGGLE_HIT_PX = 10;

interface Drag {
  ids: string[];
  start: Pt;
  startScreen: Pt;
  active: boolean;
  dx: number;
  dy: number;
  drop: { target: string | null; parent: string | null; index?: number; line: [Pt, Pt] | null; ok: boolean; reason?: string } | null;
}

/** The card at a world point (not inside the dragged cards), however deep. */
export function cardAt(doc: Doc, world: Pt, exclude?: Set<string>): string | null {
  const s = studio();
  const path = hitPath(doc, world, exclude, { tol: 4 / s.camera.zoom });
  const id = pickTarget(doc, path, [], false);
  return id && isOstCard(doc.nodes[id]) ? id : null;
}

/** Inside a tree that Qalam AI's version is drawn over (its proposals under review, a redraft). */
function coveredAt(world: Pt): boolean {
  return useGhosts.getState().list.some((g) => {
    if (!g.covers || !g.doc.roots[0]) return false;
    const b = treeBounds(g.doc, g.doc.roots[0]);
    return world.x >= b.x && world.x <= b.x + b.w && world.y >= b.y && world.y <= b.y + b.h;
  });
}

/** The source note at a world point. */
function sourceNoteAt(doc: Doc, world: Pt): string | null {
  const top = hitPath(doc, world, undefined, { tol: 4 / studio().camera.zoom })?.[0];
  const n = top ? doc.nodes[top] : undefined;
  return isNote(n) && n.meta.note.kind === "source" ? n.meta.note.sourceId : null;
}

/** The fold toggle under a world point. */
function toggleAt(doc: Doc, world: Pt): string | null {
  const zoom = studio().camera.zoom;
  for (const root of doc.roots) {
    if (!isOstCard(doc.nodes[root])) continue;
    const o = orientationOf(doc, root);
    for (const id of visibleCards(doc, root)) {
      const n = doc.nodes[id];
      if (!n.children.some((c) => isOstCard(doc.nodes[c]))) continue;
      const t = foldToggle(n, o);
      const c = apply(worldMatrix(doc, id), { x: t.x, y: t.y });
      const r = Math.max(t.r, TOGGLE_HIT_PX / zoom);
      if (Math.hypot(world.x - c.x, world.y - c.y) <= r) return id;
    }
  }
  return null;
}

export function createOstTools(): CanvasDelegate {
  let drag: Drag | null = null;
  let hoverToggle: string | null = null;

  /** Where the dragged cards would land with the pointer here. */
  const dropAt = (d: Drag, world: Pt): Drag["drop"] => {
    const doc = studio().doc;
    const moving = new Set<string>();
    for (const id of d.ids) {
      moving.add(id);
      for (const c of visibleCards(doc, id)) moving.add(c);
    }
    const target = cardAt(doc, world, moving);
    if (!target) return { target: null, parent: null, line: null, ok: true };
    const t = doc.nodes[target];
    const b = worldBounds(doc, target);
    const o = orientationOf(doc, target);
    const parent = t.parentId && isOstCard(doc.nodes[t.parentId]) ? t.parentId : null;
    // Near a card's leading or trailing quarter (across the level): between it and its sibling.
    const along = o === "tb" ? (world.x - b.x) / b.w : (world.y - b.y) / b.h;
    if (parent && (along < 0.25 || along > 0.75)) {
      const after = along > 0.75;
      const list = doc.nodes[parent].children;
      const index = list.indexOf(target) + (after ? 1 : 0);
      const gap = GAPS[o].siblingGap / 2;
      const line: [Pt, Pt] =
        o === "tb"
          ? [{ x: after ? b.x + b.w + gap : b.x - gap, y: b.y }, { x: after ? b.x + b.w + gap : b.x - gap, y: b.y + b.h }]
          : [{ x: b.x, y: after ? b.y + b.h + gap : b.y - gap }, { x: b.x + b.w, y: after ? b.y + b.h + gap : b.y - gap }];
      const reason = dropProblem(doc, d.ids, parent);
      return { target: null, parent, index, line, ok: !reason, reason: reason ?? undefined };
    }
    const reason = dropProblem(doc, d.ids, target);
    return { target, parent: target, line: null, ok: !reason, reason: reason ?? undefined };
  };

  const finish = (d: Drag) => {
    const drop = d.drop;
    if (!drop) return;
    if (!drop.ok) {
      feedback(drop.reason ?? "Can't go there", { id: "discovery.drop" });
      return;
    }
    const s = studio();
    if (drop.parent) {
      s.mutate((dr) => void moveCardsIn(dr, d.ids, drop.parent, drop.index));
      return;
    }
    // Onto the empty board: a branch of its own, where it was dropped.
    s.mutate((dr) => {
      reparentIn(dr, d.ids, null);
      for (const id of d.ids) {
        const n = dr.nodes[id];
        n.x = Math.round(n.x + d.dx);
        n.y = Math.round(n.y + d.dy);
      }
    });
  };

  return {
    pointerDown(p: PointerInfo) {
      if (p.button !== 0) return false;
      const s = studio();
      const doc = s.doc;
      if (s.tool === "card") {
        s.setTool("select");
        const on = cardAt(doc, p.world);
        s.beginTx();
        let id: string | null = null;
        if (on) {
          id = addChild(on);
          if (!id) {
            s.cancelTx();
            feedback(`${cardOf(doc, on)?.kind === "test" ? "Tests" : "This card"} can't hold more cards`, { id: "discovery.add" });
            return true;
          }
        } else {
          // The board's first card is its outcome; after that, a loose opportunity to place later.
          const hasOutcome = doc.roots.some((r) => cardOf(doc, r)?.kind === "outcome");
          const node = makeCardNode(newCard(hasOutcome ? "opportunity" : "outcome"), { x: Math.round(p.world.x - 120), y: Math.round(p.world.y - 30) });
          s.mutate((d) => addCardIn(d, node, null));
          id = node.id;
        }
        s.select([id]);
        startTitleEdit(id, true);
        return true;
      }
      if (s.tool === "sticky") {
        s.setTool("select");
        const { frame, text } = makeSticky(p.world);
        s.mutate((d) => {
          d.nodes[frame.id] = frame;
          d.nodes[text.id] = text;
          d.roots.push(frame.id);
        });
        s.select([frame.id]);
        s.setEditingText(text.id);
        return true;
      }
      if (s.tool !== "select") return false;
      // The real cards are under Qalam AI's version: they can't be picked until it's settled.
      if (coveredAt(p.world)) {
        feedback("Accept or discard Qalam AI's proposals first: they're drawn over this tree", { id: "discovery.covered" });
        return true;
      }
      const fold = toggleAt(doc, p.world);
      if (fold) {
        toggleCollapsed([fold]);
        return true;
      }
      const id = cardAt(doc, p.world);
      if (!id) return false;
      const n = doc.nodes[id];
      // A tree's outcome moves the whole tree: the canvas's own move (with snapping) does that.
      if (!n.parentId && cardOf(doc, id)?.kind === "outcome") return false;
      let sel = s.selection;
      if (p.shift) {
        sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
        s.select(sel);
        if (!sel.includes(id)) return true;
      } else if (!sel.includes(id)) {
        sel = [id];
        s.select(sel);
      }
      // Drag the selected cards (except outcomes), each with its branch.
      const ids = topLevelOf(doc, sel).filter((x) => isOstCard(doc.nodes[x]) && !doc.nodes[x].locked && !(cardOf(doc, x)?.kind === "outcome" && !doc.nodes[x].parentId));
      drag = ids.length ? { ids, start: p.world, startScreen: p.screen, active: false, dx: 0, dy: 0, drop: null } : null;
      return true;
    },

    pointerMove(p: PointerInfo) {
      if (drag) {
        if (!drag.active) {
          if (Math.hypot(p.screen.x - drag.startScreen.x, p.screen.y - drag.startScreen.y) < DRAG_THRESHOLD) return true;
          drag.active = true;
          useDiscovery.setState({ dragging: true });
        }
        drag.dx = p.world.x - drag.start.x;
        drag.dy = p.world.y - drag.start.y;
        drag.drop = dropAt(drag, p.world);
        return true;
      }
      const s = studio();
      if (s.tool !== "select") return false;
      const t = toggleAt(s.doc, p.world);
      if (t !== hoverToggle) {
        hoverToggle = t;
        s.invalidate();
      }
      return !!t;
    },

    pointerUp() {
      const d = drag;
      drag = null;
      if (!d) return false;
      if (d.active) {
        useDiscovery.setState({ dragging: false });
        finish(d);
      }
      return true;
    },

    doubleClick(p: PointerInfo) {
      const s = studio();
      if (s.tool !== "select" || coveredAt(p.world)) return false;
      // A source note opens its source in the Sources tab.
      const source = sourceNoteAt(s.doc, p.world);
      if (source) {
        openSource(source);
        return true;
      }
      const id = cardAt(s.doc, p.world);
      if (!id) return false;
      s.select([id]);
      startTitleEdit(id, false);
      return true;
    },

    cursor() {
      if (drag?.active) return drag.drop && !drag.drop.ok ? "not-allowed" : "grabbing";
      if (hoverToggle) return "pointer";
      const tool = studio().tool;
      return tool === "card" || tool === "sticky" ? "crosshair" : null;
    },

    render(): OstRenderInput {
      const ui = discovery();
      return {
        editingId: ui.editing?.id ?? null,
        drag: drag?.active ? { ids: drag.ids, dx: drag.dx, dy: drag.dy } : null,
        // A card being dragged, else a quote dragged in from the Sources tab.
        drop: drag?.active && drag.drop ? { target: drag.drop.target, line: drag.drop.line, ok: drag.drop.ok } : ui.quoteDrop ? { target: ui.quoteDrop.target, line: null, ok: ui.quoteDrop.ok } : null,
        hoverToggle,
      };
    },
  };
}
