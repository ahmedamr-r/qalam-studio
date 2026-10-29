import { movedTo } from "./frame/spaces";
import { routeOf, type Route } from "./routes";

/*
 * Moving between the frame's pages in place: the home, the places, the picker, a goal's or a
 * problem's page, in the organization this window has open. A link to one (or ⌘K) changes the
 * address and the page without loading the app again, so the frame stays and there's no splash;
 * Back and Forward do the same. Anything else (a board, setup, the welcome, another
 * organization, an old address that redirects) is a full page load, as every page was before:
 * a board's document and everything module-level still belong to one load.
 */

const IN_PLACE = new Set<Route["kind"]>(["org", "spaces", "place", "topic", "goal"]);

/** Whether a page can be shown in place in this organization. */
export const inPlace = (r: Route, org: string) => IN_PLACE.has(r.kind) && "org" in r && r.org === org;

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
    const u = new URL(href, window.location.href);
    if (u.origin !== window.location.origin) return false;
    // Only the hash changes: the browser scrolls to it.
    if (u.pathname === window.location.pathname && u.search === window.location.search && u.hash) return false;
    const r = routeOf(u.pathname);
    if (!inPlace(r, org) || movedTo(r, u.search)) return false;
    history.pushState(null, "", u.pathname + u.search + u.hash);
    show(r);
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
    if (inPlace(r, org)) show(r);
    else window.location.reload();
  };
  document.addEventListener("click", onClick);
  window.addEventListener("popstate", onPop);
  return () => {
    go = null;
    document.removeEventListener("click", onClick);
    window.removeEventListener("popstate", onPop);
  };
}
