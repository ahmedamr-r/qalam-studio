/**
 * Where a route shows on the canvas (pure, world space): a container around the screen, its
 * parts and its state cards, the wires from what's tapped to what it opens (or the screen it goes
 * to) and from a component to its cards, and the fold — how much of a phone screen shows before it
 * scrolls. The painter (engine/route-painter.ts) draws these; nothing here touches the document.
 */
import { PLATFORMS, isPlatform } from "@/design-system/platform";
import { worldBounds, type Box } from "@/doc/geometry";
import type { Doc, RouteRule, RouteTrigger } from "@/doc/schema";
import { PART_DROP, PART_GAP } from "../edit";
import { partFrames, resolveRef } from "../routes";
import { stateCards } from "./cards";

export interface Wire {
  rule: string;
  /** The tapped layer's box, and the frame it opens or goes to. */
  from: Box;
  to: Box;
  label: string;
  /** Opens a part, goes to a screen (or a page not designed yet), or shows a component's other state (a card). */
  kind: "open" | "go" | "next" | "state";
  /** The screen the tapped layer is in: a wire to a part under it bends out past its edge. */
  around?: Box;
}

/** A page the route goes to before it's designed: a dashed card at the end of the row of parts. */
export interface PageCard {
  page: string;
  name: string;
  brief: string;
  box: Box;
}

export interface RouteGeometry {
  screen: string;
  /** Around the screen, its parts, its cards and its pages; absent while it has none. */
  container?: Box;
  pages: PageCard[];
  wires: Wire[];
  /** Where the screen's first view ends (world y), when it scrolls. */
  fold?: { y: number; x0: number; x1: number };
}

/** Room between a container's edge and what it holds (world px). */
export const CONTAINER_PAD = 32;

const union = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
};

/** How a wire's trigger reads on its chip. */
export function triggerLabel(t: RouteTrigger): string {
  switch (t.on) {
    case "tap":
      return "Tap";
    case "press":
      return "Press";
    case "hover":
      return "Hover";
    case "enter":
      return "On open";
    case "delay":
      return t.ms >= 1000 ? `After ${Math.round(t.ms / 100) / 10} s` : `After ${t.ms} ms`;
  }
}

function wiresOf(doc: Doc, screen: string, rules: RouteRule[], pages: PageCard[]): Wire[] {
  const out: Wire[] = [];
  const route = doc.proto?.routes?.[screen];
  for (const ru of rules) {
    const fromId = "ref" in ru.when ? resolveRef(doc, screen, ru.when.ref) : screen;
    if (!fromId || !doc.nodes[fromId]) continue;
    const from = worldBounds(doc, fromId);
    // A rule on a pattern (every dish's +) is drawn from its first match.
    const label = "ref" in ru.when && ru.when.ref.path?.includes("*") ? `${triggerLabel(ru.when)} any` : triggerLabel(ru.when);
    const around = fromId !== screen ? worldBounds(doc, screen) : undefined;
    for (const a of ru.then) {
      if (a.do === "next") {
        const card = pages.find((p) => p.page === a.page);
        if (card) out.push({ rule: ru.id, from, to: card.box, label, kind: "next", around });
        continue;
      }
      const target = a.do === "open" ? (route?.overlays[a.part]?.frame ?? route?.addOns[a.part]?.frame) : a.do === "go" ? a.screen : undefined;
      if (!target || !doc.nodes[target]) continue;
      out.push({ rule: ru.id, from, to: worldBounds(doc, target), label, kind: a.do === "go" ? "go" : "open", around });
    }
  }
  return out;
}

/** A page card's size (world px): room for its name and Generate it. */
export const PAGE_CARD = { w: 240, h: 148 };

const cache = new WeakMap<Doc, RouteGeometry[]>();

/** Every route's geometry (memoized per document). */
export function routeGeometry(doc: Doc): RouteGeometry[] {
  const hit = cache.get(doc);
  if (hit) return hit;
  const out: RouteGeometry[] = [];
  for (const [screen, r] of Object.entries(doc.proto?.routes ?? {})) {
    const n = doc.nodes[screen];
    if (!n || n.type !== "frame") continue;
    const box = worldBounds(doc, screen);
    const parts = partFrames(doc, screen).map((p) => worldBounds(doc, p.frame));
    const cards = stateCards(doc).filter((c) => c.screen === screen);
    // Pages not designed yet: after the parts and cards, in their row under the screen.
    let x = Math.max(box.x - PART_GAP, ...parts.map((b) => b.x + b.w), ...cards.map((c) => c.box.x + c.box.w)) + PART_GAP;
    const pages: PageCard[] = Object.entries(r.next ?? {}).map(([page, np]) => {
      const card = { page, name: np.name, brief: np.brief, box: { x, y: box.y + box.h + PART_DROP, ...PAGE_CARD } };
      x += PAGE_CARD.w + PART_GAP;
      return card;
    });
    const g: RouteGeometry = { screen, pages, wires: wiresOf(doc, screen, r.rules, pages) };
    for (const c of cards) if (doc.nodes[c.from]) g.wires.push({ rule: c.key, from: worldBounds(doc, c.from), to: c.box, label: c.label, kind: "state" });
    if (parts.length || cards.length || pages.length) {
      const u = union([box, ...parts, ...cards.map((c) => c.box), ...pages.map((p) => p.box)]);
      g.container = { x: u.x - CONTAINER_PAD, y: u.y - CONTAINER_PAD, w: u.w + 2 * CONTAINER_PAD, h: u.h + 2 * CONTAINER_PAD };
    }
    // A phone screen taller than the phone: the first view ends at the fold.
    const platform = isPlatform(n.meta.spec?.platform) ? n.meta.spec.platform : "mobile";
    const vh = PLATFORMS[platform].h;
    if (platform === "mobile" && box.h > vh + 1) g.fold = { y: box.y + vh, x0: box.x, x1: box.x + box.w };
    out.push(g);
  }
  cache.set(doc, out);
  return out;
}
