import { useSyncExternalStore } from "react";
import { movedTo, pageMovedTo } from "./frame/spaces";
import { currentSpace } from "./frame/useSpace";
import { routeOf, type Route } from "./routes";

/*
 * Moving between the frame's pages in place: a space's canvas, the places, a goal's or a
 * problem's page, in the organization this window has open. A link to one (or ⌘K) changes the
 * address and the page without loading the app again, so the frame stays and there's no splash;
 * Back and Forward do the same. Anything else (a board, setup, the welcome, the organizations'
 * list, another organization, an address that redirects) is a full page load, as every page was before:
 * a board's document and everything module-level still belong to one load.
 *
 * A goal's or a problem's page is the canvas's address with ?goal= or ?page= (src/ui/space/page.ts):
 * opening one is a step in history, so Back closes it, and the canvas stays as it is. A goal's or
 * a topic page's old address (/g/<id>, /t/<id>) moves to it.
 */

const IN_PLACE = new Set<Route["kind"]>(["org", "place", "seen"]);

/** Whether a page can be shown in place in this organization. */
export const inPlace = (r: Route, org: string) => IN_PLACE.has(r.kind) && "org" in r && r.org === org;

/** The keys of a page open in a canvas's panel. */
const PANEL = ["goal", "page", "at"];

const listeners = new Set<() => void>();
let moves = 0;
const notify = () => {
  moves++;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The address (its path and query), as moving in place changes it. */
export const useAddress = () => useSyncExternalStore(subscribe, () => window.location.pathname + window.location.search);

/** Bumped by every move, to the same address too (a page's link clicked again while it's open). */
export const useMoves = () => useSyncExternalStore(subscribe, () => moves);

/** Change the address without a step in history (what it asked is done, a page closed), keeping the step's own state. */
export function replaceAddress(href: string) {
  history.replaceState(history.state, "", href);
  notify();
}

/** How many page steps are open over the canvas at this step (0: none, or one opened by its address). */
export const panelDepth = (): number => (history.state as { panel?: number } | null)?.panel ?? 0;

/** The query without a panel's keys, to tell a page opening from any other move. */
function withoutPanel(search: string): string {
  const q = new URLSearchParams(search);
  for (const k of PANEL) q.delete(k);
  return q.toString();
}

let go: ((href: string) => boolean) | null = null;


/** Go to an address: in place when it's one of the frame's pages here, else a full page load. */
export function navigate(href: string) {
  if (!go?.(href)) window.location.assign(href);
}

/**
 * Once the organization is open on one of the frame's pages: links to the others, and Back and
 * Forward, show them in place through `show`. Returns the stop.
 */
export function startInPlace(org: string, show: (r: Route) => void): () => void {
  if (!inPlace(routeOf(window.location.pathname), org)) return () => {};
  go = (href) => {
    let u = new URL(href, window.location.href);
    if (u.origin !== window.location.origin) return false;
    // Only the hash changes: the browser scrolls to it.
    if (u.pathname === window.location.pathname && u.search === window.location.search && u.hash) return false;
    let r = routeOf(u.pathname);
    // A goal's or a topic page's old address: its page on the canvas this window is on.
    const page = pageMovedTo(r, u.hash, currentSpace());
    if (page) {
      u = new URL(page, window.location.href);
      r = routeOf(u.pathname);
    }
    if (!inPlace(r, org) || movedTo(r, u.search)) return false;
    // The page that's open, asked again: nothing moves, but the canvas hears it (its card picked goes).
    if (u.pathname === window.location.pathname && u.search === window.location.search) {
      notify();
      return true;
    }
    // A page opened over the canvas counts its steps, so closing it goes back past them all.
    const here = new URL(window.location.href);
    const opens = u.pathname === here.pathname && (u.searchParams.has("goal") || u.searchParams.has("page")) && withoutPanel(u.search) === withoutPanel(here.search);
    history.pushState(opens ? { panel: panelDepth() + 1 } : null, "", u.pathname + u.search + u.hash);
    show(r);
    notify();
    return true;
  };
  // After React's own handlers (they sit below the document), so a link that handles its click itself keeps it.
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
    if (go?.(a.href)) e.preventDefault();
  };
  const onPop = () => {
    const r = routeOf(window.location.pathname);
    if (!inPlace(r, org)) return window.location.reload();
    show(r);
    notify();
  };
  document.addEventListener("click", onClick);
  window.addEventListener("popstate", onPop);
  return () => {
    go = null;
    document.removeEventListener("click", onClick);
    window.removeEventListener("popstate", onPop);
  };
}
