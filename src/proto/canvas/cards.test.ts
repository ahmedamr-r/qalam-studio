import { beforeAll, describe, expect, it } from "vitest";
import { ensureYoga } from "@/engine/layout";
import { worldBounds } from "@/doc/geometry";
import type { SceneNode } from "@/doc/schema";
import { foodMenuDoc } from "../fixtures/food-menu";
import { cardDoc, stateCards, type StateCard } from "./cards";
import { routeGeometry } from "./layout";

beforeAll(async () => {
  await ensureYoga();
});

const texts = (c: StateCard) => c.nodes.flatMap((n: SceneNode) => (n.type === "text" ? [n.text.content] : []));

describe("state cards", () => {
  it("show the menu's header once scrolled under and a dish's + once it's in the basket, in a row after the parts", () => {
    const { doc, ids } = foodMenuDoc();
    const cards = stateCards(doc);
    expect(cards.map((c) => c.label)).toEqual(["Scrolled under the top bar", "In the basket"]);
    const bar = worldBounds(doc, ids.bar);
    expect(cards[0].box.x).toBeGreaterThanOrEqual(bar.x + bar.w);
    expect(cards[0].box.y).toBe(bar.y);
    expect(cards[1].box.x).toBeGreaterThan(cards[0].box.x + cards[0].box.w);
    // On the screen's background: the header as wide as it is on the screen, the + as the count it turns into.
    expect(cards[0].bg).toBe(doc.nodes[ids.menu].fill?.color);
    expect(cards[0].nodes[0].w).toBe(worldBounds(doc, cards[0].from).w);
    expect(texts(cards[0])).toContain("Al Mallah");
    expect(texts(cards[1])).toEqual(["1"]);
    // The route's container holds them; a dashed wire runs from each component to its card.
    const g = routeGeometry(doc).find((x) => x.screen === ids.menu)!;
    for (const c of cards) {
      expect(c.box.x).toBeGreaterThan(g.container!.x);
      expect(c.box.x + c.box.w).toBeLessThan(g.container!.x + g.container!.w);
      expect(c.box.y + c.box.h).toBeLessThan(g.container!.y + g.container!.h);
    }
    expect(g.wires.filter((w) => w.kind === "state").map((w) => w.label)).toEqual(cards.map((c) => c.label));
    // The renderer draws them from a document of their own: a root per card, inside its card.
    const d = cardDoc(doc);
    expect(d.roots).toHaveLength(2);
    for (const [i, id] of d.roots.entries()) {
      const b = worldBounds(d, id);
      const box = cards[i].box;
      expect(b.x).toBeGreaterThanOrEqual(box.x);
      expect(b.y).toBeGreaterThanOrEqual(box.y);
      expect(b.x + b.w).toBeLessThanOrEqual(box.x + box.w);
      expect(b.y + b.h).toBeLessThanOrEqual(box.y + box.h);
    }
  });

  it("follow the route: they move with the screen, and go with it", () => {
    const { doc, ids } = foodMenuDoc();
    const before = stateCards(doc)[0].box;
    const moved = { ...doc, nodes: { ...doc.nodes, [ids.menu]: { ...doc.nodes[ids.menu], y: doc.nodes[ids.menu].y + 100 } } };
    expect(stateCards(moved)[0].box.y).toBe(before.y + 100);
    const gone = { ...doc, proto: { ...doc.proto!, routes: {} } };
    expect(stateCards(gone)).toEqual([]);
  });
});
