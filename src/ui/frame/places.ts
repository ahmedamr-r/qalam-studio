import type { Route } from "../routes";

/*
 * The organization's places: what the sidebar lists, and what a board's rail shows above its own
 * panels. Each is a page at /o/<org>/<place>; Home is the organization's own address. A topic page
 * belongs to Topics and a project to Boards. Kept free of React so routes and tests can read it.
 */

export type Place = "home" | "boards" | "topics" | "sources" | "decisions" | "connections";

/** The places with a page of their own under /o/<org>/ (Home is /o/<org> itself). */
export type PagePlace = Exclude<Place, "home">;

/** `short` names it under its icon in the folded rail, where the full name doesn't fit. */
export const PLACES: readonly { id: Place; label: string; short?: string }[] = [
  { id: "home", label: "Home" },
  { id: "boards", label: "Boards" },
  { id: "topics", label: "Topics" },
  { id: "sources", label: "Sources" },
  { id: "decisions", label: "Decisions" },
  { id: "connections", label: "Connections", short: "Connect" },
];

/** Above a board's panels only these: the organization's Sources would read as the board's own Sources panel. */
export const RAIL_PLACES: readonly Place[] = ["home", "boards", "topics", "connections"];

const PAGES = new Set<string>(PLACES.map((p) => p.id).filter((p) => p !== "home"));
export const isPagePlace = (s: string): s is PagePlace => PAGES.has(s);

export const placeLabel = (p: Place) => PLACES.find((x) => x.id === p)?.label ?? p;

/** The place an address belongs to, for the sidebar's highlight (none while setting up, or on a missing page). */
export function placeOf(route: Route): Place | null {
  if (route.kind === "org") return "home";
  if (route.kind === "place") return route.place;
  if (route.kind === "topic") return "topics";
  if (route.kind === "project") return "boards";
  return null;
}

/** The home's old ?tab= (topics, sources, decisions, boards): the place that's a page of its own now, and the query without it. */
export function legacyTab(search: string): { place: PagePlace; search: string } | null {
  const q = new URLSearchParams(search);
  const tab = q.get("tab");
  if (!tab || !isPagePlace(tab) || tab === "connections") return null;
  q.delete("tab");
  const rest = q.toString();
  return { place: tab, search: rest ? `?${rest}` : "" };
}
