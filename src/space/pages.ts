import type { PageRef } from "@/projects/model";
import type { SpaceThing } from "./compose";

/*
 * A goal's or a topic page's page, open in a space's canvas panel (src/ui/space/page.ts): read
 * from the address, and the card on the canvas it belongs to, if one is there. Pure.
 */

const ID = /^[A-Za-z0-9_~-]{1,64}$/;

/** The page an address opens (?goal=<id>, ?page=<topic> or ?business=1) and the section it asks for (`at`); null when it opens none. */
export function pageOf(search: string): { ref: PageRef; at: string | null } | null {
  const q = new URLSearchParams(search);
  const goal = q.get("goal");
  const page = q.get("page");
  const ref: PageRef | null = goal && ID.test(goal) ? { goal } : page && ID.test(page) ? { page } : q.get("business") === "1" ? { business: true } : null;
  return ref ? { ref, at: q.get("at") } : null;
}

/** A page's key: what it is, the same however it was asked for. */
export const pageKey = (ref: PageRef) => ("goal" in ref ? `goal:${ref.goal}` : "page" in ref ? `page:${ref.page}` : "business");

/** The same page (a goal's, a topic page's, or how the business works), however it was asked for. */
export const samePage = (a: PageRef | null | undefined, b: PageRef | null | undefined) => !!a && !!b && pageKey(a) === pageKey(b);

/** The card a page belongs to on the canvas: the goal's own, or the problem's page drawn faint there. How the business works has none. */
export function cardForPage(ref: PageRef, things: ReadonlyMap<string, SpaceThing>): string | undefined {
  if ("business" in ref) return undefined;
  for (const [id, t] of things) {
    if ("goal" in ref ? t.type === "goal" && t.goal === ref.goal : t.type === "problem" && t.topic === ref.page) return id;
  }
  return undefined;
}

/** What the panel shows: a section (`SECTION`), a page (its key), or neither, and how many pages are open over the canvas. */
export type PanelView = { view: string | null; depth: number };
export const SECTION = "section";

/** Which way the panel's content moves, deeper or back: between a section and a page, or page and page. Nothing as the panel opens or closes, or when a card lies over it. */
export function panelMove(was: PanelView, now: PanelView): "in" | "back" | null {
  if (!was.view || !now.view || was.view === now.view) return null;
  if (was.view === SECTION) return "in";
  if (now.view === SECTION) return "back";
  return now.depth < was.depth ? "back" : "in";
}
