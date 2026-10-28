import type { Route } from "../routes";

/*
 * The organization's places, in the order of the job: what to move (Goals), what customers need
 * that would move it (Problems), what the organization has heard and measured (Evidence), what was
 * decided. Each is a page at /o/<org>/<place>; Home is the organization's own address. A goal's
 * page and a board belong to Goals, a problem's page to Problems, other topic pages and sources to
 * Evidence. Kept free of React so routes and tests can read it.
 */

export type Place = "home" | "goals" | "problems" | "evidence" | "decisions" | "connections";

/** The places with a page of their own under /o/<org>/ (Home is /o/<org> itself). */
export type PagePlace = Exclude<Place, "home">;

export const PLACES: readonly { id: Place; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "goals", label: "Goals" },
  { id: "problems", label: "Problems" },
  { id: "evidence", label: "Evidence" },
  { id: "decisions", label: "Decisions" },
  { id: "connections", label: "Connections" },
];

/** Above a board's panels only these: the organization's Evidence would read as the board's own Sources panel. */
export const RAIL_PLACES: readonly Place[] = ["home", "goals", "problems", "connections"];

const PAGES = new Set<string>(PLACES.map((p) => p.id).filter((p) => p !== "home"));
export const isPagePlace = (s: string): s is PagePlace => PAGES.has(s);

/** Places from before the job order, and where they went: an old link still lands somewhere. */
export const MOVED_PLACES: Readonly<Record<string, PagePlace>> = { boards: "goals", topics: "problems", sources: "evidence" };

export const placeLabel = (p: Place) => PLACES.find((x) => x.id === p)?.label ?? p;

/** The place an address belongs to, for the sidebar's highlight (none while setting up, or on a missing page). */
export function placeOf(route: Route): Place | null {
  if (route.kind === "org") return "home";
  if (route.kind === "place") return route.place;
  if (route.kind === "topic") return "problems";
  if (route.kind === "goal" || route.kind === "project") return "goals";
  return null;
}

/** The home's old ?tab= (topics, sources, decisions, boards): the place that's a page of its own now, and the query without it. */
export function legacyTab(search: string): { place: PagePlace; search: string } | null {
  const q = new URLSearchParams(search);
  const tab = q.get("tab");
  const place = tab ? (MOVED_PLACES[tab] ?? (isPagePlace(tab) ? tab : null)) : null;
  if (!place || place === "connections") return null;
  q.delete("tab");
  const rest = q.toString();
  return { place, search: rest ? `?${rest}` : "" };
}
