import type { PageRef } from "@/projects/model";
import type { SpaceThing } from "./compose";

/*
 * A goal's or a topic page's page, open in a space's canvas panel (src/ui/space/page.ts): read
 * from the address, and the card on the canvas it belongs to, if one is there. Pure.
 */

const ID = /^[A-Za-z0-9_~-]{1,64}$/;

/** The page an address opens (?goal=<id> or ?page=<topic>) and the section it asks for (`at`); null when it opens none. */
export function pageOf(search: string): { ref: PageRef; at: string | null } | null {
  const q = new URLSearchParams(search);
  const goal = q.get("goal");
  const page = q.get("page");
  const ref: PageRef | null = goal && ID.test(goal) ? { goal } : page && ID.test(page) ? { page } : null;
  return ref ? { ref, at: q.get("at") } : null;
}

/** The same page (a goal's, or a topic page's), however it was asked for. */
export const samePage = (a: PageRef | null | undefined, b: PageRef | null | undefined) => !!a && !!b && ("goal" in a ? "goal" in b && a.goal === b.goal : "page" in b && a.page === b.page);

/** The card a page belongs to on the canvas: the goal's own, or the problem's page drawn faint there. */
export function cardForPage(ref: PageRef, things: ReadonlyMap<string, SpaceThing>): string | undefined {
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
